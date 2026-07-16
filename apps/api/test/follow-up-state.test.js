import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_STATE,
  reconcile,
  applyManualCheck,
  applyManualUncheck,
  isOpen,
  isChecked,
} from '@ae-workspace/shared';
import { NOW, iso, hours } from './setup.js';

const NOT_DONE = { isDone: false, isDisregarded: false };

test('reconcile: HubSpot activity found (isDone) -> COMPLETED_VERIFIED regardless of prior state', () => {
  const priors = [
    TASK_STATE.ACTIVE,
    TASK_STATE.OVERDUE,
    TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION,
    TASK_STATE.REOPENED_AFTER_FAILED_VERIFICATION,
    TASK_STATE.DISREGARDED,
    TASK_STATE.COMPLETED_VERIFIED,
  ];
  for (const state of priors) {
    // overdue in the past to prove isDone still wins over overdue logic
    const r = reconcile({ state, overdueAt: iso(-hours(48)), manualCheckedAt: null }, { isDone: true, isDisregarded: false }, NOW);
    assert.equal(r.state, TASK_STATE.COMPLETED_VERIFIED, `prior=${state}`);
    assert.equal(r.reason, 'hubspot_activity_confirmed');
  }
});

test('reconcile: manually-checked + NO activity + not overdue -> REOPENED_AFTER_FAILED_VERIFICATION (respawn)', () => {
  const r = reconcile(
    { state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION, overdueAt: iso(hours(5)), manualCheckedAt: iso(-hours(1)) },
    NOT_DONE,
    NOW,
  );
  assert.equal(r.state, TASK_STATE.REOPENED_AFTER_FAILED_VERIFICATION);
  assert.equal(r.reason, 'manual_check_unverified_respawn');
});

test('reconcile: manually-checked + NO activity + overdue -> OVERDUE (respawns to top/red)', () => {
  const r = reconcile(
    { state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION, overdueAt: iso(-hours(3)), manualCheckedAt: iso(-hours(4)) },
    NOT_DONE,
    NOW,
  );
  assert.equal(r.state, TASK_STATE.OVERDUE);
  assert.equal(r.reason, 'manual_check_unverified_respawn');
});

test('reconcile: no activity, unchecked, within 24h -> ACTIVE', () => {
  const r = reconcile({ state: TASK_STATE.ACTIVE, overdueAt: iso(hours(10)), manualCheckedAt: null }, NOT_DONE, NOW);
  assert.equal(r.state, TASK_STATE.ACTIVE);
  assert.equal(r.reason, 'active');
});

test('reconcile: no activity, unchecked, past overdueAt -> OVERDUE', () => {
  const r = reconcile({ state: TASK_STATE.ACTIVE, overdueAt: iso(-hours(1)), manualCheckedAt: null }, NOT_DONE, NOW);
  assert.equal(r.state, TASK_STATE.OVERDUE);
  assert.equal(r.reason, 'past_24h_deadline');
});

test('reconcile: overdueAt exactly equal to now is treated as overdue (<= boundary)', () => {
  const r = reconcile({ state: TASK_STATE.ACTIVE, overdueAt: NOW.toISOString(), manualCheckedAt: null }, NOT_DONE, NOW);
  assert.equal(r.state, TASK_STATE.OVERDUE);
});

test('reconcile: null overdueAt is never overdue -> ACTIVE', () => {
  const r = reconcile({ state: TASK_STATE.ACTIVE, overdueAt: null, manualCheckedAt: null }, NOT_DONE, NOW);
  assert.equal(r.state, TASK_STATE.ACTIVE);
});

test('reconcile: isDisregarded -> DISREGARDED', () => {
  const r = reconcile({ state: TASK_STATE.ACTIVE, overdueAt: iso(-hours(1)), manualCheckedAt: null }, { isDone: false, isDisregarded: true }, NOW);
  assert.equal(r.state, TASK_STATE.DISREGARDED);
  assert.equal(r.reason, 'upstream_disregarded');
});

test('reconcile: isDone takes precedence over isDisregarded', () => {
  const r = reconcile({ state: TASK_STATE.ACTIVE, overdueAt: null, manualCheckedAt: null }, { isDone: true, isDisregarded: true }, NOW);
  assert.equal(r.state, TASK_STATE.COMPLETED_VERIFIED);
});

test('reconcile: IDEMPOTENCY - same inputs twice yield the same state', () => {
  const cases = [
    [{ state: TASK_STATE.ACTIVE, overdueAt: iso(hours(5)), manualCheckedAt: null }, NOT_DONE],
    [{ state: TASK_STATE.ACTIVE, overdueAt: iso(-hours(5)), manualCheckedAt: null }, NOT_DONE],
    [{ state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION, overdueAt: iso(hours(5)), manualCheckedAt: iso(-hours(1)) }, NOT_DONE],
    [{ state: TASK_STATE.ACTIVE, overdueAt: null, manualCheckedAt: null }, { isDone: true, isDisregarded: false }],
    [{ state: TASK_STATE.ACTIVE, overdueAt: null, manualCheckedAt: null }, { isDone: false, isDisregarded: true }],
  ];
  for (const [task, hs] of cases) {
    const first = reconcile(task, hs, NOW);
    const second = reconcile(task, hs, NOW);
    assert.deepEqual(second, first);
  }
});

test('reconcile: settled states are fixed points (feeding output back is stable)', () => {
  // NON-manual states: reconciling a settled ACTIVE/OVERDUE/COMPLETED/DISREGARDED
  // input again with the same signal returns the same state.
  const fixed = [
    [{ state: TASK_STATE.ACTIVE, overdueAt: iso(hours(5)), manualCheckedAt: null }, NOT_DONE],
    [{ state: TASK_STATE.OVERDUE, overdueAt: iso(-hours(5)), manualCheckedAt: null }, NOT_DONE],
    [{ state: TASK_STATE.COMPLETED_VERIFIED, overdueAt: null, manualCheckedAt: null }, { isDone: true, isDisregarded: false }],
    [{ state: TASK_STATE.DISREGARDED, overdueAt: null, manualCheckedAt: null }, { isDone: false, isDisregarded: true }],
  ];
  for (const [task, hs] of fixed) {
    const first = reconcile(task, hs, NOW);
    const again = reconcile({ ...task, state: first.state }, hs, NOW);
    assert.equal(again.state, first.state, `not a fixed point for ${task.state}`);
  }
});

test('reconcile: manual-check respawn is a one-shot transition (not re-applied to its own output)', () => {
  // MANUALLY_CHECKED with no activity + not overdue -> REOPENED. Feeding REOPENED
  // back in (no longer manually checked) settles to ACTIVE by the 24h rule.
  const checked = { state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION, overdueAt: iso(hours(5)), manualCheckedAt: iso(-hours(1)) };
  const first = reconcile(checked, NOT_DONE, NOW);
  assert.equal(first.state, TASK_STATE.REOPENED_AFTER_FAILED_VERIFICATION);
  const next = reconcile({ ...checked, state: first.state }, NOT_DONE, NOW);
  assert.equal(next.state, TASK_STATE.ACTIVE);
});

test('applyManualCheck -> MANUALLY_CHECKED_PENDING_VERIFICATION with manualCheckedAt set', () => {
  const task = { state: TASK_STATE.ACTIVE, overdueAt: iso(hours(5)), manualCheckedAt: null };
  const next = applyManualCheck(task, NOW);
  assert.equal(next.state, TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION);
  assert.equal(next.manualCheckedAt, NOW.toISOString());
  assert.equal(next.overdueAt, task.overdueAt);
});

test('manual check != verified completion - state is pending, not COMPLETED_VERIFIED', () => {
  const next = applyManualCheck({ state: TASK_STATE.ACTIVE, overdueAt: iso(hours(5)), manualCheckedAt: null }, NOW);
  assert.notEqual(next.state, TASK_STATE.COMPLETED_VERIFIED);
  // and reconciling the checked task with no activity respawns it
  const r = reconcile(next, NOT_DONE, NOW);
  assert.equal(r.state, TASK_STATE.REOPENED_AFTER_FAILED_VERIFICATION);
});

test('applyManualUncheck -> ACTIVE when within 24h, OVERDUE when past deadline', () => {
  const active = applyManualUncheck(
    { state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION, overdueAt: iso(hours(5)), manualCheckedAt: iso(-hours(1)) },
    NOW,
  );
  assert.equal(active.state, TASK_STATE.ACTIVE);
  assert.equal(active.manualCheckedAt, null);

  const overdue = applyManualUncheck(
    { state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION, overdueAt: iso(-hours(5)), manualCheckedAt: iso(-hours(6)) },
    NOW,
  );
  assert.equal(overdue.state, TASK_STATE.OVERDUE);
  assert.equal(overdue.manualCheckedAt, null);
});

test('isOpen / isChecked classify states correctly', () => {
  assert.equal(isOpen(TASK_STATE.ACTIVE), true);
  assert.equal(isOpen(TASK_STATE.OVERDUE), true);
  assert.equal(isOpen(TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION), true);
  assert.equal(isOpen(TASK_STATE.REOPENED_AFTER_FAILED_VERIFICATION), true);
  assert.equal(isOpen(TASK_STATE.COMPLETED_VERIFIED), false);
  assert.equal(isOpen(TASK_STATE.DISREGARDED), false);

  assert.equal(isChecked(TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION), true);
  assert.equal(isChecked(TASK_STATE.COMPLETED_VERIFIED), true);
  assert.equal(isChecked(TASK_STATE.ACTIVE), false);
  assert.equal(isChecked(TASK_STATE.OVERDUE), false);
});
