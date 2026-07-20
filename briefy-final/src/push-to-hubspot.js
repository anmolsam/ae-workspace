/**
 * push-to-hubspot.js
 *
 * Reads ICP analysis results from Airtable "ICP Match Final" and pushes them
 * into the corresponding HubSpot deal whenever ICP Status is populated.
 *
 * Airtable → HubSpot field mapping:
 *   ICP Status       → icp_match__automated      (dropdown — mapped to allowed values)
 *   Trade Category   → icp_match__trade_category  (text)
 *   Data Source      → icp_match_source           (text)
 *   Fit Reason
 *   + Matched Keywords
 *   + Exa Content
 *   + Pages Scraped  → icp_match_reason           (combined multi-line text)
 *
 * Matching: uses the "HubSpot Deal ID" field (or AIRTABLE_HUBSPOT_DEAL_ID_FIELD env var)
 *   already stored on each Airtable record.
 *
 * Idempotency: PATCH is safe to rerun — same value written twice is a no-op in HubSpot.
 *   The script also writes "ICP Synced At" back to Airtable after each successful push
 *   so watch mode can detect which records actually changed.
 *
 * Usage:
 *   node src/push-to-hubspot.js              # sync all ready records once
 *   node src/push-to-hubspot.js --dry-run    # preview without writing to HubSpot
 *   node src/push-to-hubspot.js --watch      # keep polling and syncing (every 5 min)
 *   HUBSPOT_SYNC_INTERVAL_MIN=10 node src/push-to-hubspot.js --watch
 *
 * Required env vars:
 *   HUBSPOT_API_KEY                — HubSpot Private App token (pat-na1-…) or legacy hapikey
 *   AIRTABLE_API_KEY               — Airtable personal access token
 *   AIRTABLE_BASE_ID               — Airtable base ID
 *
 * Optional env vars:
 *   AIRTABLE_HUBSPOT_DEAL_ID_FIELD — name of the Airtable field storing HubSpot Deal ID
 *                                    (default: "HubSpot Deal ID")
 *   HUBSPOT_SYNC_INTERVAL_MIN      — watch mode poll interval in minutes (default: 5)
 */
import 'dotenv/config';
import Airtable from 'airtable';
import { updateDeal, searchDealByName, findDealIdByDomain } from './lib/hubspot.js';

// Cache deal name → HubSpot ID lookups within a single sync run to avoid duplicate searches
const dealIdCache = new Map();
// Cache company domain → HubSpot ID lookups for the same reason
const domainIdCache = new Map();

// ── Config ───────────────────────────────────────────────────────────────────

const TABLE          = 'ICP Match Final';
const DEAL_ID_FIELD  = process.env.AIRTABLE_HUBSPOT_DEAL_ID_FIELD || 'HubSpot Deal ID';
const INTERVAL_MIN   = parseInt(process.env.HUBSPOT_SYNC_INTERVAL_MIN || '5', 10);
const INTERVAL_MS    = INTERVAL_MIN * 60_000;

// HubSpot text fields have a 65,535 char limit; we cap the combined reason field conservatively.
const MAX_REASON_CHARS = 60_000;

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ── ICP Status: Airtable value → HubSpot dropdown internal value ─────────────
//
// HubSpot field: icp_match__automated
// The dropdown internal value and display label are identical (per user spec).
//
// Any Airtable status NOT in this map is logged as skipped — never pushed.
const STATUS_MAP = {
  'ICP - Contractor':                         'ICP - Contractor',
  'ICP - Supplier':                           'ICP - Supplier',
  'ICP - Both':                               'ICP - Both',
  'Partial ICP':                              'Partial ICP',
  'Non-ICP - Company type mismatch':          'Non ICP - Company type mismatch',
  'Non-ICP - Trade or work-type exclusions':  'Non ICP - Trade / work-type exclusions',
  'Non-ICP - Business viability exclusions':  'Non ICP - Volume / business viability',
  'Non-ICP - Language or geography mismatch': 'Non ICP - Language / geography mismatch',
  'Non-ICP - Lead quality exclusions':        'Non ICP - Lead quality',
  'Non-ICP - Need mismatch':                  'Non ICP - Need mismatch',
  // Legacy "Not ICP" label used before granular categories were introduced
  'Not ICP':                                  'Non ICP - hard-disqualifiers',
};

// Statuses that exist in Airtable but have no HubSpot equivalent — skip silently
const NO_HUBSPOT_MAPPING = new Set(['Not Found']);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the combined icp_match_reason text from four Airtable fields.
 * Truncates to MAX_REASON_CHARS to stay within HubSpot's field limit.
 */
function buildReason(fields) {
  const sections = [
    ['Fit reason',        fields['Fit Reason']],
    ['Matched keywords',  fields['Matched Keywords']],
    ['Exa content',       fields['Exa Content']],
    ['Pages scrapped',    fields['Pages Scraped']],
  ];

  const body = sections
    .filter(([, v]) => v && String(v).trim())
    .map(([label, v])  => `${label}:\n${String(v).trim()}`)
    .join('\n\n');

  if (body.length <= MAX_REASON_CHARS) return body;

  return (
    body.slice(0, MAX_REASON_CHARS - 100) +
    `\n\n[... truncated — full content in Airtable (${body.length.toLocaleString()} chars total)]`
  );
}

/** True if the record needs to be synced (Enriched At is newer than ICP Synced At, or never synced). */
function needsSync(fields) {
  const syncedAt   = fields['ICP Synced At'];
  const enrichedAt = fields['Enriched At'];
  if (!syncedAt) return true;                         // never synced
  if (!enrichedAt) return true;                       // no enrichment timestamp — sync to be safe
  return new Date(enrichedAt) > new Date(syncedAt);   // enriched more recently than last sync
}

/**
 * Write the sync timestamp (and optionally a backfilled HubSpot Deal ID) back to Airtable.
 * Writes each field independently so a missing optional field (e.g. "ICP Synced At" not yet
 * created) doesn't block writing the others.
 */
async function markSynced(recordId, extraFields = {}) {
  const fields = { 'ICP Synced At': new Date().toISOString(), ...extraFields };

  // First, try the combined update — works when all fields exist on the table.
  try {
    await base(TABLE).update(recordId, fields);
    return;
  } catch (err) {
    if (!/Unknown field name/i.test(err.message)) {
      // Real error (auth, network, etc) — surface it once and bail.
      console.warn(`  WARN   could not update Airtable ${recordId}: ${err.message}`);
      return;
    }
  }

  // Some field doesn't exist — retry each one individually so the others still get written.
  for (const [k, v] of Object.entries(fields)) {
    try {
      await base(TABLE).update(recordId, { [k]: v });
    } catch {
      // Field doesn't exist on the table — silently skip (non-fatal).
    }
  }
}

/** Short timestamp for log lines. */
function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ── Core sync ─────────────────────────────────────────────────────────────────

async function syncOnce({ dryRun }) {
  // Fetch all Airtable records that have ICP Status set.
  // No fields filter — Airtable returns all columns that exist on the table.
  // This is robust to optional fields (HubSpot Deal ID, ICP Synced At) that may not
  // exist yet; missing fields simply come back as undefined.
  const allRecords = [];
  await base(TABLE).select({
    filterByFormula: `{ICP Status} != ""`,
  }).eachPage((page, next) => { allRecords.push(...page); next(); });

  // In watch mode the caller sets onlyChanged; in one-shot mode sync everything.
  const toSync = allRecords.filter(r => needsSync(r.fields));

  console.log(`  Found ${allRecords.length} record(s) with ICP Status — ${toSync.length} need sync`);

  const counts = { ok: 0, skipped: 0, failed: 0 };

  for (const r of toSync) {
    const f        = r.fields;
    const company  = (f['Company Name'] || f['Deal Name'] || f['Company domain'] || '').slice(0, 40);
    const dealId   = String(f[DEAL_ID_FIELD] || '').trim();
    const status   = (f['ICP Status'] || '').trim();

    // ── Resolve HubSpot deal ID
    // Priority 1: use the stored Deal ID if Airtable already has it (fastest, most reliable)
    // Priority 2: search HubSpot by deal name (works when dealname includes company)
    // Priority 3: search HubSpot by company domain via associated contacts
    //            (catches deals with broken names like " - Shelby" that have no company in dealname)
    // When 2 or 3 succeeds, write the ID back to Airtable so future syncs skip straight to Priority 1.
    let resolvedDealId = dealId;
    let backfillDealId = false;

    if (!resolvedDealId) {
      const rawDealName   = (f['Deal Name'] || '').trim();
      const companyInName = rawDealName.split(' - ')[0].trim(); // part before " - AEName"
      const searchName    = companyInName
        ? rawDealName                           // full "Company - AEName" → exact HubSpot match
        : (f['Company Name'] || '').trim();     // Deal Name had no company part, try Company Name
      const domain        = (f['Company domain'] || '').toLowerCase().trim();

      // Priority 2 — deal-name search
      if (searchName) {
        if (dealIdCache.has(searchName)) {
          resolvedDealId = dealIdCache.get(searchName);
        } else {
          try {
            resolvedDealId = await searchDealByName(searchName);
            dealIdCache.set(searchName, resolvedDealId);
          } catch (err) {
            console.error(`  FAIL   ${company.padEnd(42)} | HubSpot name search error: ${err.message}`);
            counts.failed++;
            continue;
          }
        }
      }

      // Priority 3 — domain search fallback (when name search returns nothing)
      if (!resolvedDealId && domain) {
        if (domainIdCache.has(domain)) {
          resolvedDealId = domainIdCache.get(domain);
        } else {
          try {
            resolvedDealId = await findDealIdByDomain(domain);
            domainIdCache.set(domain, resolvedDealId);
            if (resolvedDealId) {
              console.log(`  FOUND  ${company.padEnd(42)} | domain "${domain}" → deal ${resolvedDealId}`);
            }
          } catch (err) {
            console.error(`  FAIL   ${company.padEnd(42)} | HubSpot domain search error: ${err.message}`);
            counts.failed++;
            continue;
          }
        }
      }

      if (!resolvedDealId) {
        const tried = [searchName && `name "${searchName}"`, domain && `domain "${domain}"`]
          .filter(Boolean).join(' or ');
        console.log(`  SKIP   ${company.padEnd(42)} | no HubSpot deal found by ${tried || 'name/domain'}`);
        counts.skipped++;
        continue;
      }

      // We resolved the deal via search — backfill it into Airtable so the next sync uses ID match.
      backfillDealId = true;
    }

    // ── Guard: status that has no HubSpot equivalent (ICP - Both, Not Found, etc.)
    if (NO_HUBSPOT_MAPPING.has(status)) {
      console.log(`  SKIP   ${company.padEnd(42)} | "${status}" — no HubSpot mapping defined`);
      counts.skipped++;
      continue;
    }

    // ── Guard: unknown / invalid status
    const hsStatus = STATUS_MAP[status];
    if (!hsStatus) {
      console.log(`  SKIP   ${company.padEnd(42)} | unknown ICP Status: "${status}"`);
      counts.skipped++;
      continue;
    }

    // ── Build the four HubSpot properties
    const properties = {
      icp_match__automated:      hsStatus,
      icp_match__trade_category: f['Trade Category'] || '',
      icp_match_source:          f['Data Source']    || '',
      icp_match_reason:          buildReason(f),
    };

    if (dryRun) {
      console.log(`  DRY    ${company.padEnd(42)} | deal ${resolvedDealId} | ${status} → ${hsStatus}`);
      counts.ok++;
      continue;
    }

    // ── Push to HubSpot
    try {
      await updateDeal(resolvedDealId, properties);
      // When we resolved the deal via search, persist the ID so future syncs skip the search
      const extras = backfillDealId ? { [DEAL_ID_FIELD]: resolvedDealId } : {};
      await markSynced(r.id, extras);
      const tag = backfillDealId ? '+ID' : '   ';
      console.log(`  OK ${tag} ${company.padEnd(42)} | deal ${resolvedDealId} | ${status} → ${hsStatus}`);
      counts.ok++;
    } catch (err) {
      console.error(`  FAIL   ${company.padEnd(42)} | deal ${resolvedDealId} | ${err.message}`);
      counts.failed++;
    }

    // Stay well within HubSpot's default 10 req/s rate limit
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`  ─── ok: ${counts.ok}  skipped: ${counts.skipped}  failed: ${counts.failed}\n`);
  return counts;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const args      = process.argv.slice(2);
  const dryRun    = args.includes('--dry-run');
  const watchMode = args.includes('--watch');

  if (!process.env.HUBSPOT_API_KEY) {
    console.error('[push-to-hubspot] ERROR: HUBSPOT_API_KEY is not set in .env');
    process.exit(1);
  }

  if (dryRun)    console.log('[push-to-hubspot] DRY RUN — no writes to HubSpot or Airtable\n');
  if (watchMode) console.log(`[push-to-hubspot] Watch mode — polling every ${INTERVAL_MIN} min\n`);

  do {
    console.log(`[${ts()}] Syncing Airtable → HubSpot...`);
    dealIdCache.clear();   // reset per-run name→ID cache
    domainIdCache.clear(); // reset per-run domain→ID cache
    try {
      await syncOnce({ dryRun });
    } catch (err) {
      console.error(`[${ts()}] Sync error: ${err.message}`);
    }

    if (watchMode) await new Promise(r => setTimeout(r, INTERVAL_MS));
  } while (watchMode);
}

main().catch(err => {
  console.error('[push-to-hubspot] Fatal:', err.message);
  process.exit(1);
});
