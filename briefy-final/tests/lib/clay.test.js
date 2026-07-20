import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerEnrichment } from '../../src/lib/clay.js';

test('triggerEnrichment returns not_configured when CLAY_WEBHOOK_URL is unset', async () => {
  delete process.env.CLAY_WEBHOOK_URL;
  delete process.env.CLAY_API_KEY;
  const result = await triggerEnrichment({ domain: 'acme.com', dealId: '123' });
  assert.deepEqual(result, { status: 'not_configured' });
});

test('triggerEnrichment posts to the webhook and returns triggered on success', async (t) => {
  process.env.CLAY_WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/test';
  process.env.CLAY_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  const result = await triggerEnrichment({ domain: 'acme.com', dealId: '123' });
  assert.deepEqual(result, { status: 'triggered' });
});

test('triggerEnrichment throws with a clear message when Clay rejects the request', async (t) => {
  process.env.CLAY_WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/test';
  process.env.CLAY_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async () => new Response('bad payload', { status: 422 }));
  await assert.rejects(() => triggerEnrichment({ domain: 'acme.com', dealId: '123' }), /Clay trigger failed: 422/);
});
