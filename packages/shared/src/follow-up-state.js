/**
 * Follow-up TASK state model (app-local, stored in Postgres).
 *
 * This is distinct from the upstream HubSpot per-follow-up status
 * (see FOLLOWUP_STATUS in hubspot-fields.js). The upstream status is the
 * authoritative "was the follow-up genuinely completed" signal. THIS enum
 * captures the extra dimension the workspace owns: the AE's manual checkbox
 * intent, which is NOT authoritative and must always reconcile against HubSpot.
 *
 * Core invariant (non-negotiable, per spec §9/§37):
 *   A manual check can never permanently dismiss a genuine follow-up. If HubSpot
 *   shows no qualifying activity, a manually-checked task RESPAWNS to its
 *   correct urgency position (top + red if overdue).
 */

export const TASK_STATE = {
  /** Draft present, HubSpot status `none`, not yet manually checked, within 24h. */
  ACTIVE: 'ACTIVE',
  /** Draft present, HubSpot status `none`, past draftGeneratedAt + 24h. */
  OVERDUE: 'OVERDUE',
  /** AE ticked the box; UI crosses it out instantly. NOT yet verified. */
  MANUALLY_CHECKED_PENDING_VERIFICATION: 'MANUALLY_CHECKED_PENDING_VERIFICATION',
  /** HubSpot confirmed qualifying activity (status timely|delayed). Terminal-ish. */
  COMPLETED_VERIFIED: 'COMPLETED_VERIFIED',
  /** Was manually checked, reconciliation found NO activity -> respawned. */
  REOPENED_AFTER_FAILED_VERIFICATION: 'REOPENED_AFTER_FAILED_VERIFICATION',
  /** Upstream marked the slot disregarded (skipped_negative / paused_*). Hidden. */
  DISREGARDED: 'DISREGARDED',
};

/** States that still require the AE's attention (render in Taskee list). */
export const OPEN_STATES = new Set([
  TASK_STATE.ACTIVE,
  TASK_STATE.OVERDUE,
  TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION,
  TASK_STATE.REOPENED_AFTER_FAILED_VERIFICATION,
]);

/** States the UI renders with a strikethrough / checked box. */
export const CHECKED_STATES = new Set([
  TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION,
  TASK_STATE.COMPLETED_VERIFIED,
]);

export const isOpen = (state) => OPEN_STATES.has(state);
export const isChecked = (state) => CHECKED_STATES.has(state);

/**
 * Pure reconciliation reducer. Given the current app-local task, the upstream
 * HubSpot signal, and `now`, return the next state + reason. Deterministic and
 * idempotent: calling it twice with the same inputs yields the same output.
 *
 * @param {object} task    - { state, overdueAt (ISO), manualCheckedAt (ISO|null) }
 * @param {object} hubspot - { isDone: boolean, isDisregarded: boolean }
 * @param {Date}   now
 * @returns {{ state: string, reason: string }}
 */
export function reconcile(task, hubspot, now = new Date()) {
  // 1. Upstream wins absolutely: genuine activity -> verified complete.
  if (hubspot.isDone) {
    return { state: TASK_STATE.COMPLETED_VERIFIED, reason: 'hubspot_activity_confirmed' };
  }
  // 2. Upstream disregard (negative reply / OOO / future meeting) -> hide.
  if (hubspot.isDisregarded) {
    return { state: TASK_STATE.DISREGARDED, reason: 'upstream_disregarded' };
  }

  const overdue = task.overdueAt && new Date(task.overdueAt) <= now;

  // 3. No activity, but the AE manually checked it -> RESPAWN (non-negotiable).
  if (task.state === TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION) {
    return {
      state: overdue ? TASK_STATE.OVERDUE : TASK_STATE.REOPENED_AFTER_FAILED_VERIFICATION,
      reason: 'manual_check_unverified_respawn',
    };
  }

  // 4. No activity, not manually checked -> active or overdue by the 24h rule.
  return {
    state: overdue ? TASK_STATE.OVERDUE : TASK_STATE.ACTIVE,
    reason: overdue ? 'past_24h_deadline' : 'active',
  };
}

/** Apply an optimistic manual check (instant UI). Never authoritative. */
export function applyManualCheck(task, now = new Date()) {
  return {
    ...task,
    state: TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION,
    manualCheckedAt: now.toISOString(),
  };
}

export function applyManualUncheck(task, now = new Date()) {
  const overdue = task.overdueAt && new Date(task.overdueAt) <= now;
  return {
    ...task,
    state: overdue ? TASK_STATE.OVERDUE : TASK_STATE.ACTIVE,
    manualCheckedAt: null,
  };
}
