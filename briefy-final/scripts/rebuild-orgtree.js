// Targeted org-tree rebuild via ZoomInfo MCP. For each in-scope brief, rebuilds
// the Org Tree (Estimation / Project Management / Upper Management with
// name/title/email/phone/linkedin) and writes it to Airtable. Consumes ZoomInfo
// enrich credits per contact, so default scope is upcoming + this week only.
//
// Usage:  node scripts/rebuild-orgtree.js [future|inwindow|all]
//   future (default): meetings today 00:00 onward
//   inwindow:         meetings within -3d..+21d
//   all:              every Ready brief with a domain
import { buildOrgTree } from '../src/briefy/sections/orgTree.js';
import { mcpAvailable } from '../src/lib/zoominfo-mcp.js';

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
const CONCURRENCY = 3; // ZoomInfo MCP rate limit is low (25) — keep it gentle.

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

function count(tree) {
  return tree.estimators.length + tree.programManagers.length + tree.upperManagement.length;
}

async function rebuildOne(r) {
  const domain = r.fields['Company Domain'].trim();
  const company = r.fields['Company Name'] || '';
  const { orgTree, status } = await buildOrgTree(domain, company);
  let ss = {};
  try { ss = JSON.parse(r.fields['Section Status'] || '{}'); } catch { /* ignore */ }
  ss.orgTree = status;
  await update(r.id, { 'Org Tree': JSON.stringify(orgTree), 'Section Status': JSON.stringify(ss) });
  return count(orgTree);
}

async function main() {
  if (!mcpAvailable()) throw new Error('ZoomInfo MCP not configured (ZOOMINFO_MCP_TOKEN or CLIENT_ID+SECRET)');
  console.log(`scope=${SCOPE} | listing rows...`);
  const rows = (await listRows()).filter(target);
  console.log(`${rows.length} briefs to rebuild org tree for`);
  if (!rows.length) return;

  let done = 0, withPeople = 0, totalPeople = 0, failed = 0, consecutiveFail = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      try {
        const n = await rebuildOne(r);
        if (n > 0) { withPeople++; totalPeople += n; }
        consecutiveFail = 0;
      } catch (e) {
        failed++; consecutiveFail++;
        console.log(`  ! ${r.fields['Company Name'] || r.id}: ${e.message.slice(0, 120)}`);
        if (consecutiveFail >= 8) throw new Error('8 consecutive failures — aborting');
      }
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${rows.length} (with people ${withPeople}, ${totalPeople} contacts, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`DONE: ${done} processed, ${withPeople} briefs got contacts (${totalPeople} people), ${failed} failed`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
