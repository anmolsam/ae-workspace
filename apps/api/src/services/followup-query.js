import {
  TRACKS, followUpLabel, TASK_STATE, reconcile, isOpen, isChecked,
} from '@ae-workspace/shared';
import { getDealsForOwner, _stageLabelById } from '../adapters/hubspot.js';
import { verifyCompletion } from './completion-verifier.js';
import { getReconcilableTasks, upsertTask, updateTask, deleteTasksByKeys } from '../db/tasks-repo.js';
import { db } from '../db/supabase.js';

const H24 = 24 * 60 * 60 * 1000;
const overdueFrom = (generatedAt) => (generatedAt ? new Date(new Date(generatedAt).getTime() + H24).toISOString() : null);

/**
 * FollowUpQueryService — retrieves and NORMALIZES HubSpot follow-up state into
 * app-local tasks, then reconciles each against the upstream signal. Never
 * recreates the cadence engine: a slot is a task purely because its draft field
 * is populated (spec §5).
 *
 * @param {string} ownerId
 * @param {object} opts { checkActivity } — when true, does the per-deal HubSpot
 *   engagement read for manually-checked tasks (used by the cron; skipped on
 *   cheap page-load refreshes to respect API limits).
 * @returns {Promise<{tasks:object[]}>}  reconciled, persisted task rows.
 */
export async function syncTasksForOwner(ownerId, { checkActivity = false } = {}) {
  const deals = await getDealsForOwner(ownerId);
  const now = new Date();
  const seenKeys = new Set();
  const existing = new Map((await getReconcilableTasks({ ownerId })).map((t) => [`${t.deal_id}:${t.track}:${t.slot}`, t]));

  for (const deal of deals) {
    for (const slot of deal.slots) {
      // A slot only becomes a task when its AI draft is populated.
      if (!slot.draft) continue;
      const key = `${deal.id}:${slot.track}:${slot.slot}`;
      seenKeys.add(key);
      const overdueAt = overdueFrom(slot.generatedAt);

      // Primary verify (status), plus optional activity freshness for checked tasks.
      const prior = existing.get(key);
      const wantsActivity = checkActivity && prior?.state === TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION;
      const verdict = await verifyCompletion({
        dealId: deal.id, upstreamStatus: slot.status,
        draftGeneratedAt: slot.generatedAt, checkActivity: wantsActivity,
      });

      const base = {
        owner_id: ownerId,
        deal_id: deal.id,
        company_name: deal.raw?.company_name || deal.name,
        deal_name: deal.name,
        stage_label: _stageLabelById(deal.stageId),
        track: slot.track,
        slot: slot.slot,
        follow_up_label: followUpLabel(slot.track, slot.slot),
        draft: slot.draft,
        draft_generated_at: slot.generatedAt,
        overdue_at: overdueAt,
        hubspot_deal_url: deal.hubspotDealUrl,
        last_verified_at: now.toISOString(),
      };

      const next = reconcile(
        { state: prior?.state || TASK_STATE.ACTIVE, overdueAt, manualCheckedAt: prior?.manual_checked_at || null },
        { isDone: verdict.completed, isDisregarded: verdict.disregarded },
        now,
      );

      await upsertTask({
        ...base,
        state: next.state,
        verified_completed_at:
          next.state === TASK_STATE.COMPLETED_VERIFIED
            ? (prior?.verified_completed_at || verdict.completedAt || now.toISOString())
            : null,
        completion_activity_type: verdict.activityType || null,
        // preserve manual intent unless it just respawned
        manual_checked_at:
          next.state === TASK_STATE.MANUALLY_CHECKED_PENDING_VERIFICATION ? (prior?.manual_checked_at || now.toISOString()) : null,
      });
    }
  }

  // Draft cleared upstream => the follow-up no longer exists; drop the task.
  const stale = [...existing.keys()].filter((k) => !seenKeys.has(k));
  await deleteTasksByKeys(ownerId, stale);

  const { data } = await db.from('follow_up_tasks').select('*').eq('owner_id', ownerId);
  return { tasks: data || [] };
}

/** Build the sorted/grouped Taskee DTO list + summary for the UI. */
export function buildTaskeeView(taskRows, now = new Date()) {
  const open = taskRows.filter((t) => isOpen(t.state));
  const dtos = open.map((t) => toDto(t, now)).sort(sortByUrgency);
  const summary = {
    dueToday: dtos.filter((d) => d.bucket === 'today').length,
    overdue: dtos.filter((d) => d.overdue).length,
    thisWeek: dtos.length,
  };
  return { followUps: dtos, summary };
}

function toDto(t, now) {
  const overdue = t.state === TASK_STATE.OVERDUE || (t.overdue_at && new Date(t.overdue_at) <= now && isOpen(t.state));
  return {
    id: t.id,
    dealId: t.deal_id,
    companyName: t.company_name,
    dealName: t.deal_name,
    stageLabel: t.stage_label,
    track: t.track,
    slot: t.slot,
    followUpLabel: t.follow_up_label,
    draft: t.draft,
    draftGeneratedAt: t.draft_generated_at,
    overdueAt: t.overdue_at,
    state: t.state,
    checked: isChecked(t.state),
    overdue,
    verifiedCompletedAt: t.verified_completed_at,
    hubspotDealUrl: t.hubspot_deal_url,
    bucket: bucketFor(t.overdue_at, overdue, now),
  };
}

/** Overdue → Today → Tomorrow → next working day → rest of week. */
function bucketFor(dueIso, overdue, now) {
  if (overdue) return 'overdue';
  if (!dueIso) return 'week';
  const due = new Date(dueIso);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfDay(due) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 5) return 'upcoming';
  return 'week';
}

/** Overdue always on top (most-overdue first), then by due time ascending. */
function sortByUrgency(a, b) {
  if (a.overdue && !b.overdue) return -1;
  if (!a.overdue && b.overdue) return 1;
  return new Date(a.overdueAt || 0) - new Date(b.overdueAt || 0);
}
