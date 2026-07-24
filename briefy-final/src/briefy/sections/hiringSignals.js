import { mcpAvailable, enrichCompanyMcp } from '../../lib/zoominfo-mcp.js';

// Distinctive slug from a domain, e.g. "corkensteel.com" -> "corkensteel",
// "caroneandcompanyinc.com" -> "caroneandcompanyinc". Used to keep only search
// results that actually belong to THIS company (drops same-name-different-company
// noise like "carOne" for "Carone & Company").
function domainSlug(domain) {
  return String(domain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Verify the company domain against ZoomInfo; return the canonical website when
// matched (so hiring is tied to the RIGHT company), else the stored domain.
async function verifiedDomain(domain) {
  if (!mcpAvailable()) return domain;
  try {
    const c = await enrichCompanyMcp(domain);
    if (c?.website) return c.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
  } catch { /* keep stored */ }
  return domain;
}

async function careersPageRoles(domain) {
  const KEY = process.env.JINA_API_KEY;
  if (!KEY || !domain) return [];
  try {
    const res = await fetch(`https://r.jina.ai/https://${domain}/careers`, {
      headers: { Authorization: `Bearer ${KEY}`, Accept: 'text/plain' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (text.trim().length < 150) return [];
    return [{ title: 'See careers page for open roles', source: 'careers page', link: `https://${domain}/careers` }];
  } catch {
    return [];
  }
}

// SerpAPI job search, filtered to results that actually belong to this company:
// the link or title must reference the company's domain slug. This removes
// same-name-different-company matches that plagued the old name-only search.
async function serpOpenRoles(domain, companyName) {
  const key = process.env.SERPAPI_KEY;
  if (!key || !domain) return [];
  const slug = domainSlug(domain);
  if (!slug) return [];
  const roles = [];
  const belongs = (r) => {
    const hay = norm(r.link) + ' ' + norm(r.title);
    return hay.includes(slug);
  };
  const queries = [
    `"${companyName || domain}" (careers OR jobs OR hiring) estimator OR "project manager"`,
    `site:linkedin.com/jobs "${companyName || domain}"`,
  ];
  const sources = ['Google', 'LinkedIn (via Google)'];
  for (let i = 0; i < queries.length; i++) {
    try {
      const q = encodeURIComponent(queries[i]);
      const res = await fetch(`https://serpapi.com/search.json?q=${q}&num=8&api_key=${key}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of (data.organic_results || [])) {
        if (belongs(r)) roles.push({ title: r.title, source: sources[i], link: r.link });
      }
    } catch { /* non-fatal */ }
  }
  // de-dupe by link
  const seen = new Set();
  return roles.filter((r) => { if (seen.has(r.link)) return false; seen.add(r.link); return true; }).slice(0, 6);
}

/**
 * @param {string} domain - stored/deal domain
 * @param {string} [companyName]
 * @returns {Promise<{openRoles: Array<{title: string, source: string, link: string}>, status: 'ready'|'error'}>}
 */
export async function buildHiringSignals(domain, companyName) {
  try {
    const vdomain = await verifiedDomain(domain);
    const [careers, serp] = await Promise.all([careersPageRoles(vdomain), serpOpenRoles(vdomain, companyName)]);
    return { openRoles: [...careers, ...serp], status: 'ready' };
  } catch (err) {
    return { openRoles: [], status: 'error', error: err.message };
  }
}
