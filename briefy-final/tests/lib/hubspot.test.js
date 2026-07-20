import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUBSPOT_API_KEY = 'pat-test-key';

import {
  GENERIC_EMAIL_DOMAINS,
  getDealContact,
  getDealsForContact,
  getContactAnalytics,
  getOwnerName,
} from '../../src/lib/hubspot.js';

test('GENERIC_EMAIL_DOMAINS is exported and contains gmail.com', () => {
  assert.ok(GENERIC_EMAIL_DOMAINS.has('gmail.com'));
});

test('getDealContact returns null when the deal has no associated contacts', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const contact = await getDealContact('12345');
  assert.equal(contact, null);
});

test('getDealContact returns the contact when one is associated', async (t) => {
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ results: [{ id: '999' }] }), { status: 200 });
    return new Response(JSON.stringify({ id: '999', properties: { email: 'jane@acme.com', firstname: 'Jane', lastname: 'Doe' } }), { status: 200 });
  });
  const contact = await getDealContact('12345');
  assert.deepEqual(contact, { id: '999', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe' });
});

test('getDealsForContact excludes the current deal from the results', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    results: [
      { id: '111', properties: { dealname: 'Old Deal', hubspot_owner_id: '55', meeting_date___time___sales: '2025-01-01T10:00:00Z' } },
      { id: '222', properties: { dealname: 'Current Deal', hubspot_owner_id: '55', meeting_date___time___sales: '2026-01-01T10:00:00Z' } },
    ],
  }), { status: 200 }));
  const deals = await getDealsForContact('999', '222');
  assert.equal(deals.length, 1);
  assert.equal(deals[0].id, '111');
  assert.equal(deals[0].dealName, 'Old Deal');
  assert.equal(deals[0].meetingDateTimeSales, '2025-01-01T10:00:00Z');
});

test('getContactAnalytics returns last-page-visited fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    properties: { hs_analytics_last_url: 'https://acme.com/pricing', hs_analytics_last_timestamp: '2026-02-01T00:00:00Z' },
  }), { status: 200 }));
  const analytics = await getContactAnalytics('999');
  assert.deepEqual(analytics, { lastUrl: 'https://acme.com/pricing', lastTimestamp: '2026-02-01T00:00:00Z' });
});

test('getOwnerName resolves an owner id to a full name and caches the owners list', async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ results: [{ id: '77', firstName: 'Sam', lastName: 'Lee' }] }), { status: 200 });
  });
  const first = await getOwnerName('77');
  const second = await getOwnerName('77');
  assert.equal(first, 'Sam Lee');
  assert.equal(second, 'Sam Lee');
  assert.equal(fetchCalls, 1, 'second call should hit the cache, not fetch again');
});

test('getOwnerName returns an empty string for an unknown owner id', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const name = await getOwnerName('does-not-exist');
  assert.equal(name, '');
});
