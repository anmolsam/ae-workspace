import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompany } from '../../src/briefy/resolveCompany.js';

test('a clean domain resolves as-is', () => {
  assert.deepEqual(resolveCompany('acme.com'), { domain: 'acme.com', status: 'resolved' });
});

test('trims whitespace and lowercases', () => {
  assert.deepEqual(resolveCompany('  Acme.COM  '), { domain: 'acme.com', status: 'resolved' });
});

test('strips a leading protocol and www', () => {
  assert.deepEqual(resolveCompany('https://www.Acme.com/'), { domain: 'acme.com', status: 'resolved' });
});

test('a blank or missing cell resolves to not_found', () => {
  assert.deepEqual(resolveCompany(''), { domain: null, status: 'not_found' });
  assert.deepEqual(resolveCompany(null), { domain: null, status: 'not_found' });
  assert.deepEqual(resolveCompany(undefined), { domain: null, status: 'not_found' });
});

test('a whitespace-only cell resolves to not_found', () => {
  assert.deepEqual(resolveCompany('   '), { domain: null, status: 'not_found' });
});
