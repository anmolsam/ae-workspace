import { test } from 'node:test';
import assert from 'node:assert/strict';

// src/briefy/briefBuilder.js imports airtable.js, which constructs its default
// Airtable connection eagerly at module-evaluation time. Dynamic import is needed
// to sequence environment variable setup before module evaluation.
process.env.AIRTABLE_API_KEY = 'test-key';
process.env.AIRTABLE_BASE_ID = 'test-base-id';
process.env.BRIEFY_AIRTABLE_BASE_ID = 'test-briefy-base-id';

const { buildBrief } = await import('../../src/briefy/briefBuilder.js');

test('writes sections and Ready status for a resolved domain', async () => {
  const writes = [];
  const record = { id: 'rec1', fields: { 'Deal ID': '999', 'Company Domain': 'acme.com', 'Company Name': 'Acme', 'Exa Content': 'existing content' } };

  await buildBrief(record, {
    resolveCompanyFn: () => ({ domain: 'acme.com', status: 'resolved' }),
    buildOverviewFn: async () => ({ overview: 'Acme builds things.', portfolio: '', status: 'ready' }),
    buildOrgTreeFn: async () => ({ orgTree: { estimators: [], programManagers: [], upperManagement: [] }, status: 'ready' }),
    buildRevenueFn: async () => ({ zoomInfoRevenue: '$5M-$10M', clayRevenue: 'pending', status: 'ready' }),
    buildHubspotSignalsFn: async () => ({ lastPageVisited: '/pricing', lastPageVisitedAt: '2026-01-01T00:00:00Z', priorDeals: [], status: 'ready' }),
    buildHiringSignalsFn: async () => ({ openRoles: [], status: 'ready' }),
    buildIntentFn: async () => ({ intentScore: '85', status: 'ready' }),
    updateRecordFn: async (table, id, fields) => { writes.push({ table, id, fields }); },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'Briefy');
  assert.equal(writes[0].id, 'rec1');
  assert.equal(writes[0].fields['Brief Status'], 'Ready');
  assert.equal(writes[0].fields['Company Overview'], 'Acme builds things.');
  assert.equal(writes[0].fields['ZoomInfo Revenue'], '$5M-$10M');
  assert.equal(writes[0].fields['ZoomInfo Intent Score'], '85');
  const sectionStatus = JSON.parse(writes[0].fields['Section Status']);
  assert.equal(sectionStatus.revenue, 'ready');
});

test('marks the row Error and skips sections entirely when no domain resolves', async () => {
  const writes = [];
  const record = { id: 'rec2', fields: { 'Deal ID': '1000', 'Company Domain': '' } };

  await buildBrief(record, {
    resolveCompanyFn: () => ({ domain: null, status: 'not_found' }),
    updateRecordFn: async (table, id, fields) => { writes.push({ table, id, fields }); },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].fields['Brief Status'], 'Error');
});

test('passes the seeded Exa Content and Company Name through to the relevant sections', async () => {
  let receivedOverviewArgs, receivedHiringArgs;
  const record = { id: 'rec3', fields: { 'Deal ID': '1001', 'Company Domain': 'acme.com', 'Company Name': 'Acme Roofing', 'Exa Content': 'pre-scraped text' } };

  await buildBrief(record, {
    resolveCompanyFn: () => ({ domain: 'acme.com', status: 'resolved' }),
    buildOverviewFn: async (domain, existingExaContent) => {
      receivedOverviewArgs = { domain, existingExaContent };
      return { overview: '', portfolio: '', status: 'ready' };
    },
    buildOrgTreeFn: async () => ({ orgTree: { estimators: [], programManagers: [], upperManagement: [] }, status: 'ready' }),
    buildRevenueFn: async () => ({ zoomInfoRevenue: '', clayRevenue: '', status: 'ready' }),
    buildHubspotSignalsFn: async () => ({ lastPageVisited: '', lastPageVisitedAt: null, priorDeals: [], status: 'ready' }),
    buildHiringSignalsFn: async (domain, companyName) => {
      receivedHiringArgs = { domain, companyName };
      return { openRoles: [], status: 'ready' };
    },
    buildIntentFn: async () => ({ intentScore: '', status: 'unavailable' }),
    updateRecordFn: async () => {},
  });

  assert.deepEqual(receivedOverviewArgs, { domain: 'acme.com', existingExaContent: 'pre-scraped text' });
  assert.deepEqual(receivedHiringArgs, { domain: 'acme.com', companyName: 'Acme Roofing' });
});
