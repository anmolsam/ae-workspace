import { getRecords, createRecord, createBase } from '../lib/airtable.js';

const ICP_MATCH_TABLE = 'ICP Match Final';
const BRIEFY_TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

function seedFieldsFrom(icpRecord) {
  const f = icpRecord.fields;
  return {
    'Deal ID': f['Deal ID'] || '',
    'Deal Name': f['Deal Name'] || '',
    'Company Name': f['Company Name'] || '',
    'Company Domain': f['Company domain'] || '',
    'IP State': f['IP State'] || '',
    'IP Country': f['IP Country'] || '',
    'Meeting Date & Time': f['Meeting Date & Time'] ?? null,
    'Exa Content': f['Exa Content'] || '',
    'Pages Scraped': f['Pages Scraped'] || '',
    'Trade Category': f['Trade Category'] || '',
    'ICP Enriched At': f['Enriched At'] || null,
    'Deal Owner': f['Deal Owner'] || '',
    'Deal Stage': f['Deal Stage'] || '',
    'Deal Link': f['Deal Link'] || '',
    'Brief Status': 'Not Started',
  };
}

/**
 * Mirror eligible "ICP Match Final" rows (Deal Owner + Enriched At both set) into
 * Briefy's own Airtable base, skipping any deal already mirrored (matched by Deal ID).
 * Replaces the need for a separate HubSpot -> Airtable workflow for Briefy.
 * @param {object} [deps] - optional overrides for testing
 * @returns {Promise<{checked: number, created: number}>}
 */
export async function syncFromIcpMatch(deps = {}) {
  const {
    getRecordsFn = getRecords,
    createRecordFn = createRecord,
    createBaseFn = createBase,
  } = deps;

  const briefyBase = deps.briefyBase || createBaseFn(process.env.BRIEFY_AIRTABLE_BASE_ID);

  const icpRows = await getRecordsFn(ICP_MATCH_TABLE, {
    filterByFormula: `AND({Deal Owner} != '', {Enriched At} != '')`,
  });

  const existingRows = await getRecordsFn(BRIEFY_TABLE, {}, briefyBase);
  const existingDealIds = new Set(existingRows.map(r => r.fields['Deal ID']).filter(Boolean));

  let created = 0;
  for (const icpRow of icpRows) {
    const dealId = icpRow.fields['Deal ID'];
    if (!dealId || existingDealIds.has(dealId)) continue;

    await createRecordFn(BRIEFY_TABLE, seedFieldsFrom(icpRow), briefyBase);
    created += 1;
  }

  return { checked: icpRows.length, created };
}
