import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCompletion } from '../src/services/completion-verifier.js';

// All cases use checkActivity:false so the pure status branches are exercised
// and no network / HubSpot adapter call is made.

test('upstreamStatus "timely" -> completed:true (source status)', async () => {
  const v = await verifyCompletion({ dealId: 'd1', upstreamStatus: 'timely', checkActivity: false });
  assert.equal(v.completed, true);
  assert.equal(v.disregarded, false);
  assert.equal(v.source, 'status');
});

test('upstreamStatus "delayed" -> completed:true', async () => {
  const v = await verifyCompletion({ dealId: 'd1', upstreamStatus: 'delayed', checkActivity: false });
  assert.equal(v.completed, true);
  assert.equal(v.disregarded, false);
});

test('upstreamStatus "paused_meeting" -> disregarded:true', async () => {
  const v = await verifyCompletion({ dealId: 'd1', upstreamStatus: 'paused_meeting', checkActivity: false });
  assert.equal(v.completed, false);
  assert.equal(v.disregarded, true);
  assert.equal(v.source, 'status');
});

test('upstreamStatus "skipped_negative" -> disregarded:true', async () => {
  const v = await verifyCompletion({ dealId: 'd1', upstreamStatus: 'skipped_negative', checkActivity: false });
  assert.equal(v.completed, false);
  assert.equal(v.disregarded, true);
});

test('upstreamStatus "paused_ooo" -> disregarded:true', async () => {
  const v = await verifyCompletion({ dealId: 'd1', upstreamStatus: 'paused_ooo', checkActivity: false });
  assert.equal(v.disregarded, true);
});

test('upstreamStatus "none" -> completed:false, disregarded:false', async () => {
  const v = await verifyCompletion({ dealId: 'd1', upstreamStatus: 'none', checkActivity: false });
  assert.equal(v.completed, false);
  assert.equal(v.disregarded, false);
  assert.equal(v.source, 'status');
});

test('blank / undefined status with checkActivity:false -> not completed, not disregarded', async () => {
  const v = await verifyCompletion({ dealId: 'd1', upstreamStatus: '', checkActivity: false });
  assert.equal(v.completed, false);
  assert.equal(v.disregarded, false);
});
