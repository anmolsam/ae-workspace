/**
 * ICP Match Watch Daemon
 *
 * Every N minutes (default 5):
 *   1. Check Airtable "ICP Match Final" for new rows with no Exa Content yet
 *   2. If found → run icp-final.js to classify them (Exa→Firecrawl→ZoomInfo→SerpAPI→Gemini)
 *   3. Always → run push-to-hubspot.js to sync any changed records to HubSpot
 *
 * Run manually:
 *   node src/watch.js
 *
 * Run as a permanent daemon (survives reboots):
 *   pm2 start src/watch.js --name icp-match --interpreter node
 *   pm2 startup && pm2 save
 *
 * Env vars:
 *   WATCH_INTERVAL_MIN  — poll interval in minutes (default: 5)
 */
import 'dotenv/config';
import Airtable from 'airtable';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const TABLE        = 'ICP Match Final';
const INTERVAL_MIN = parseInt(process.env.WATCH_INTERVAL_MIN || '5', 10);
const INTERVAL_MS  = INTERVAL_MIN * 60_000;
const __dirname    = path.dirname(fileURLToPath(import.meta.url));

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// Check if any row has a domain but no Exa Content yet (i.e. needs analysis)
async function hasPending() {
  const rows = await base(TABLE).select({
    filterByFormula: `AND(
      {Company domain} != "",
      {Company domain} != "undefined",
      {Exa Content} = "",
      {Personal Email} != TRUE()
    )`,
    fields: ['Company domain'],
    maxRecords: 1,
  }).firstPage();
  return rows.length > 0;
}

// Spawn a node script and wait for it to exit
function run(file, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(__dirname, file), ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    proc.on('close', code => resolve(code));
    proc.on('error', reject);
  });
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function tick() {
  // Step 1 — run ICP pipeline if there are new rows to classify
  const pending = await hasPending();
  if (pending) {
    console.log(`\n[${ts()}] New rows detected — running ICP analysis pipeline...`);
    await run('icp-final.js');
    console.log(`[${ts()}] Pipeline done.`);
  }

  // Step 2 — always sync Airtable → HubSpot (only pushes records that changed since last sync)
  console.log(`[${ts()}] Syncing to HubSpot...`);
  await run('push-to-hubspot.js');
}

async function main() {
  console.log(`[${ts()}] ICP Match daemon started`);
  console.log(`[${ts()}] Table    : ${TABLE}`);
  console.log(`[${ts()}] Interval : every ${INTERVAL_MIN} min`);
  console.log(`[${ts()}] Cycle    : check new rows → analyze if any → always sync HubSpot\n`);

  // Run immediately on start, then on interval
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error(`[${ts()}] ERROR: ${err.message}`);
    }
    console.log(`[${ts()}] Next cycle in ${INTERVAL_MIN} min\n`);
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

main().catch(err => {
  console.error(`[${ts()}] Fatal: ${err.message}`);
  process.exit(1);
});
