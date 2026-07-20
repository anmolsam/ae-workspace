import { test } from 'node:test';
import assert from 'node:assert/strict';

// src/lib/airtable.js constructs its default Airtable connection eagerly at
// module-evaluation time. Static imports are hoisted ahead of any top-level
// statement in this file, so setting process.env here would never run in time
// for that eager construction — a dynamic import is what actually sequences
// correctly (it evaluates in source order, like any other expression).
process.env.AIRTABLE_API_KEY = 'test-key';
process.env.AIRTABLE_BASE_ID = 'test-base-id';

const { createBase, getRecords, updateRecord } = await import('../../src/lib/airtable.js');

test('createBase returns a callable Airtable base bound to the given base id', () => {
  const base = createBase('appTestBriefyBase');
  assert.equal(typeof base, 'function');
});

test('getRecords targets the explicitly passed base, not the default ICP Match base', async () => {
  const calls = [];
  const fakeTable = { select: () => ({ eachPage: (callback) => { calls.push('used-fake-base'); callback([{ id: 'rec1' }], () => {}); return Promise.resolve(); } }) };
  const fakeBase = () => fakeTable;
  const records = await getRecords('Briefy', {}, fakeBase);
  assert.deepEqual(calls, ['used-fake-base']);
  assert.equal(records.length, 1);
});

test('updateRecord targets the explicitly passed base', async () => {
  let capturedArgs = null;
  const fakeTable = { update: (id, fields) => { capturedArgs = { id, fields }; return Promise.resolve(); } };
  const fakeBase = () => fakeTable;
  await updateRecord('Briefy', 'rec1', { 'Brief Status': 'Ready' }, fakeBase);
  assert.deepEqual(capturedArgs, { id: 'rec1', fields: { 'Brief Status': 'Ready' } });
});
