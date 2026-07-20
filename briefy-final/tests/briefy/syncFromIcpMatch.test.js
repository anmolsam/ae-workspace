import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set environment variables before importing to avoid eager Airtable base creation
process.env.AIRTABLE_API_KEY = 'test-key';
process.env.AIRTABLE_BASE_ID = 'test-base-id';
process.env.BRIEFY_AIRTABLE_BASE_ID = 'test-briefy-base-id';

const { syncFromIcpMatch } = await import('../../src/briefy/syncFromIcpMatch.js');

function icpRow(fields) {
  return { id: `rec_icp_${fields['Deal ID']}`, fields };
}

test('mirrors an enriched ICP Match row, resolving Deal Owner from HubSpot (ICP Match untouched)', async () => {
  const created = [];
  const icpRecord = icpRow({
    'Deal ID': '111',
    'Deal Name': 'Acme - Jane',
    'Company Name': 'Acme Roofing',
    'Company domain': 'acmeroofing.com',
    'IP State': 'Texas',
    'IP Country': 'United States',
    'Meeting Date & Time': 1782830700000,
    'Exa Content': 'scraped site text...',
    'Pages Scraped': 'https://acmeroofing.com\nhttps://acmeroofing.com/about',
    'Trade Category': 'Roofing',
    'Enriched At': '2026-01-01T00:00:00.000Z',
    // NOTE: ICP Match's own Deal Owner is blank — owner comes from HubSpot.
    'Deal Owner': '',
    'Deal Stage': 'Demo Scheduled',
    'Deal Link': 'https://app.hubspot.com/contacts/20155995/deal/111',
  });

  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final' ? [icpRecord] : []),
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
    resolveOwnerFn: async (dealId) => (dealId === '111' ? 'Varun Sharma' : ''),
    ownerAllowlist: [], // explicit: don't inherit a dev .env allowlist
  });

  assert.equal(result.checked, 1);
  assert.equal(result.created, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].table, 'Briefy');
  assert.deepEqual(created[0].fields, {
    'Deal ID': '111',
    'Deal Name': 'Acme - Jane',
    'Company Name': 'Acme Roofing',
    'Company Domain': 'acmeroofing.com',
    'IP State': 'Texas',
    'IP Country': 'United States',
    'Meeting Date & Time': 1782830700000,
    'Exa Content': 'scraped site text...',
    'Pages Scraped': 'https://acmeroofing.com\nhttps://acmeroofing.com/about',
    'Trade Category': 'Roofing',
    'ICP Enriched At': '2026-01-01T00:00:00.000Z',
    'Deal Owner': 'Varun Sharma', // resolved from HubSpot, not copied from source
    'Deal Stage': 'Demo Scheduled',
    'Deal Link': 'https://app.hubspot.com/contacts/20155995/deal/111',
    'Brief Status': 'Not Started',
  });
});

test('skips a deal with no resolvable owner', async () => {
  const created = [];
  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final'
      ? [icpRow({ 'Deal ID': '333', 'Enriched At': '2026-01-01T00:00:00.000Z' })] : []),
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
    resolveOwnerFn: async () => '', // unowned
  });
  assert.equal(result.created, 0);
  assert.equal(created.length, 0);
});

test('respects the owner allowlist', async () => {
  const created = [];
  const rows = [
    icpRow({ 'Deal ID': 'a', 'Enriched At': 't' }),
    icpRow({ 'Deal ID': 'b', 'Enriched At': 't' }),
  ];
  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final' ? rows : []),
    createRecordFn: async (table, fields) => { created.push(fields); },
    createBaseFn: () => ({}),
    resolveOwnerFn: async (id) => (id === 'a' ? 'Sidharth S' : 'Someone Else'),
    ownerAllowlist: ['sidharth s'],
  });
  assert.equal(result.created, 1);
  assert.equal(created[0]['Deal Owner'], 'Sidharth S');
});

test('skips a row whose Deal ID is already mirrored into the Briefy base', async () => {
  const created = [];
  const icpRecord = icpRow({ 'Deal ID': '222', 'Enriched At': '2026-01-01T00:00:00.000Z' });
  const existingBriefyRow = { id: 'recBriefy1', fields: { 'Deal ID': '222' } };

  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final' ? [icpRecord] : [existingBriefyRow]),
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
    resolveOwnerFn: async () => 'Varun Sharma',
  });

  assert.equal(result.checked, 1);
  assert.equal(result.created, 0);
  assert.equal(created.length, 0);
});

test('queries ICP Match Final filtered on Enriched At and Deal ID (not Deal Owner)', async () => {
  let capturedOptions = null;
  await syncFromIcpMatch({
    getRecordsFn: async (table, options) => {
      if (table === 'ICP Match Final') capturedOptions = options;
      return [];
    },
    createRecordFn: async () => {},
    createBaseFn: () => ({}),
  });

  assert.equal(capturedOptions.filterByFormula, `AND({Enriched At} != '', {Deal ID} != '')`);
});

test('handles zero eligible rows without creating anything', async () => {
  const created = [];
  const result = await syncFromIcpMatch({
    getRecordsFn: async () => [],
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
  });

  assert.equal(result.checked, 0);
  assert.equal(result.created, 0);
  assert.equal(created.length, 0);
});
