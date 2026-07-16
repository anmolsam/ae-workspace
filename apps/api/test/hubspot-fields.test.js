import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftField,
  generatedAtField,
  statusField,
  isActionableStatus,
  isDoneStatus,
  isDisregardStatus,
  allDealReadProps,
  dealUrl,
  TRACKS,
  FOLLOWUP_STATUS,
} from '@ae-workspace/shared';

test('draftField / generatedAtField / statusField produce exact upstream names', () => {
  assert.equal(draftField('do', 2), 'do_followup_email_2');
  assert.equal(generatedAtField('oi', 1), 'oi_followup_1_generated_at');
  assert.equal(statusField('ds', 0), 'ds_followup_0_status');
  assert.equal(draftField('ds', 0), 'ds_followup_email_0');
  assert.equal(generatedAtField('do', 4), 'do_followup_4_generated_at');
});

test('isActionableStatus true only for "none"', () => {
  assert.equal(isActionableStatus('none'), true);
  assert.equal(isActionableStatus(FOLLOWUP_STATUS.NONE), true);
  assert.equal(isActionableStatus('timely'), false);
  assert.equal(isActionableStatus(''), false);
  assert.equal(isActionableStatus(null), false);
});

test('isDoneStatus true for timely / delayed', () => {
  assert.equal(isDoneStatus('timely'), true);
  assert.equal(isDoneStatus('delayed'), true);
  assert.equal(isDoneStatus('none'), false);
  assert.equal(isDoneStatus('paused_ooo'), false);
});

test('isDisregardStatus true for paused_ooo / skipped_negative / paused_meeting', () => {
  assert.equal(isDisregardStatus('paused_ooo'), true);
  assert.equal(isDisregardStatus('skipped_negative'), true);
  assert.equal(isDisregardStatus('paused_meeting'), true);
  assert.equal(isDisregardStatus('none'), false);
  assert.equal(isDisregardStatus('timely'), false);
});

test('allDealReadProps includes all 9 draft fields + stage entry fields', () => {
  const props = allDealReadProps();
  const set = new Set(props);

  // all 9 draft fields across DS(0), DO(1..4), OI(1..4)
  const expectedDrafts = [];
  for (const t of Object.values(TRACKS)) {
    for (const n of t.slots) expectedDrafts.push(draftField(t.prefix, n));
  }
  assert.equal(expectedDrafts.length, 9);
  for (const d of expectedDrafts) assert.ok(set.has(d), `missing draft field ${d}`);

  // stage entry fields for every known stage id
  assert.ok(set.has('hs_v2_date_entered_991336852'), 'missing OI stage entry field');
  assert.ok(set.has('hs_v2_date_entered_1134585766'), 'missing Demo Scheduled stage entry field');
  assert.ok(set.has('hs_v2_date_entered_1340568861'), 'missing Discovery Ongoing stage entry field');

  // sanity: generatedAt + status fields also present
  assert.ok(set.has(generatedAtField('do', 2)));
  assert.ok(set.has(statusField('oi', 4)));
});

test('dealUrl builds the correct HubSpot deep link', () => {
  assert.equal(
    dealUrl('123456', '987654321'),
    'https://app.hubspot.com/contacts/123456/deal/987654321',
  );
});
