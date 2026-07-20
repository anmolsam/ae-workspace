import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUBSPOT_API_KEY = 'pat-test-key';

import { buildHubspotSignals } from '../../../src/briefy/sections/hubspotSignals.js';

test('returns empty-but-ready signals when the deal has no associated contact', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const result = await buildHubspotSignals('123');
  assert.deepEqual(result, { lastPageVisited: '', lastPageVisitedAt: null, priorDeals: [], status: 'ready' });
});

test('returns last page visited and prior deals with resolved owner names and links', async (t) => {
  const responses = [
    { results: [{ id: '999' }] }, // deal associations -> contact
    { properties: { email: 'jane@acme.com', firstname: 'Jane', lastname: 'Doe' } }, // contact details
    { properties: { hs_analytics_last_url: 'https://acme.com/pricing', hs_analytics_last_timestamp: '2026-01-01T00:00:00Z' } }, // analytics
    { results: [{ id: '111', properties: { dealname: 'Old Deal', hubspot_owner_id: '55', meeting_date___time___sales: '2025-01-01T10:00:00Z' } }] }, // prior deals
    { results: [{ id: '55', firstName: 'Sam', lastName: 'Lee' }] }, // owners list for getOwnerName
  ];
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(responses[call++]), { status: 200 }));

  const result = await buildHubspotSignals('222');
  assert.equal(result.status, 'ready');
  assert.equal(result.lastPageVisited, 'https://acme.com/pricing');
  assert.equal(result.priorDeals.length, 1);
  assert.equal(result.priorDeals[0].dealName, 'Old Deal');
  assert.equal(result.priorDeals[0].dealOwner, 'Sam Lee');
  assert.equal(result.priorDeals[0].dealLink, 'https://app.hubspot.com/contacts/20155995/deal/111');
  assert.equal(result.priorDeals[0].meetingDateTimeSales, '2025-01-01T10:00:00Z');
});
