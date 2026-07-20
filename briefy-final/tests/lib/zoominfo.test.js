import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ZOOMINFO_CLIENT_ID = 'test-client-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-client-secret';

import { searchContacts, enrichIntent, _testReset } from '../../src/lib/zoominfo.js';

function mockTokenThenPayload(payload, status = 200) {
  let call = 0;
  return async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
    return new Response(JSON.stringify(payload), { status });
  };
}

test('searchContacts maps ZoomInfo contact records into a flat shape', async (t) => {
  _testReset();
  t.mock.method(globalThis, 'fetch', mockTokenThenPayload({
    data: [{ attributes: { firstName: 'Sam', lastName: 'Lee', jobTitle: 'Estimator', directPhone: '555-1234', email: 'sam@acme.com' } }],
  }));
  const contacts = await searchContacts('acme.com', ['estimator']);
  assert.deepEqual(contacts, [{ name: 'Sam Lee', title: 'Estimator', phone: '555-1234', email: 'sam@acme.com' }]);
});

test('searchContacts throws with a clear message on a non-ok response', async (t) => {
  _testReset();
  t.mock.method(globalThis, 'fetch', mockTokenThenPayload({ error: 'bad request' }, 400));
  await assert.rejects(() => searchContacts('acme.com', ['estimator']), /ZoomInfo contact search failed/);
});

test('enrichIntent returns null immediately when no topics are given', async () => {
  _testReset();
  const result = await enrichIntent('acme.com', []);
  assert.equal(result, null);
});

test('enrichIntent returns the top topic score', async (t) => {
  _testReset();
  t.mock.method(globalThis, 'fetch', mockTokenThenPayload({
    data: [{ attributes: { topics: [{ topic: 'Construction Software', score: 87 }] } }],
  }));
  const result = await enrichIntent('acme.com', ['topic-123']);
  assert.deepEqual(result, { score: 87, topics: [{ name: 'Construction Software', score: 87 }] });
});
