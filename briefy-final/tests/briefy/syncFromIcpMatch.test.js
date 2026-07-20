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

test('creates a new Briefy row for an eligible ICP Match Final row not yet mirrored', async () => {
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
    'Deal Owner': 'Varun Sharma',
    'Deal Stage': 'Demo Scheduled',
    'Deal Link': 'https://app.hubspot.com/contacts/20155995/deal/111',
  });

  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final' ? [icpRecord] : []),
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
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
    'Deal Owner': 'Varun Sharma',
    'Deal Stage': 'Demo Scheduled',
    'Deal Link': 'https://app.hubspot.com/contacts/20155995/deal/111',
    'Brief Status': 'Not Started',
  });
});

test('skips a row whose Deal ID is already mirrored into the Briefy base', async () => {
  const created = [];
  const icpRecord = icpRow({ 'Deal ID': '222', 'Deal Owner': 'Varun Sharma', 'Enriched At': '2026-01-01T00:00:00.000Z' });
  const existingBriefyRow = { id: 'recBriefy1', fields: { 'Deal ID': '222' } };

  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final' ? [icpRecord] : [existingBriefyRow]),
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
  });

  assert.equal(result.checked, 1);
  assert.equal(result.created, 0);
  assert.equal(created.length, 0);
});

test('queries ICP Match Final filtered on Deal Owner and Enriched At both set', async () => {
  let capturedOptions = null;
  await syncFromIcpMatch({
    getRecordsFn: async (table, options) => {
      if (table === 'ICP Match Final') capturedOptions = options;
      return [];
    },
    createRecordFn: async () => {},
    createBaseFn: () => ({}),
  });

  assert.equal(capturedOptions.filterByFormula, `AND({Deal Owner} != '', {Enriched At} != '')`);
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
