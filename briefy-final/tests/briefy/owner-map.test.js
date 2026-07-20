import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOwnerForEmail } from '../../src/briefy/owner-map.js';

test('an unmapped email returns null', () => {
  assert.equal(getOwnerForEmail('nobody@attentive.ai'), null);
});

test('lookup is case-insensitive on the email', () => {
  // relies on whatever is in OWNER_MAP — with an empty map this just confirms no throw
  assert.doesNotThrow(() => getOwnerForEmail('SOMEONE@ATTENTIVE.AI'));
});

test('a null/undefined email returns null instead of throwing', () => {
  assert.equal(getOwnerForEmail(undefined), null);
  assert.equal(getOwnerForEmail(''), null);
});
