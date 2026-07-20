import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRevenue } from '../../../src/briefy/sections/revenue.js';

process.env.ZOOMINFO_CLIENT_ID = 'test-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-secret';

test('reports ZoomInfo revenue and not-configured Clay when Clay is unset', async (t) => {
  delete process.env.CLAY_WEBHOOK_URL;
  delete process.env.CLAY_API_KEY;
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ attributes: { name: 'Acme', revenueRange: '$5M-$10M' } }] }), { status: 200 });
  });
  const result = await buildRevenue('acme.com', '123');
  assert.equal(result.status, 'ready');
  assert.equal(result.zoomInfoRevenue, '$5M-$10M');
  assert.equal(result.clayRevenue, 'not configured');
});

test('reports pending Clay revenue when Clay is configured and triggers cleanly', async (t) => {
  process.env.CLAY_WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/test';
  process.env.CLAY_API_KEY = 'test-key';
  let call = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    call += 1;
    if (String(url).includes('zoominfo') || String(url).includes('okta')) {
      if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ attributes: { revenueRange: '$1M-$5M' } }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  const result = await buildRevenue('acme.com', '123');
  assert.equal(result.clayRevenue, 'pending');
});
