/**
 * CENTRALIZED HubSpot field configuration.
 *
 * This is the SINGLE source of truth for every HubSpot internal property name
 * the workspace touches. Nothing in apps/api or apps/web may hardcode a HubSpot
 * property string — import from here.
 *
 * Property names verified against the upstream cadence/draft engine
 * (anmolsam/beam-fight-score-agent, src/integrations/hubspot.js:50-58 and
 * src/v3/tracks.js:37-39) and against ROMA (PrashantAttentive/Project-ROMA,
 * fight_score_data.py). Do NOT rename these — they must match HubSpot exactly.
 *
 * The upstream engine OWNS these fields. This workspace READS the drafts and
 * status fields; it never rewrites the cadence fields (never rebuild the
 * cadence engine). App-local task state lives in Postgres, not HubSpot.
 */

export const HUBSPOT_PIPELINE_ID = '676188492'; // Beam AI Deals

/**
 * Deal-stage internal ids (HubSpot stage ids) for the three follow-up tracks
 * plus the stages ROMA's funnel reads. Stage entry timestamps use the
 * `hs_v2_date_entered_<stageId>` convention.
 */
export const STAGE_IDS = {
  DEMO_SCHEDULED: '1134585766',
  NO_SHOW: '1134585765',
  DISCOVERY_ONGOING: '1340568861',
  OPPORTUNITY_IDENTIFIED: '991336852', // "Qualified" boundary for QDD
  CLOSED_WON: '991336857',
  CUSTOMER_LIVE: '1211509158',
};

export const stageEnteredField = (stageId) => `hs_v2_date_entered_${stageId}`;

/**
 * The three follow-up tracks and their field prefixes. Each track has N slots.
 * Field name shape (from upstream tracks.js):
 *   draft:       `${prefix}_followup_email_${n}`
 *   generatedAt: `${prefix}_followup_${n}_generated_at`
 *   status:      `${prefix}_followup_${n}_status`
 */
export const TRACKS = {
  DS: { key: 'DS', prefix: 'ds', label: 'Demo Scheduled', slots: [0] },
  DO: { key: 'DO', prefix: 'do', label: 'Discovery Ongoing', slots: [1, 2, 3, 4] },
  OI: { key: 'OI', prefix: 'oi', label: 'Opportunity Identified', slots: [1, 2, 3, 4] },
};

export const draftField = (prefix, n) => `${prefix}_followup_email_${n}`;
export const generatedAtField = (prefix, n) => `${prefix}_followup_${n}_generated_at`;
export const statusField = (prefix, n) => `${prefix}_followup_${n}_status`;

/**
 * Upstream per-follow-up status enum (written by the cadence engine's
 * grace-engine). This is the AUTHORITATIVE completion signal.
 *   timely | delayed  -> follow-up genuinely completed (verified by HubSpot activity)
 *   none              -> not yet done; actionable (may be overdue)
 *   skipped_negative  -> disregard (prospect said no)
 *   paused_ooo        -> disregard (out of office)
 *   paused_meeting    -> disregard (future meeting scheduled)
 *   '' / null         -> not yet evaluated; treat as not-actionable until set
 */
export const FOLLOWUP_STATUS = {
  TIMELY: 'timely',
  DELAYED: 'delayed',
  NONE: 'none',
  SKIPPED_NEGATIVE: 'skipped_negative',
  PAUSED_OOO: 'paused_ooo',
  PAUSED_MEETING: 'paused_meeting',
};

export const DONE_STATUSES = new Set([FOLLOWUP_STATUS.TIMELY, FOLLOWUP_STATUS.DELAYED]);
export const DISREGARD_STATUSES = new Set([
  FOLLOWUP_STATUS.SKIPPED_NEGATIVE,
  FOLLOWUP_STATUS.PAUSED_OOO,
  FOLLOWUP_STATUS.PAUSED_MEETING,
]);

/** A follow-up slot is actionable (belongs in Taskee) when the draft is
 *  populated AND its status is exactly `none` (not done, not disregarded). */
export const isActionableStatus = (status) => status === FOLLOWUP_STATUS.NONE;
export const isDoneStatus = (status) => DONE_STATUSES.has(status);
export const isDisregardStatus = (status) => DISREGARD_STATUSES.has(status);

/** Other single deal properties we read. */
export const DEAL_PROPS = {
  NAME: 'dealname',
  STAGE: 'dealstage',
  PIPELINE: 'pipeline',
  AMOUNT: 'amount',
  OWNER_ID: 'hubspot_owner_id',
  OWNER_TEAM: 'owner_team', // "ACE AEs" | "SPADE AEs" | "CLUB"
  MEETING_DATE: 'meeting_date___time___sales',
  FINAL_STATUS: 'follow_up_final_status',
  LAST_FOLLOWUP_SENT_AT: 'last_followup_sent_at',
  PROSHORT_DETECTED_AT: 'proshort_detected_at',
};

/** Build the full read list for a deal fetch. */
export function allFollowUpProps() {
  const props = [];
  for (const t of Object.values(TRACKS)) {
    for (const n of t.slots) {
      props.push(draftField(t.prefix, n), generatedAtField(t.prefix, n), statusField(t.prefix, n));
    }
  }
  return props;
}

export function allDealReadProps() {
  return [
    ...Object.values(DEAL_PROPS),
    ...Object.values(STAGE_IDS).map(stageEnteredField),
    ...allFollowUpProps(),
  ];
}

/** Human label for a track slot, e.g. ("do", 2) -> "Follow-Up 2 · Discovery Ongoing". */
export function followUpLabel(trackKey, n) {
  const t = TRACKS[trackKey];
  return `Follow-Up ${n} · ${t.label}`;
}

/** Direct deal link for the "Open Deal in HubSpot ↗" action.
 *  HUBSPOT_PORTAL_ID comes from config (env), not hardcoded here. */
export function dealUrl(portalId, dealId) {
  return `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`;
}
