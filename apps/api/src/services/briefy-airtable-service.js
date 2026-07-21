import { listBriefsForOwners, getBriefRow, requeueBrief, getIcpRowByDealId, createBriefRow } from '../adapters/briefy-airtable.js';
import { getScheduledMeetings } from '../adapters/hubspot.js';

/**
 * Briefy-from-Airtable service. Maps briefy-final's Airtable brief rows into the
 * ae-workspace Briefy DTOs (Meeting + Brief with dynamic sections), so the same
 * frontend renders real briefs. Per-AE scoping via the "Deal Owner" field.
 */

/** The Airtable "Deal Owner" values that belong to this AE (test + real). */
function ownerMatchers(ae) {
  const stripped = (ae.aeName || '').replace(/\s*\(test mirror\)\s*/i, '').trim();
  return [ae.email, ae.aeName, stripped].filter(Boolean);
}

const parseJson = (v, fallback) => {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

const briefStatusFor = (s) => {
  switch (s) {
    case 'Ready': return 'ready';
    case 'Generating': case 'Refreshing': return 'generating';
    case 'Error': return 'needs_data';
    default: return 'needs_generation'; // Not Started / blank
  }
};

const jobStatusFor = (s) => {
  switch (s) {
    case 'Ready': return 'completed';
    case 'Generating': case 'Refreshing': return 'processing';
    case 'Error': return 'failed';
    default: return 'queued';
  }
};

function rowToMeeting(row) {
  const f = row.fields || {};
  const meetingMs = typeof f['Meeting Date & Time'] === 'number' ? f['Meeting Date & Time'] : null;
  const startsAt = meetingMs ? new Date(meetingMs).toISOString() : (f['Last Enriched At'] || '');
  return {
    id: row.id,
    title: f['Company Name'] || f['Deal Name'] || '(untitled)',
    company: f['Company Name'] || '',
    startsAt,
    attendees: [],
    timeRemainingMs: meetingMs ? meetingMs - Date.now() : 0,
    briefStatus: briefStatusFor(f['Brief Status']),
    briefId: row.id,
  };
}

// Cap the Briefy list to the most relevant meetings (most recent by meeting
// date). Briefy is a pre-call tool, not a full CRM dump — showing an AE's
// entire book is noise. Overridable via BRIEFY_MAX_MEETINGS.
const MAX_MEETINGS = Number(process.env.BRIEFY_MAX_MEETINGS || 20);

/** Coerce ICP Match's epoch-ms-text meeting date to a number. */
function coerceMs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/** Seed a Briefy row for a scheduled demo not yet mirrored. ALL details come
 *  from ICP Match Final (company, domain, exa content, meeting date); HubSpot
 *  is only the checker that told us this deal belongs to the AE. Returns the
 *  new row, or null if the deal isn't in ICP Match Final. */
async function ensureBriefRow(meeting, dealOwner) {
  const icp = await getIcpRowByDealId(meeting.dealId).catch(() => null);
  if (!icp) return null; // details live in ICP Match — nothing to seed from
  const f = icp.fields || {};
  const fields = {
    'Deal ID': meeting.dealId,
    'Deal Name': f['Deal Name'] || meeting.dealName,
    'Company Name': f['Company Name'] || meeting.dealName,
    'Company Domain': f['Company domain'] || '',
    'Exa Content': f['Exa Content'] || '',
    'Trade Category': f['Trade Category'] || '',
    'ICP Enriched At': f['Enriched At'] || null,
    // Meeting date from ICP Match; fall back to HubSpot's only if ICP lacks it.
    'Meeting Date & Time': coerceMs(f['Meeting Date & Time']) ?? meeting.meetingMs,
    'Deal Owner': dealOwner,
    'Brief Status': 'Not Started',
  };
  return createBriefRow(fields).catch(() => null);
}

/**
 * GET /me/meetings — Briefy's meeting list.
 *
 * The LIST is sourced from HubSpot's scheduled demos (source of truth), so any
 * meeting booked in HubSpot appears immediately — independent of the ICP Match
 * -> Briefy mirror timing. Each is joined to its Briefy brief row (enrichment);
 * a scheduled demo with no brief row yet is lazily mirrored so a brief can be
 * generated. Past/earlier briefs are appended from Airtable for history.
 */
export async function getMeetingsFromAirtable(ae) {
  const stripped = (ae.aeName || '').replace(/\s*\(test mirror\)\s*/i, '').trim() || ae.aeName;
  const [hub, rows] = await Promise.all([
    getScheduledMeetings(ae.ownerId).catch(() => []),
    listBriefsForOwners(ownerMatchers(ae)),
  ]);

  const byDeal = new Map(rows.map((r) => [r.fields['Deal ID'], r]));
  const meetings = [];
  const seen = new Set();

  // 1. Authoritative scheduled meetings from HubSpot (lazily create missing rows).
  for (const m of hub) {
    seen.add(m.dealId);
    let brief = byDeal.get(m.dealId);
    if (!brief) brief = await ensureBriefRow(m, stripped);
    meetings.push(mergedMeeting(m, brief));
  }

  // 2. Earlier/other briefs with a meeting date (history) not already listed.
  for (const r of rows) {
    if (seen.has(r.fields['Deal ID'])) continue;
    meetings.push(rowToMeeting(r));
  }

  meetings.sort((a, b) => (b.startsAt ? Date.parse(b.startsAt) : 0) - (a.startsAt ? Date.parse(a.startsAt) : 0));
  return { calendarConnected: true, meetings: meetings.slice(0, MAX_MEETINGS) };
}

/** Meeting DTO for a scheduled demo, joined to its ICP-Match-sourced brief row.
 *  Company + meeting date come from ICP Match (the brief row); HubSpot only
 *  supplied the fallback name/date. */
function mergedMeeting(hubMeeting, brief) {
  const f = brief?.fields || {};
  const ms = (typeof f['Meeting Date & Time'] === 'number' ? f['Meeting Date & Time'] : null) ?? hubMeeting.meetingMs;
  return {
    id: brief?.id || `deal:${hubMeeting.dealId}`,
    title: f['Company Name'] || hubMeeting.dealName,
    company: f['Company Name'] || hubMeeting.dealName,
    startsAt: ms ? new Date(ms).toISOString() : '',
    attendees: [],
    timeRemainingMs: ms ? ms - Date.now() : 0,
    briefStatus: brief ? briefStatusFor(f['Brief Status']) : 'needs_data',
    briefId: brief?.id || null,
  };
}

const SECTION_KEYS = ['overview', 'portfolio', 'orgTree', 'revenue', 'hubspotSignals', 'hiringSignals', 'intent'];

/** Section state derived exactly as shashank's lib/briefs.ts deriveSectionState. */
function deriveSectionState(briefStatus, sectionStatusJson, key) {
  if (briefStatus === 'Error') return 'unavailable';
  const parsed = parseJson(sectionStatusJson, {});
  const v = parsed[key];
  return v === 'ready' || v === 'error' || v === 'unavailable' ? v : 'pending';
}

/**
 * GET /me/briefs/:id — returns the EXACT briefy-final BriefDetail shape
 * (shashank's lib/briefs.ts recordToBriefDetail), plus jobStatus for polling.
 * The frontend renders it with the same 7 sections / labels / empty-states.
 */
export async function getBriefFromAirtable(recordId) {
  const row = await getBriefRow(recordId);
  const f = row.fields || {};
  const briefStatus = f['Brief Status'] || 'Not Started';
  const sectionStatus = Object.fromEntries(SECTION_KEYS.map((k) => [k, deriveSectionState(briefStatus, f['Section Status'], k)]));

  return {
    id: row.id,
    meetingId: row.id,
    jobStatus: jobStatusFor(briefStatus),
    // shashank BriefDetail fields (verbatim mapping):
    briefStatus,
    companyName: f['Company Name'] || '',
    dealName: f['Deal Name'] || '',
    companyDomain: f['Company Domain'] || '',
    meetingDateTime: typeof f['Meeting Date & Time'] === 'number' ? f['Meeting Date & Time'] : 0,
    dealStage: f['Deal Stage'] || '',
    dealLink: f['Deal Link'] || '',
    sectionStatus,
    overview: f['Company Overview'] || '',
    portfolio: f['Portfolio / Projects'] || '',
    orgTree: parseJson(f['Org Tree'], { estimators: [], programManagers: [], upperManagement: [] }),
    zoomInfoRevenue: f['ZoomInfo Revenue'] || '',
    clayRevenue: f['Clay Revenue'] || '',
    lastPageVisited: f['Last Page Visited'] || '',
    lastPageVisitedAt: f['Last Page Visited At'] || null,
    priorDeals: parseJson(f['Prior Deals'], []),
    openRoles: parseJson(f['Open Roles'], []),
    zoomInfoIntentScore: f['ZoomInfo Intent Score'] || '',
  };
}

export async function requeueBriefFromAirtable(recordId) {
  await requeueBrief(recordId);
  return { status: 'queued', meetingId: recordId };
}
