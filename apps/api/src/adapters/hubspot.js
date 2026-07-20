import { config } from '../config/index.js';
import { httpJson, TtlCache } from '../lib/http.js';
import {
  HUBSPOT_PIPELINE_ID, DEAL_PROPS, STAGE_IDS, allDealReadProps,
  TRACKS, draftField, generatedAtField, statusField, dealUrl,
} from '@ae-workspace/shared';

/**
 * HubSpotAdapter — the ONLY module that talks to HubSpot. It reads deals,
 * follow-up drafts + upstream status, resolves owners, and reads engagement
 * activity for completion verification. It NEVER writes cadence fields.
 */
const auth = () => ({ Authorization: `Bearer ${config.hubspot.token}` });
const ownersCache = new TtlCache(10 * 60 * 1000); // owner list is stable-ish
const dealsCache = new TtlCache(60 * 1000);

/** Map a verified Google Workspace email -> HubSpot owner { id, email, name }.
 *  This is the SSO -> AE bridge. ROMA keys on owner id, so we return that. */
export async function getOwnerByEmail(email) {
  const owners = await ownersCache.wrap('owners', async () => {
    const out = [];
    let after;
    do {
      const url = new URL(`${config.hubspot.base}/crm/v3/owners`);
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);
      const page = await httpJson(url.toString(), { headers: auth() });
      for (const o of page.results || []) {
        out.push({ id: String(o.id), email: (o.email || '').toLowerCase(), name: `${o.firstName || ''} ${o.lastName || ''}`.trim() });
      }
      after = page.paging?.next?.after;
    } while (after);
    return out;
  });
  return owners.find((o) => o.email === email.toLowerCase()) || null;
}

/** Fetch all in-pipeline deals owned by a given owner id. */
export async function getDealsForOwner(ownerId) {
  return dealsCache.wrap(`deals:${ownerId}`, async () => {
    const results = [];
    let after;
    do {
      const page = await httpJson(`${config.hubspot.base}/crm/v3/objects/deals/search`, {
        method: 'POST',
        headers: auth(),
        body: {
          filterGroups: [{
            filters: [
              { propertyName: DEAL_PROPS.PIPELINE, operator: 'EQ', value: HUBSPOT_PIPELINE_ID },
              { propertyName: DEAL_PROPS.OWNER_ID, operator: 'EQ', value: ownerId },
            ],
          }],
          properties: allDealReadProps(),
          limit: 100,
          after,
          sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        },
      });
      results.push(...(page.results || []));
      after = page.paging?.next?.after;
    } while (after);
    return results.map(normalizeDeal);
  });
}

function normalizeDeal(raw) {
  const p = raw.properties || {};
  const slots = [];
  for (const t of Object.values(TRACKS)) {
    for (const n of t.slots) {
      slots.push({
        track: t.key,
        slot: n,
        stageLabel: t.label,
        draft: p[draftField(t.prefix, n)] || '',
        generatedAt: p[generatedAtField(t.prefix, n)] || null,
        status: p[statusField(t.prefix, n)] || '',
      });
    }
  }
  return {
    id: raw.id,
    name: p[DEAL_PROPS.NAME] || '(unnamed deal)',
    stageId: p[DEAL_PROPS.STAGE] || '',
    ownerId: p[DEAL_PROPS.OWNER_ID] || '',
    amount: p[DEAL_PROPS.AMOUNT] ? Number(p[DEAL_PROPS.AMOUNT]) : null,
    meetingDate: p[DEAL_PROPS.MEETING_DATE] || null,
    hubspotDealUrl: dealUrl(config.hubspot.portalId, raw.id),
    slots,
    raw: p,
  };
}

/**
 * Read qualifying engagement activity for a deal after a timestamp. This backs
 * the FollowUpCompletionVerifier's SECONDARY check. The PRIMARY signal is the
 * upstream `*_status` field (already reconciled by ROMA's grace-engine); this
 * exists for freshness / when status is stale between upstream ticks.
 *
 * Qualifying (mirrors the upstream definition in beam-fight-score-agent
 * activity/collector.js): outbound EMAIL that is not a meeting-confirmation, or
 * a CALL >= 60s, or an SMS — occurring after `sinceIso`.
 */
const MIN_CALL_SEC = 60;
export async function getQualifyingActivityAfter(dealId, sinceIso) {
  const since = sinceIso ? new Date(sinceIso).getTime() : 0;
  const found = [];
  // HubSpot v4 associations -> engagements. Kept minimal + batched by type.
  for (const type of ['emails', 'calls', 'communications']) {
    let after;
    try {
      do {
        const url = new URL(`${config.hubspot.base}/crm/v4/objects/deals/${dealId}/associations/${type}`);
        url.searchParams.set('limit', '100');
        if (after) url.searchParams.set('after', after);
        const assoc = await httpJson(url.toString(), { headers: auth() });
        const ids = (assoc.results || []).map((r) => r.toObjectId);
        if (ids.length) {
          const batch = await httpJson(`${config.hubspot.base}/crm/v3/objects/${type}/batch/read`, {
            method: 'POST', headers: auth(),
            body: { inputs: ids.map((id) => ({ id })), properties: engagementProps(type) },
          });
          for (const e of batch.results || []) {
            const q = qualifies(type, e.properties || {}, since);
            if (q) found.push(q);
          }
        }
        after = assoc.paging?.next?.after;
      } while (after);
    } catch (err) {
      // Never let a failed activity read falsely mark a task complete — swallow
      // and report "no qualifying activity found" for this type.
      if (err.status !== 404) throw err;
    }
  }
  found.sort((a, b) => new Date(a.at) - new Date(b.at));
  return found[0] || null; // earliest qualifying activity, or null
}

function engagementProps(type) {
  if (type === 'emails') return ['hs_timestamp', 'hs_email_direction', 'hs_email_subject', 'hs_email_text'];
  if (type === 'calls') return ['hs_timestamp', 'hs_call_duration', 'hs_call_direction', 'hs_call_status'];
  return ['hs_timestamp', 'hs_communication_channel_type'];
}

function qualifies(type, p, since) {
  const at = Number(p.hs_timestamp || 0);
  if (!at || at < since) return null;
  if (type === 'emails') {
    const dir = (p.hs_email_direction || '').toUpperCase();
    if (dir.includes('INCOMING') || dir.includes('FORWARDED')) return null;
    const subj = (p.hs_email_subject || '').toLowerCase();
    if (/\bdemo\b.*\bconfirmed\b/.test(subj) && !(p.hs_email_text || '').trim()) return null; // meeting-confirmation
    return { activityType: 'EMAIL', at: new Date(at).toISOString() };
  }
  if (type === 'calls') {
    const dur = Number(p.hs_call_duration || 0) / 1000;
    if (dur < MIN_CALL_SEC) return null;
    return { activityType: 'CALL', at: new Date(at).toISOString() };
  }
  if ((p.hs_communication_channel_type || '').toUpperCase() === 'SMS') {
    return { activityType: 'SMS', at: new Date(at).toISOString() };
  }
  return null;
}

// Resolve a dealstage id -> its human label from the live HubSpot pipeline
// (cached). Falls back to a title-cased known-stage name, and never surfaces a
// raw numeric id to the UI.
const stagesCache = new TtlCache(30 * 60 * 1000);
let stageLabelMap = null;

async function loadStageLabels() {
  return stagesCache.wrap('pipeline-stages', async () => {
    try {
      const data = await httpJson(`${config.hubspot.base}/crm/v3/pipelines/deals/${HUBSPOT_PIPELINE_ID}`, { headers: auth() });
      const map = {};
      for (const s of data.stages || []) map[String(s.id)] = s.label;
      return map;
    } catch {
      return {};
    }
  });
}

export async function primeStageLabels() {
  stageLabelMap = await loadStageLabels();
  return stageLabelMap;
}

const titleCaseKnown = (id) =>
  Object.entries(STAGE_IDS).find(([, v]) => v === id)?.[0]
    ?.toLowerCase().replace(/(^|_)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());

export const _stageLabelById = (id) =>
  (stageLabelMap && stageLabelMap[id]) || titleCaseKnown(id) || 'Deal stage';
