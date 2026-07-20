import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgTree } from '../../../src/briefy/sections/orgTree.js';
import { _testReset } from '../../../src/lib/zoominfo.js';

process.env.ZOOMINFO_CLIENT_ID = 'test-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-secret';

function mockTokenThenContacts(contacts) {
  let call = 0;
  return async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ data: contacts.map(c => ({ attributes: c })) }), { status: 200 });
  };
}

test('buckets contacts into estimators/programManagers/upperManagement by title', async (t) => {
  _testReset();
  t.mock.method(globalThis, 'fetch', mockTokenThenContacts([
    { firstName: 'A', lastName: 'One', jobTitle: 'Senior Estimator', email: 'a@acme.com', directPhone: '1' },
    { firstName: 'B', lastName: 'Two', jobTitle: 'Project Manager', email: 'b@acme.com', directPhone: '2' },
    { firstName: 'C', lastName: 'Three', jobTitle: 'CEO', email: 'c@acme.com', directPhone: '3' },
    { firstName: 'D', lastName: 'Four', jobTitle: 'Receptionist', email: 'd@acme.com', directPhone: '4' },
  ]));
  const result = await buildOrgTree('acme.com');
  assert.equal(result.status, 'ready');
  assert.equal(result.orgTree.estimators.length, 1);
  assert.equal(result.orgTree.programManagers.length, 1);
  assert.equal(result.orgTree.upperManagement.length, 1);
  assert.equal(result.orgTree.estimators[0].name, 'A One');
  assert.equal(result.orgTree.estimators[0].source, 'ZoomInfo');
});

test('returns an error status when the ZoomInfo call fails', async (t) => {
  _testReset();
  t.mock.method(globalThis, 'fetch', async () => new Response('server error', { status: 500 }));
  const result = await buildOrgTree('acme.com');
  assert.equal(result.status, 'error');
  assert.deepEqual(result.orgTree, { estimators: [], programManagers: [], upperManagement: [] });
});

test('buckets Director of Estimating into upperManagement (seniority overrides department)', async (t) => {
  _testReset();
  t.mock.method(globalThis, 'fetch', mockTokenThenContacts([
    { firstName: 'Jane', lastName: 'Smith', jobTitle: 'Director of Estimating', email: 'jane@acme.com', directPhone: '555-1234' },
  ]));
  const result = await buildOrgTree('acme.com');
  assert.equal(result.status, 'ready');
  assert.equal(result.orgTree.estimators.length, 0);
  assert.equal(result.orgTree.upperManagement.length, 1);
  assert.equal(result.orgTree.upperManagement[0].name, 'Jane Smith');
});

test('buckets VP of Preconstruction into upperManagement (seniority overrides department)', async (t) => {
  _testReset();
  t.mock.method(globalThis, 'fetch', mockTokenThenContacts([
    { firstName: 'Mike', lastName: 'Johnson', jobTitle: 'VP of Preconstruction', email: 'mike@acme.com', directPhone: '555-5678' },
  ]));
  const result = await buildOrgTree('acme.com');
  assert.equal(result.status, 'ready');
  assert.equal(result.orgTree.estimators.length, 0);
  assert.equal(result.orgTree.upperManagement.length, 1);
  assert.equal(result.orgTree.upperManagement[0].name, 'Mike Johnson');
});
