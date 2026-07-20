import { listBriefsForOwners, getBriefRow, requeueBrief } from '../adapters/briefy-airtable.js';

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

/** GET /me/meetings — the AE's brief rows as "meetings". */
export async function getMeetingsFromAirtable(ae) {
  const rows = await listBriefsForOwners(ownerMatchers(ae));
  const meetings = rows.map(rowToMeeting).sort((a, b) => {
    // Ready first, then by startsAt.
    const rank = (m) => (m.briefStatus === 'ready' ? 0 : 1);
    return rank(a) - rank(b) || String(a.startsAt).localeCompare(String(b.startsAt));
  });
  return { calendarConnected: true, meetings };
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
