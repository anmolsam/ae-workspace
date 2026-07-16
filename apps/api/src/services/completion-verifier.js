import { isDoneStatus, isDisregardStatus, isActionableStatus } from '@ae-workspace/shared';
import { getQualifyingActivityAfter } from '../adapters/hubspot.js';

/**
 * FollowUpCompletionVerifier — determines whether a follow-up is genuinely done
 * according to HubSpot, NOT according to the AE's checkbox.
 *
 * Two-tier, reusing the upstream definition rather than reinventing it:
 *  1. PRIMARY: the upstream `*_status` field (already reconciled by ROMA's
 *     grace-engine). `timely`/`delayed` => done; `skipped_*`/`paused_*` =>
 *     disregard; `none` => still open.
 *  2. SECONDARY (freshness): if status is still `none` but the AE claims done,
 *     read HubSpot engagement activity after draftGeneratedAt to catch activity
 *     the upstream tick hasn't processed yet. Same qualifying rules as upstream
 *     (activity/collector.js): outbound non-confirmation email / call>=60s / SMS.
 *
 * @returns {Promise<{completed:boolean, disregarded:boolean,
 *   completedAt?:string, activityType?:string, source:'status'|'activity'}>}
 */
export async function verifyCompletion({ dealId, upstreamStatus, draftGeneratedAt, checkActivity = false }) {
  if (isDoneStatus(upstreamStatus)) {
    return { completed: true, disregarded: false, source: 'status' };
  }
  if (isDisregardStatus(upstreamStatus)) {
    return { completed: false, disregarded: true, source: 'status' };
  }
  // status is `none` (or blank). Optionally do the freshness activity check.
  if (checkActivity && isActionableStatus(upstreamStatus)) {
    const activity = await getQualifyingActivityAfter(dealId, draftGeneratedAt);
    if (activity) {
      return {
        completed: true, disregarded: false,
        completedAt: activity.at, activityType: activity.activityType, source: 'activity',
      };
    }
  }
  return { completed: false, disregarded: false, source: 'status' };
}
