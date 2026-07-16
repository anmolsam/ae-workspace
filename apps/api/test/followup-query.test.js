import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskeeView } from '../src/services/followup-query.js';
import { TASK_STATE } from '@ae-workspace/shared';

// Use local-noon "now" so day-bucket math (which uses local getFullYear/Month/Date)
// is unambiguous regardless of the machine timezone.
const NOW = new Date(2026, 6, 16, 12, 0, 0); // 2026-07-16 12:00 local
const DAY = 24 * 60 * 60 * 1000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
// "today, still in the future" - same calendar day as NOW but after it, so it
// buckets as today WITHOUT tripping the `overdue_at <= now` overdue flag.
const todayLater = new Date(2026, 6, 16, 18, 0, 0).toISOString();
// local-day offset: N days from today at local noon (n>=1 avoids the now boundary)
const dayOffset = (n) => new Date(2026, 6, 16 + n, 12, 0, 0).toISOString();

let seq = 0;
const row = (over) => ({
  id: `t${++seq}`,
  deal_id: `d${seq}`,
  company_name: 'Acme',
  deal_name: 'Acme Deal',
  stage_label: 'Discovery Ongoing',
  track: 'DO',
  slot: 1,
  follow_up_label: 'Follow-Up 1',
  draft: 'hi',
  draft_generated_at: at(-DAY),
  hubspot_deal_url: 'https://example.com',
  ...over,
});

test('overdue tasks always sort first, and are sorted by overdueAt ascending (most overdue first)', () => {
  const rows = [
    row({ state: TASK_STATE.ACTIVE, overdue_at: dayOffset(2) }),   // upcoming
    row({ state: TASK_STATE.OVERDUE, overdue_at: at(-3 * 60 * 60 * 1000) }), // 3h overdue
    row({ state: TASK_STATE.OVERDUE, overdue_at: at(-10 * 60 * 60 * 1000) }), // 10h overdue (most)
    row({ state: TASK_STATE.ACTIVE, overdue_at: todayLater }),   // today
  ];
  const { followUps } = buildTaskeeView(rows, NOW);

  // first two must be the overdue ones
  assert.equal(followUps[0].overdue, true);
  assert.equal(followUps[1].overdue, true);
  // most overdue (earliest overdueAt) first
  assert.ok(new Date(followUps[0].overdueAt) < new Date(followUps[1].overdueAt));
  // remaining are not overdue
  assert.equal(followUps[2].overdue, false);
  assert.equal(followUps[3].overdue, false);
  // among non-overdue, earlier due first (today before upcoming)
  assert.ok(new Date(followUps[2].overdueAt) < new Date(followUps[3].overdueAt));
});

test('buckets: overdue / today / tomorrow / upcoming / week assigned correctly', () => {
  const rows = [
    row({ state: TASK_STATE.OVERDUE, overdue_at: at(-2 * 60 * 60 * 1000) }),
    row({ state: TASK_STATE.ACTIVE, overdue_at: todayLater }),  // today
    row({ state: TASK_STATE.ACTIVE, overdue_at: dayOffset(1) }),  // tomorrow
    row({ state: TASK_STATE.ACTIVE, overdue_at: dayOffset(3) }),  // upcoming (<=5)
    row({ state: TASK_STATE.ACTIVE, overdue_at: dayOffset(9) }),  // week (>5)
  ];
  const { followUps } = buildTaskeeView(rows, NOW);
  const bucketByDue = Object.fromEntries(followUps.map((d) => [d.overdueAt, d.bucket]));

  assert.equal(bucketByDue[rows[0].overdue_at], 'overdue');
  assert.equal(bucketByDue[rows[1].overdue_at], 'today');
  assert.equal(bucketByDue[rows[2].overdue_at], 'tomorrow');
  assert.equal(bucketByDue[rows[3].overdue_at], 'upcoming');
  assert.equal(bucketByDue[rows[4].overdue_at], 'week');
});

test('summary: overdue counts overdue, dueToday counts today, thisWeek counts all open', () => {
  const rows = [
    row({ state: TASK_STATE.OVERDUE, overdue_at: at(-2 * 60 * 60 * 1000) }),
    row({ state: TASK_STATE.OVERDUE, overdue_at: at(-5 * 60 * 60 * 1000) }),
    row({ state: TASK_STATE.ACTIVE, overdue_at: todayLater }),  // today
    row({ state: TASK_STATE.ACTIVE, overdue_at: dayOffset(4) }),  // upcoming
  ];
  const { summary, followUps } = buildTaskeeView(rows, NOW);
  assert.equal(summary.overdue, 2);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.thisWeek, 4);
  assert.equal(followUps.length, 4);
});

test('checked/verified tasks are excluded from the open list; COMPLETED_VERIFIED never appears', () => {
  const rows = [
    row({ state: TASK_STATE.ACTIVE, overdue_at: todayLater }),
    row({ state: TASK_STATE.COMPLETED_VERIFIED, overdue_at: at(-DAY) }),
    row({ state: TASK_STATE.DISREGARDED, overdue_at: at(-DAY) }),
  ];
  const { followUps } = buildTaskeeView(rows, NOW);
  assert.equal(followUps.length, 1);
  assert.ok(followUps.every((d) => d.state !== TASK_STATE.COMPLETED_VERIFIED));
  assert.ok(followUps.every((d) => d.state !== TASK_STATE.DISREGARDED));
});

test('MANUALLY_CHECKED_PENDING_VERIFICATION stays in open list but is marked checked', () => {
  const rows = [
    row({ state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION, overdue_at: todayLater }),
  ];
  const { followUps } = buildTaskeeView(rows, NOW);
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].checked, true);
});
