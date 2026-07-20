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

/** GET /me/briefs/:id — full brief with dynamic sections built from Airtable. */
export async function getBriefFromAirtable(recordId) {
  const row = await getBriefRow(recordId);
  const f = row.fields || {};
  const sections = [];
  let order = 0;
  const add = (key, title, kind, content) => { if (hasContent(content)) sections.push({ key, title, order: order++, kind, content }); };

  add('overview', 'Company Overview', 'markdown', f['Company Overview']);
  add('portfolio', 'Portfolio / Projects', 'markdown', f['Portfolio / Projects']);

  const org = parseJson(f['Org Tree'], null);
  if (org) {
    const kv = {};
    if (org.upperManagement?.length) kv['Upper Management'] = org.upperManagement.map(nameOf).join(', ');
    if (org.programManagers?.length) kv['Program Managers'] = org.programManagers.map(nameOf).join(', ');
    if (org.estimators?.length) kv['Estimators'] = org.estimators.map(nameOf).join(', ');
    add('orgTree', 'Org Tree', 'keyvalue', Object.keys(kv).length ? kv : null);
  }

  const revenue = {};
  if (f['ZoomInfo Revenue']) revenue['ZoomInfo Revenue'] = String(f['ZoomInfo Revenue']);
  if (f['Clay Revenue'] && f['Clay Revenue'] !== 'not configured') revenue['Clay Revenue'] = String(f['Clay Revenue']);
  add('revenue', 'Revenue', 'keyvalue', Object.keys(revenue).length ? revenue : null);

  if (f['ZoomInfo Intent Score']) {
    add('intent', 'Buying Intent', 'keyvalue', { 'ZoomInfo Intent Score': String(f['ZoomInfo Intent Score']) });
  }

  const roles = parseJson(f['Open Roles'], []);
  add('hiring', 'Hiring Signals', 'list', roles.map((r) => ({ title: r.title || r.role, url: r.url, snippet: r.source ? `via ${r.source}` : undefined })));

  const priorDeals = parseJson(f['Prior Deals'], []);
  const hs = [];
  if (f['Last Page Visited']) hs.push({ title: `Last page: ${f['Last Page Visited']}`, snippet: f['Last Page Visited At'] || undefined });
  for (const d of priorDeals) hs.push({ title: typeof d === 'string' ? d : (d.name || d.dealName || 'Prior deal'), snippet: d.stage });
  add('hubspot', 'HubSpot Engagement', 'list', hs);

  return {
    id: row.id,
    meetingId: row.id,
    jobStatus: jobStatusFor(f['Brief Status']),
    generatedAt: f['Last Enriched At'] || '',
    sections,
    sources: deriveSources(f),
  };
}

export async function requeueBriefFromAirtable(recordId) {
  await requeueBrief(recordId);
  return { status: 'queued', meetingId: recordId };
}

function nameOf(p) { return typeof p === 'string' ? p : (p?.name || p?.fullName || ''); }
function hasContent(c) {
  if (c == null) return false;
  if (typeof c === 'string') return c.trim().length > 0;
  if (Array.isArray(c)) return c.length > 0;
  if (typeof c === 'object') return Object.keys(c).length > 0;
  return true;
}
function deriveSources(f) {
  const s = [];
  if (f['Company Overview']) s.push({ provider: 'exa', kind: 'company' });
  if (f['ZoomInfo Revenue']) s.push({ provider: 'zoominfo', kind: 'company' });
  if (f['Open Roles']) s.push({ provider: 'serpapi', kind: 'company' });
  if (f['Last Page Visited'] || f['Prior Deals']) s.push({ provider: 'hubspot', kind: 'company' });
  return s;
}
