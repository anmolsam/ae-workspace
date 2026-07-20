// tests/briefy/sections/intent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ZOOMINFO_CLIENT_ID = 'test-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-secret';

import { buildIntent } from '../../../src/briefy/sections/intent.js';

test('falls back to signal-based intent when ZOOMINFO_INTENT_TOPICS is unset (no news -> ready, empty)', async (t) => {
  delete process.env.ZOOMINFO_INTENT_TOPICS;
  // Mock fetch so exaNews returns no results -> no LLM call -> empty signal.
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const result = await buildIntent('acme.com', 'Acme');
  assert.equal(result.status, 'ready');
  assert.equal(result.intentScore, '');
});

test('returns the intent score when topics are configured and ZoomInfo responds', async (t) => {
  process.env.ZOOMINFO_INTENT_TOPICS = 'topic-1,topic-2';
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ attributes: { topics: [{ topic: 'Construction Software', score: 91 }] } }] }), { status: 200 });
  });
  const result = await buildIntent('acme.com');
  assert.equal(result.status, 'ready');
  assert.equal(result.intentScore, '91');
});
