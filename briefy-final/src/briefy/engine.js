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
 * The copier (syncFromIcpMatch) runs EVERY tick — it is cheap (HubSpot owner
 * lookup + Airtable writes, no research APIs) so the two bases stay in sync.
 * The BUILD step is throttled: only pending briefs for meetings inside the
 * build window (recent past .. near future) are built, at most N per tick,
 * soonest-meeting first. This keeps research-API spend (Exa/SerpAPI/ZoomInfo)
 * bounded to the pre-calls that actually matter and prevents the backlog from
 * ever blowing the quotas again.
 *
 * Env vars:
 *   BRIEFY_AIRTABLE_BASE_ID    — Briefy's OWN Airtable base id (never ICP Match's)
 *   BRIEFY_AIRTABLE_TABLE      — table name within that base (default: "Briefy")
 *   BRIEFY_WATCH_INTERVAL_MIN  — poll interval in minutes (default: 5)
 *   BRIEFY_SYNC_OWNER_ALLOWLIST— comma-separated AE names to copy (empty = all)
 *   BRIEFY_MAX_BUILDS_PER_TICK — max briefs to build per tick (default: 3)
 *   BRIEFY_BUILD_PAST_DAYS     — build briefs for meetings up to N days past (default: 3)
 *   BRIEFY_BUILD_FUTURE_DAYS   — ...and up to N days ahead (default: 21)
 */
import 'dotenv/config';
import Airtable from 'airtable';
import { buildBrief } from './briefBuilder.js';
import { syncFromIcpMatch } from './syncFromIcpMatch.js';

const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';
const INTERVAL_MIN = parseInt(process.env.BRIEFY_WATCH_INTERVAL_MIN || '5', 10);
const INTERVAL_MS = INTERVAL_MIN * 60_000;
const MAX_BUILDS_PER_TICK = parseInt(process.env.BRIEFY_MAX_BUILDS_PER_TICK || '3', 10);
const BUILD_PAST_MS = parseInt(process.env.BRIEFY_BUILD_PAST_DAYS || '3', 10) * 86_400_000;
const BUILD_FUTURE_MS = parseInt(process.env.BRIEFY_BUILD_FUTURE_DAYS || '21', 10) * 86_400_000;

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

/** Only build briefs for meetings inside the window (recent past .. near future).
 *  A pre-call brief for a demo months ago is not worth research-API spend. */
function inBuildWindow(row) {
  const t = typeof row.fields['Meeting Date & Time'] === 'number' ? row.fields['Meeting Date & Time'] : null;
  if (t == null) return false;
  const now = Date.now();
  return t >= now - BUILD_PAST_MS && t <= now + BUILD_FUTURE_MS;
}

async function tick() {
  // 1. Copier — always runs. Cheap; keeps the Briefy base in sync with ICP Match.
  const { checked, created } = await syncFromIcpMatch();
  if (created > 0) {
    console.log(`[${ts()}] Copied ${created} new row(s) from ICP Match Final (${checked} checked).`);
  }

  // 2. Build — throttled: only near-term meetings, soonest first, capped per tick.
  const pending = await getPendingRows();
  const buildable = pending
    .filter(inBuildWindow)
    .sort((a, b) => a.fields['Meeting Date & Time'] - b.fields['Meeting Date & Time']);

  if (!buildable.length) {
    console.log(`[${ts()}] No in-window briefs to build (${pending.length} pending overall).`);
    return;
  }

  const batch = buildable.slice(0, MAX_BUILDS_PER_TICK);
  console.log(`[${ts()}] ${buildable.length} in-window pending; building ${batch.length} this tick (throttled, soonest first).`);
  for (const row of batch) {
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
