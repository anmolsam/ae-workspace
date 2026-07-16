import { db } from './supabase.js';

/**
 * follow_up_tasks repository. Each row is one (owner, deal, track, slot)
 * follow-up the workspace is tracking. HubSpot/ROMA own the cadence; this table
 * owns ONLY the app-local dimension: manual-check intent + reconciliation state.
 *
 * The natural key (owner_id, deal_id, track, slot) makes upserts idempotent —
 * re-running reconciliation never creates duplicates.
 */
const TABLE = 'follow_up_tasks';

export async function getOpenTasksForOwner(ownerId) {
  const { data, error } = await db.from(TABLE).select('*').eq('owner_id', ownerId);
  if (error) throw error;
  return data || [];
}

/** All tasks the reconciler must consider (active/checked/overdue/reopened). */
export async function getReconcilableTasks({ ownerId } = {}) {
  let q = db.from(TABLE).select('*').not('state', 'in', '("COMPLETED_VERIFIED","DISREGARDED")');
  if (ownerId) q = q.eq('owner_id', ownerId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getTaskById(id, ownerId) {
  const { data, error } = await db.from(TABLE).select('*').eq('id', id).eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Idempotent upsert on the natural key. Preserves manual_checked_at unless overwritten. */
export async function upsertTask(task) {
  const { data, error } = await db
    .from(TABLE)
    .upsert(task, { onConflict: 'owner_id,deal_id,track,slot' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, patch) {
  const { data, error } = await db.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Delete tasks whose upstream draft field is no longer populated (draft cleared). */
export async function deleteTasksByKeys(ownerId, keys) {
  if (!keys.length) return;
  // keys: array of `${dealId}:${track}:${slot}`
  for (const k of keys) {
    const [dealId, track, slot] = k.split(':');
    await db.from(TABLE).delete().eq('owner_id', ownerId).eq('deal_id', dealId).eq('track', track).eq('slot', Number(slot));
  }
}
