import { getRecords, createRecord, createBase } from '../lib/airtable.js';
import { getDeal, getOwnerName } from '../lib/hubspot.js';

const ICP_MATCH_TABLE = 'ICP Match Final';
const BRIEFY_TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

// Optional owner allowlist (comma-separated Deal Owner names). When set, only
// deals owned by these AEs are mirrored — used to roll Briefy out per-AE and
// control enrichment cost. Empty = mirror every resolvable owner.
const OWNER_ALLOWLIST = (process.env.BRIEFY_SYNC_OWNER_ALLOWLIST || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Coerce ICP Match's "Meeting Date & Time" (stored as text) into the epoch-ms
 *  number the Briefy column expects; null when absent/unparseable. */
function coerceMeetingMs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

function seedFieldsFrom(icpRecord, dealOwner) {
  const f = icpRecord.fields;
  return {
    'Deal ID': f['Deal ID'] || '',
    'Deal Name': f['Deal Name'] || '',
    'Company Name': f['Company Name'] || '',
    'Company Domain': f['Company domain'] || '',
    'IP State': f['IP State'] || '',
    'IP Country': f['IP Country'] || '',
    'Meeting Date & Time': coerceMeetingMs(f['Meeting Date & Time']),
    'Exa Content': f['Exa Content'] || '',
    'Pages Scraped': f['Pages Scraped'] || '',
    'Trade Category': f['Trade Category'] || '',
    // Enriched At is copied from ICP Match into Briefy's own ICP Enriched At.
    'ICP Enriched At': f['Enriched At'] || null,
    // Deal Owner is RESOLVED from HubSpot (ICP Match's own field is blank);
    // written into Briefy only — ICP Match is never modified.
    'Deal Owner': dealOwner || '',
    'Deal Stage': f['Deal Stage'] || '',
    'Deal Link': f['Deal Link'] || '',
    'Brief Status': 'Not Started',
  };
}

/**
 * Resolve a HubSpot deal's owner display name from its Deal ID.
 * @param {string} dealId
 * @returns {Promise<string>} owner name, or '' if none / unresolvable
 */
async function defaultResolveOwner(dealId) {
  try {
    const deal = await getDeal(dealId, ['hubspot_owner_id']);
    const ownerId = deal?.properties?.hubspot_owner_id;
    return ownerId ? await getOwnerName(ownerId) : '';
  } catch {
    return '';
  }
}

/**
 * Mirror enriched "ICP Match Final" rows into Briefy's own base, resolving each
 * deal's owner from HubSpot (ICP Match's Deal Owner field is left untouched and
 * is typically blank). Skips deals already mirrored (by Deal ID), any deal with
 * no resolvable owner, and (if set) any owner outside the allowlist.
 *
 * Reads ICP Match Final; writes only to the Briefy base. Never modifies ICP Match.
 *
 * @param {object} [deps] - optional overrides for testing / scoped runs
 * @returns {Promise<{checked: number, created: number}>}
 */
export async function syncFromIcpMatch(deps = {}) {
  const {
    getRecordsFn = getRecords,
    createRecordFn = createRecord,
    createBaseFn = createBase,
    resolveOwnerFn = defaultResolveOwner,
    ownerAllowlist = OWNER_ALLOWLIST,
    dealIdFilter = null, // optional array/Set of Deal IDs to restrict to
    maxCreate = Infinity,
  } = deps;

  const briefyBase = deps.briefyBase || createBaseFn(process.env.BRIEFY_AIRTABLE_BASE_ID);

  // Source gate: enriched + has a Deal ID. NOT gated on ICP Match's Deal Owner
  // (blank in the source); owner is resolved below from HubSpot.
  const icpRows = await getRecordsFn(ICP_MATCH_TABLE, {
    filterByFormula: `AND({Enriched At} != '', {Deal ID} != '')`,
  });

  const existingRows = await getRecordsFn(BRIEFY_TABLE, {}, briefyBase);
  const existingDealIds = new Set(existingRows.map((r) => r.fields['Deal ID']).filter(Boolean));
  const allow = dealIdFilter ? new Set(dealIdFilter) : null;
  const allowOwners = new Set(ownerAllowlist);

  let created = 0;
  for (const icpRow of icpRows) {
    if (created >= maxCreate) break;
    const dealId = icpRow.fields['Deal ID'];
    if (!dealId || existingDealIds.has(dealId)) continue;
    if (allow && !allow.has(dealId)) continue;

    const dealOwner = await resolveOwnerFn(dealId);
    if (!dealOwner) continue; // unowned -> not actionable for any AE
    if (allowOwners.size && !allowOwners.has(dealOwner.toLowerCase())) continue;

    await createRecordFn(BRIEFY_TABLE, seedFieldsFrom(icpRow, dealOwner), briefyBase);
    existingDealIds.add(dealId);
    created += 1;
  }

  return { checked: icpRows.length, created };
}
