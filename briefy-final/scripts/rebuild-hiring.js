// Targeted hiring-signal rebuild. Recomputes Open Roles with ZoomInfo domain
// verification + company-slug filtering (drops same-name-different-company noise).
//
// Usage:  node scripts/rebuild-hiring.js [future|inwindow|all]
import { buildHiringSignals } from '../src/briefy/sections/hiringSignals.js';

const SCOPE = (process.argv[2] || 'inwindow').toLowerCase();
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
  const fields = ['Brief Status', 'Company Domain', 'Company Name', 'Meeting Date & Time', 'Section Status'];
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
  const company = r.fields['Company Name'] || '';
  const { openRoles, status } = await buildHiringSignals(domain, company);
  let ss = {};
  try { ss = JSON.parse(r.fields['Section Status'] || '{}'); } catch { /* ignore */ }
  ss.hiringSignals = status;
  await update(r.id, { 'Open Roles': JSON.stringify(openRoles), 'Section Status': JSON.stringify(ss) });
  return openRoles.length;
}

async function main() {
  console.log(`scope=${SCOPE} | listing rows...`);
  const rows = (await listRows()).filter(target);
  console.log(`${rows.length} briefs to rebuild hiring for`);
  if (!rows.length) return;
  let done = 0, withRoles = 0, total = 0, failed = 0, cf = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      try { const n = await rebuildOne(r); if (n) { withRoles++; total += n; } cf = 0; }
      catch (e) { failed++; cf++; console.log(`  ! ${r.fields['Company Name'] || r.id}: ${e.message.slice(0, 100)}`); if (cf >= 8) throw new Error('8 consecutive failures'); }
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${rows.length} (withRoles ${withRoles}, ${total} roles, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`DONE: ${done} processed, ${withRoles} have roles (${total}), ${failed} failed`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
