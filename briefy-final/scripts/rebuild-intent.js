// Targeted intent-only rebuild. Recomputes ONLY the Buying-Intent section
// (Jina news -> Requesty LLM) and writes it back to Airtable. Touches NO
// expensive providers (SerpAPI / Exa / ZoomInfo).
//
// Usage:  node scripts/rebuild-intent.js [inwindow|future|all]
//   inwindow (default): only briefs whose meeting is within -3d..+21d (what the UI surfaces)
//   future:             only briefs whose meeting is today 00:00 onward (all AEs, no upper bound)
//   all:                every Ready brief with an empty intent + a domain
import { buildIntent } from '../src/briefy/sections/intent.js';

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
const CONCURRENCY = 5;

async function listRows() {
  const fields = ['Brief Status', 'ZoomInfo Intent Score', 'Meeting Date & Time', 'Company Domain', 'Company Name', 'Section Status'];
  const fq = fields.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join('&');
  const rows = [];
  let offset;
  do {
    const url = `${API}?pageSize=100&${fq}${offset ? `&offset=${offset}` : ''}`;
    const res = await fetch(url, { headers: H });
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
  if ((f['ZoomInfo Intent Score'] || '').trim()) return false;
  if (!(f['Company Domain'] || '').trim()) return false;
  if (SCOPE === 'all') return true;
  const m = Number(f['Meeting Date & Time']);
  if (!Number.isFinite(m)) return false;
  if (SCOPE === 'future') return m >= TODAY_START;
  return m >= PAST && m <= FUT;
}

async function update(id, fields) {
  const res = await fetch(`${API}/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`patch ${res.status}: ${await res.text()}`);
}

async function rebuildOne(r) {
  const domain = r.fields['Company Domain'].trim();
  const company = r.fields['Company Name'] || '';
  const intent = await buildIntent(domain, company);
  let ss = {};
  try { ss = JSON.parse(r.fields['Section Status'] || '{}'); } catch { /* ignore */ }
  ss.intent = intent.status;
  await update(r.id, {
    'ZoomInfo Intent Score': intent.intentScore || '',
    'Section Status': JSON.stringify(ss),
  });
  return intent.intentScore || '(empty)';
}

async function main() {
  console.log(`scope=${SCOPE} | listing rows...`);
  const rows = (await listRows()).filter(target);
  console.log(`${rows.length} briefs to rebuild intent for`);
  if (!rows.length) return;

  let done = 0, populated = 0, failed = 0, consecutiveFail = 0;
  const queue = [...rows];
  async function worker(wid) {
    while (queue.length) {
      const r = queue.shift();
      try {
        const val = await rebuildOne(r);
        if (val !== '(empty)') populated++;
        consecutiveFail = 0;
      } catch (e) {
        failed++; consecutiveFail++;
        console.log(`  ! ${r.fields['Company Name'] || r.id}: ${e.message.slice(0, 120)}`);
        if (consecutiveFail >= 12) throw new Error('12 consecutive failures — aborting (likely rate limit / bad key)');
      }
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${rows.length} (populated ${populated}, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  console.log(`DONE: ${done} processed, ${populated} got an intent signal, ${failed} failed`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
