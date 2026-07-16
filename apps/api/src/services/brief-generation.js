import { db } from '../db/supabase.js';
import { listUpcomingEvents } from '../adapters/calendar.js';
import { enrichCompanyAll, enrichPersonAll, availableProviders } from '../adapters/research/index.js';

/**
 * BriefGenerationService — owns the pre-call brief lifecycle
 * (Queued → Processing → Completed → Failed, spec §23) and the DYNAMIC brief
 * schema. Sections are stored as ordered rows, not a fixed shape, so sections
 * can be added/removed/reordered without a migration (spec §22).
 */

/** Upcoming meetings for the AE, each annotated with brief status. */
export async function getUpcomingMeetings(ae, googleAccessToken) {
  const { enabled, meetings } = await listUpcomingEvents(googleAccessToken);
  if (!enabled) return { calendarConnected: false, meetings: [] };

  // Look up any existing briefs for these meetings (owner-scoped).
  const ids = meetings.map((m) => m.id);
  const { data: briefs } = await db.from('pre_call_briefs').select('id, meeting_id, job_status').eq('owner_id', ae.ownerId).in('meeting_id', ids.length ? ids : ['_none_']);
  const byMeeting = new Map((briefs || []).map((b) => [b.meeting_id, b]));
  const now = Date.now();

  return {
    calendarConnected: true,
    meetings: meetings.map((m) => {
      const b = byMeeting.get(m.id);
      const past = m.endsAt && new Date(m.endsAt).getTime() < now;
      const briefStatus = past ? 'completed'
        : b?.job_status === 'completed' ? 'ready'
        : b?.job_status === 'processing' || b?.job_status === 'queued' ? 'generating'
        : m.externalDomain ? 'needs_generation' : 'needs_data';
      return {
        id: m.id, title: m.title, company: m.company, startsAt: m.startsAt,
        attendees: m.attendees, timeRemainingMs: new Date(m.startsAt).getTime() - now,
        briefStatus, briefId: b?.id || null,
      };
    }),
  };
}

/** Fetch a completed brief + its dynamic sections (owner-scoped). */
export async function getBrief(briefId, ownerId) {
  const { data: brief } = await db.from('pre_call_briefs').select('*').eq('id', briefId).eq('owner_id', ownerId).maybeSingle();
  if (!brief) return null;
  const { data: sections } = await db.from('brief_sections').select('*').eq('brief_id', briefId).order('order', { ascending: true });
  const { data: sources } = await db.from('research_sources').select('provider, kind, fetched_at').eq('brief_id', briefId);
  return {
    id: brief.id, meetingId: brief.meeting_id, jobStatus: brief.job_status,
    generatedAt: brief.generated_at,
    sections: (sections || []).map((s) => ({ key: s.key, title: s.title, order: s.order, kind: s.kind, content: s.content })),
    sources: sources || [],
  };
}

/**
 * Generate (or regenerate) a brief for a meeting. Runs the research fan-out and
 * assembles dynamic sections. Idempotent per (owner, meeting): re-running
 * refreshes the same brief row rather than duplicating.
 */
export async function generateBrief({ ownerId, meeting }) {
  const upsert = async (patch) => {
    const { data } = await db.from('pre_call_briefs')
      .upsert({ owner_id: ownerId, meeting_id: meeting.id, ...patch }, { onConflict: 'owner_id,meeting_id' })
      .select().single();
    return data;
  };
  let brief = await upsert({ job_status: 'processing' });
  try {
    const input = { domain: meeting.externalDomain, companyName: meeting.company };
    const [companyResults, personResults] = await Promise.all([
      enrichCompanyAll(input),
      Promise.all((meeting.attendees || []).slice(0, 3).map((email) => enrichPersonAll({ name: email.split('@')[0], email, companyName: meeting.company }))).then((a) => a.flat()),
    ]);

    const sections = assembleSections({ meeting, companyResults, personResults });
    await db.from('brief_sections').delete().eq('brief_id', brief.id);
    if (sections.length) {
      await db.from('brief_sections').insert(sections.map((s) => ({ brief_id: brief.id, ...s })));
    }
    await db.from('research_sources').delete().eq('brief_id', brief.id);
    const okSources = [...companyResults, ...personResults].filter((r) => r.ok);
    if (okSources.length) {
      await db.from('research_sources').insert(okSources.map((r) => ({ brief_id: brief.id, provider: r.provider, kind: r.kind, fetched_at: r.fetchedAt })));
    }
    brief = await upsert({ job_status: 'completed', generated_at: new Date().toISOString() });
    return brief;
  } catch (err) {
    await upsert({ job_status: 'failed', error: err.message });
    throw err;
  }
}

/** Turn raw provider results into ordered, dynamic sections. The renderer is
 *  schema-flexible, so this can grow without frontend changes. */
function assembleSections({ meeting, companyResults, personResults }) {
  const sections = [];
  let order = 0;
  const add = (key, title, kind, content) => { if (content) sections.push({ key, title, order: order++, kind, content }); };

  add('overview', 'Company Overview', 'keyvalue', pickCompanyFacts(companyResults));
  const news = companyResults.filter((r) => r.ok && r.data?.results).flatMap((r) => r.data.results).slice(0, 5);
  if (news.length) add('news', 'Relevant News & Web', 'list', news.map((n) => ({ title: n.title, url: n.url, text: n.text })));
  const people = personResults.filter((r) => r.ok && r.data?.results).flatMap((r) => r.data.results).slice(0, 5);
  if (people.length) add('attendees', 'Attendee Background', 'list', people.map((p) => ({ title: p.title, url: p.url, text: p.text })));
  return sections;
}

function pickCompanyFacts(companyResults) {
  const zi = companyResults.find((r) => r.provider === 'zoominfo' && r.ok)?.data?.company;
  if (!zi) return null;
  return { Industry: zi.primaryIndustry, Employees: zi.employeeCount, Revenue: zi.revenueRange, Location: [zi.state, zi.country].filter(Boolean).join(', '), Website: zi.website };
}

export const providerStatus = () => availableProviders().map((p) => p.name);
