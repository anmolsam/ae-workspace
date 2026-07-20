/**
 * Briefy Engine — Airtable Watch Daemon
 *
 * Every N minutes (default 5):
 *   1. syncFromIcpMatch() — mirror any newly-eligible "ICP Match Final" rows
 *      (Deal Owner + Enriched At both set) into the Briefy base
 *   2. Check the Briefy Airtable table for rows with Brief Status in
 *      Not Started / Refreshing / blank
 *   3. For each, build the full brief (briefBuilder.js) and write it back
 *
 * Run manually:
 *   node src/briefy/engine.js
 *
 * Run as a permanent daemon (Railway, same pattern as src/watch.js):
 *   startCommand: node src/briefy/engine.js
 *
 * Env vars:
 *   BRIEFY_AIRTABLE_BASE_ID    — Briefy's OWN Airtable base id (never ICP Match's)
 *   BRIEFY_AIRTABLE_TABLE      — table name within that base (default: "Briefy")
 *   BRIEFY_WATCH_INTERVAL_MIN  — poll interval in minutes (default: 5)
 */
import 'dotenv/config';
import Airtable from 'airtable';
import { buildBrief } from './briefBuilder.js';
import { syncFromIcpMatch } from './syncFromIcpMatch.js';

const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';
const INTERVAL_MIN = parseInt(process.env.BRIEFY_WATCH_INTERVAL_MIN || '5', 10);
const INTERVAL_MS = INTERVAL_MIN * 60_000;

// Briefy's own, separate Airtable base — deliberately not AIRTABLE_BASE_ID (ICP Match's).
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.BRIEFY_AIRTABLE_BASE_ID);

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function getPendingRows() {
  return base(TABLE).select({
    filterByFormula: `OR({Brief Status} = "Not Started", {Brief Status} = "Refreshing", {Brief Status} = "")`,
  }).all();
}

async function tick() {
  const { checked, created } = await syncFromIcpMatch();
  if (created > 0) {
    console.log(`[${ts()}] Synced ${created} new row(s) from ICP Match Final (${checked} checked).`);
  }

  const rows = await getPendingRows();
  if (!rows.length) {
    console.log(`[${ts()}] No pending briefs.`);
    return;
  }

  console.log(`[${ts()}] ${rows.length} pending brief(s) — building...`);
  for (const row of rows) {
    try {
      await base(TABLE).update(row.id, { 'Brief Status': 'Generating' });
      await buildBrief(row);
      console.log(`[${ts()}] Brief built for record ${row.id}`);
    } catch (err) {
      console.error(`[${ts()}] ERROR building brief for ${row.id}: ${err.message}`);
      await base(TABLE).update(row.id, { 'Brief Status': 'Error' }).catch(() => {});
    }
  }
}

async function main() {
  console.log(`[${ts()}] Briefy engine started`);
  console.log(`[${ts()}] Table    : ${TABLE}`);
  console.log(`[${ts()}] Interval : every ${INTERVAL_MIN} min\n`);

  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error(`[${ts()}] Fatal tick error: ${err.message}`);
    }
    console.log(`[${ts()}] Next cycle in ${INTERVAL_MIN} min\n`);
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

main().catch(err => {
  console.error(`[${ts()}] Fatal: ${err.message}`);
  process.exit(1);
});
