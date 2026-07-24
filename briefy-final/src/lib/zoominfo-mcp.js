// ZoomInfo MCP client. The Briefy "Breify" app is scoped api:data:mcp — it does
// NOT work against the Enrich REST API (401), only against the MCP server. This
// module speaks JSON-RPC to mcp.zoominfo.com and exposes the pieces Briefy needs:
// company enrich, org tree (search + enrich contacts), and company signals.
//
// Auth: mints its own token via OAuth client_credentials when
// ZOOMINFO_MCP_CLIENT_ID + ZOOMINFO_MCP_CLIENT_SECRET are set (fully autonomous);
// otherwise falls back to a manually-pasted ZOOMINFO_MCP_TOKEN (expires ~24h).

const MCP_URL = 'https://mcp.zoominfo.com/mcp';
const TOKEN_URL = 'https://okta-login.zoominfo.com/oauth2/default/v1/token';

let cachedToken = null; // { token, expMs }

async function mintToken() {
  const id = process.env.ZOOMINFO_MCP_CLIENT_ID;
  const secret = process.env.ZOOMINFO_MCP_CLIENT_SECRET;
  if (!id || !secret) return null;
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'api:data:mcp' });
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`mint token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return { token: d.access_token, expMs: Date.now() + (d.expires_in || 3600) * 1000 - 60_000 };
}

async function getToken() {
  if (cachedToken && cachedToken.expMs > Date.now()) return cachedToken.token;
  const minted = await mintToken().catch((e) => { console.error('[zi-mcp] mint failed', e.message); return null; });
  if (minted?.token) { cachedToken = minted; return minted.token; }
  const manual = process.env.ZOOMINFO_MCP_TOKEN;
  if (manual) return manual;
  throw new Error('no ZoomInfo MCP credentials (set ZOOMINFO_MCP_CLIENT_ID+SECRET or ZOOMINFO_MCP_TOKEN)');
}

let rpcId = 0;

// Call one MCP tool. Returns the tool's parsed JSON payload (tools return a
// JSON string inside result.content[].text), or throws on an MCP error.
async function mcpCall(name, args) {
  const token = await getToken();
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = (await res.text()).trim();
  let envelope = null;
  for (const line of raw.split('\n')) {
    const s = line.replace(/^data:\s?/, '').trim();
    if (!s) continue;
    try {
      const parsed = JSON.parse(s);
      if (parsed.result || parsed.error) { envelope = parsed; break; }
    } catch { /* not this line */ }
  }
  if (!envelope) throw new Error(`${name}: unparseable MCP response: ${raw.slice(0, 200)}`);
  if (envelope.error) throw new Error(`${name}: ${JSON.stringify(envelope.error).slice(0, 200)}`);
  const text = (envelope.result.content || []).map((c) => c.text || '').join('');
  // Tool payloads come back double-encoded (a JSON string containing JSON).
  let val = text;
  for (let i = 0; i < 3 && typeof val === 'string'; i++) {
    try { val = JSON.parse(val); } catch { break; }
  }
  return typeof val === 'string' ? { raw: val } : val;
}

export function mcpAvailable() {
  return Boolean(process.env.ZOOMINFO_MCP_TOKEN || (process.env.ZOOMINFO_MCP_CLIENT_ID && process.env.ZOOMINFO_MCP_CLIENT_SECRET));
}

// Format a raw revenue number ("648400000") as a human range ("$648.4M").
function fmtRevenue(rev) {
  const n = Number(rev);
  if (!Number.isFinite(n) || n <= 0) return typeof rev === 'string' ? rev : '';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

// Valid enrich_companies fields we want (any invalid name empties the response).
const COMPANY_FIELDS = [
  'name', 'website', 'revenue', 'revenueRange', 'employeeCount', 'employeeRange',
  'foundedYear', 'primaryIndustry', 'industries', 'phone', 'city', 'state', 'country',
  'metroArea', 'description', 'totalFundingAmount', 'recentFundingAmount', 'recentFundingDate',
];

/** Enrich a company by domain → normalized fields Briefy stores. */
export async function enrichCompanyMcp(domain) {
  if (!domain) return null;
  const out = await mcpCall('enrich_companies', {
    companies: [{ companyWebsite: domain }],
    requiredFields: COMPANY_FIELDS,
  }).catch(() => null);
  if (!out) return null;
  const first = Object.values(out).find((v) => v && typeof v === 'object' && v.data);
  const d = first?.data || {};
  if (!d.name && !d.id) return null;
  const firstStr = (v) => (Array.isArray(v) ? v[0] : v) || '';
  return {
    name: d.name || '',
    website: d.website || domain,
    revenue: fmtRevenue(d.revenue) || d.revenueRange || '',
    employeeCount: d.employeeCount ?? (d.employeeRange || ''),
    foundedYear: d.foundedYear || '',
    industry: firstStr(d.primaryIndustry) || firstStr(d.industries) || '',
    phone: d.phone || '',
    location: d.metroArea || [d.city, d.state, d.country].filter(Boolean).join(', '),
    description: d.description || '',
    companyId: d.id || '',
  };
}

const DEPT_QUERIES = [
  { bucket: 'estimators', args: { jobTitle: 'Estimator' } },
  { bucket: 'programManagers', args: { jobTitle: 'Project Manager' } },
  { bucket: 'upperManagement', args: { managementLevel: 'C Level Exec,VP Level Exec,Director' } },
];

const PER_DEPT = Number(process.env.BRIEFY_ORGTREE_PER_DEPT || 4);

// Pick the cleanest LinkedIn profile URL from a ZoomInfo externalUrls array.
function linkedinFrom(urls) {
  if (!Array.isArray(urls)) return '';
  const links = urls.filter((u) => /linkedin\.com/i.test(u?.type || u?.url || '')).map((u) => u.url).filter(Boolean);
  // Prefer a readable /in/ vanity URL over the opaque ACwAA... one; drop trailing slash.
  const vanity = links.find((u) => /\/in\/(?!ACwAA)/i.test(u));
  return (vanity || links[0] || '').replace(/\/$/, '');
}

// Search contacts for one department bucket → [{personId, name, title}].
async function searchDept(domain, args) {
  const out = await mcpCall('search_contacts', { companyWebsite: domain, ...args }).catch(() => null);
  const rows = out?.data || [];
  return rows.map((r) => {
    const a = r.attributes || {};
    return {
      personId: String(r.id || ''),
      name: [a.firstName, a.lastName].filter(Boolean).join(' ').trim(),
      title: a.jobTitle || '',
      accuracy: a.contactAccuracyScore || 0,
    };
  }).filter((p) => p.personId && p.name);
}

/**
 * Build the org tree from ZoomInfo MCP: search by department, then enrich the
 * top contacts per bucket for email/phone. Output matches the existing shape:
 * { estimators, programManagers, upperManagement } of {name,title,email,phone,linkedin,source}.
 */
export async function orgTreeMcp(domain) {
  if (!domain) return null;
  const tree = { estimators: [], programManagers: [], upperManagement: [] };
  for (const { bucket, args } of DEPT_QUERIES) {
    const people = await searchDept(domain, args);
    // Highest-accuracy first, cap per dept to control credit spend.
    people.sort((a, b) => b.accuracy - a.accuracy);
    const top = people.slice(0, PER_DEPT);
    if (!top.length) continue;

    // Enrich this bucket's contacts for email/phone/LinkedIn (small batch = reliable).
    const enr = await mcpCall('enrich_contacts', {
      contacts: top.map((p) => ({ personId: p.personId })),
      requiredFields: ['email', 'phone', 'externalUrls'],
    }).catch(() => null);
    const byId = {};
    if (enr) {
      for (const v of Object.values(enr)) {
        const d = v?.data;
        if (d && d.id) byId[String(d.id)] = d;
      }
    }
    for (const p of top) {
      const d = byId[p.personId];
      tree[bucket].push({
        name: p.name,
        title: p.title,
        email: d?.email || '',
        phone: d?.phone || '',
        linkedin: linkedinFrom(d?.externalUrls),
        source: 'ZoomInfo',
      });
    }
  }
  return tree;
}

/** Company buying signals (Intent + News + Scoops) for one domain. */
export async function companySignalsMcp(domain) {
  if (!domain) return null;
  return mcpCall('enrich_company_signals', {
    companies: [{ companyWebsite: domain }],
    signalTypes: ['Intent', 'News', 'Scoops'],
  }).catch(() => null);
}
