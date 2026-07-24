// Targeted company-enrich rebuild via ZoomInfo MCP. Writes the ZoomInfo Company
// JSON (revenue, employees, founded, industry, HQ, website, phone) and fills
// ZoomInfo Revenue when present. Default scope: upcoming + this week.
//
// Usage:  node scripts/rebuild-company.js [future|inwindow|all]
import { enrichCompanyMcp, mcpAvailable } from '../src/lib/zoominfo-mcp.js';

const SCOPE = (process.argv[2] || 'future').toLowerCase();
const TOKEN = process.env.AIRTABLE_API_KEY;
const BASE = process.env.BRIEFY_AIRTABLE_BASE_ID;
const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';
const API = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const NOW = Date.now();
const PAST = NOW - 3 * 86400000;
const FUT = NOW + 21 * 86400000;
const TODAY_START = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const CONCURRENCY = 3;

async function listRows() {
  const fields = ['Brief Status', 'Company Domain', 'Meeting Date & Time', 'ZoomInfo Revenue'];
  const fq = fields.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join('&');
  const rows = [];
  let offset;
  do {
    const res = await fetch(`${API}?pageSize=100&${fq}${offset ? `&offset=${offset}` : ''}`, { headers: H });
    if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
    const d = await res.json();
    rows.push(...d.records);
    offset = d.offset;
  } while (offset);
  return rows;
}

function target(r) {
  const f = r.fields;
  if (f['Brief Status'] !== 'Ready') return false;
  if (!(f['Company Domain'] || '').trim()) return false;
  if (SCOPE === 'all') return true;
  const m = Number(f['Meeting Date & Time']);
  if (!Number.isFinite(m)) return false;
  if (SCOPE === 'inwindow') return m >= PAST && m <= FUT;
  return m >= TODAY_START;
}

async function update(id, fields) {
  const res = await fetch(`${API}/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`patch ${res.status}: ${await res.text()}`);
}

async function rebuildOne(r) {
  const domain = r.fields['Company Domain'].trim();
  const company = await enrichCompanyMcp(domain);
  const fields = { 'ZoomInfo Company': JSON.stringify(company || null) };
  if (company?.revenue) fields['ZoomInfo Revenue'] = company.revenue;
  await update(r.id, fields);
  return company ? (company.revenue || 'no-rev') : null;
}

async function main() {
  if (!mcpAvailable()) throw new Error('ZoomInfo MCP not configured');
  console.log(`scope=${SCOPE} | listing rows...`);
  const rows = (await listRows()).filter(target);
  console.log(`${rows.length} briefs to enrich company for`);
  if (!rows.length) return;

  let done = 0, matched = 0, failed = 0, consecutiveFail = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      try {
        const v = await rebuildOne(r);
        if (v) matched++;
        consecutiveFail = 0;
      } catch (e) {
        failed++; consecutiveFail++;
        console.log(`  ! ${r.id}: ${e.message.slice(0, 120)}`);
        if (consecutiveFail >= 8) throw new Error('8 consecutive failures — aborting');
      }
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${rows.length} (matched ${matched}, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`DONE: ${done} processed, ${matched} enriched, ${failed} failed`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
