// tests/lib/requesty.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion, parseJsonResponse } from '../../src/lib/requesty.js';

test('chatCompletion returns the message content on success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'hello world' } }],
  }), { status: 200 }));
  const content = await chatCompletion({ model: 'google/gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(content, 'hello world');
});

test('chatCompletion throws on a non-ok response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('rate limited', { status: 429 }));
  await assert.rejects(
    () => chatCompletion({ model: 'google/gemini-2.5-pro', messages: [] }),
    /Requesty 429/,
  );
});

test('parseJsonResponse strips markdown fences and parses the JSON object', () => {
  const raw = '```json\n{"a": 1, "b": "two"}\n```';
  assert.deepEqual(parseJsonResponse(raw), { a: 1, b: 'two' });
});

test('parseJsonResponse throws when there is no JSON object in the text', () => {
  assert.throws(() => parseJsonResponse('not json at all'), /No JSON in response/);
});
