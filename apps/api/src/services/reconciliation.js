import { syncTasksForOwner } from './followup-query.js';
import { db } from '../db/supabase.js';

/**
 * FollowUpReconciliationService — the half-hourly backstop (spec §12/§30).
 * Reconciles every AE's open tasks against HubSpot. Idempotent: it re-derives
 * state from (upstream status + activity + manual intent) each run, so running
 * it twice produces the same result and never double-creates rows.
 *
 * Cases handled inside syncTasksForOwner via the pure reconcile() reducer:
 *   A. Activity exists            -> COMPLETED_VERIFIED (+ activity ref)
 *   B. No activity, unchecked     -> stays ACTIVE / becomes OVERDUE past 24h
 *   C. No activity, manually checked -> REOPENED/OVERDUE (respawn)
 *   D. No activity, past 24h      -> OVERDUE (red, pinned top)
 *
 * checkActivity=true here: the cron is where we spend the per-deal HubSpot
 * engagement reads (page-load refreshes stay status-only to respect API limits).
 */
export async function reconcileAll() {
  const started = new Date().toISOString();
  const owners = await getTrackedOwnerIds();
  const results = [];
  for (const ownerId of owners) {
    try {
      const { tasks } = await syncTasksForOwner(ownerId, { checkActivity: true });
      results.push({ ownerId, tasks: tasks.length, ok: true });
    } catch (err) {
      // Log without corrupting task state; never mark complete on API failure.
      results.push({ ownerId, ok: false, error: err.message });
    }
  }
  return { started, finished: new Date().toISOString(), owners: owners.length, results };
}

/** Owners we know about = anyone with a linked identity OR an existing task. */
async function getTrackedOwnerIds() {
  const ids = new Set();
  const { data: identities } = await db.from('ae_identities').select('owner_id');
  for (const r of identities || []) if (r.owner_id) ids.add(r.owner_id);
  const { data: tasks } = await db.from('follow_up_tasks').select('owner_id');
  for (const r of tasks || []) if (r.owner_id) ids.add(r.owner_id);
  return [...ids];
}
