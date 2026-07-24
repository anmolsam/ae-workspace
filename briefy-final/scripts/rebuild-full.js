// Full brief rebuild (ALL 7 sections, all APIs) for one AE's in-scope briefs.
// Fills every gap: overview/portfolio (Jina+LLM), org tree + company/revenue
// (ZoomInfo MCP), HubSpot signals, hiring (SerpAPI), intent (Jina+LLM).
//
// Usage:  node scripts/rebuild-full.js "<owner name substring>" [future|inwindow|all]
import { buildBrief } from '../src/briefy/briefBuilder.js';

const OWNER = (process.argv[2] || '').trim();
const SCOPE = (process.argv[3] || 'future').toLowerCase();
const TOKEN = process.env.AIRTABLE_API_KEY;
const BASE = process.env.BRIEFY_AIRTABLE_BASE_ID;
const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';
const API = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const NOW = Date.now();
const PAST = NOW - 3 * 86400000;
const FUT = NOW + 21 * 86400000;
const TODAY_START = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

async function listRows() {
  const rows = [];
  let offset;
  do {
    const res = await fetch(`${API}?pageSize=100${offset ? `&offset=${offset}` : ''}`, { headers: H });
    if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
    const d = await res.json();
    rows.push(...d.records);
    offset = d.offset;
  } while (offset);
  return rows;
}

function target(r) {
  const f = r.fields;
  if (OWNER && !(f['Deal Owner'] || '').toLowerCase().includes(OWNER.toLowerCase())) return false;
  if (f['Brief Status'] !== 'Ready' && f['Brief Status'] !== 'Error') return false;
  if (SCOPE === 'all') return true;
  const m = Number(f['Meeting Date & Time']);
  if (!Number.isFinite(m)) return false;
  if (SCOPE === 'inwindow') return m >= PAST && m <= FUT;
  return m >= TODAY_START;
}

async function main() {
  if (!OWNER) throw new Error('pass an owner name substring');
  console.log(`owner="${OWNER}" scope=${SCOPE} | listing...`);
  const rows = (await listRows()).filter(target);
  console.log(`${rows.length} briefs to fully rebuild:`);
  rows.forEach((r) => console.log(`  - ${r.fields['Company Name'] || r.fields['Deal Name'] || r.id} (${r.fields['Company Domain'] || 'no domain'})`));
  let ok = 0, failed = 0;
  // Sequential — full builds are heavy and share the low ZoomInfo rate limit.
  for (const r of rows) {
    const label = r.fields['Company Name'] || r.fields['Deal Name'] || r.id;
    try {
      await buildBrief(r);
      ok++;
      console.log(`  ✓ ${label}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${label}: ${e.message.slice(0, 140)}`);
    }
  }
  console.log(`DONE: ${ok} rebuilt, ${failed} failed`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
