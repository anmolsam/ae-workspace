import { config } from '../config/index.js';
import { httpJson } from '../lib/http.js';

/**
 * CalendarAdapter — fetches the AE's upcoming Google Calendar meetings using
 * the Google OAuth access token minted by Supabase Google SSO (with the
 * calendar.readonly scope). The web app forwards that provider token; the
 * backend never stores it long-term.
 *
 * Honest states (spec §24/§37): if calendar is disabled or no token is present,
 * returns { enabled:false, meetings:[] } — the UI shows a real "connect
 * calendar / no meetings" state, never fabricated meetings.
 */
export async function listUpcomingEvents(googleAccessToken, { maxResults = 15 } = {}) {
  if (!config.calendarEnabled || !googleAccessToken) return { enabled: false, meetings: [] };
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', new Date().toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', String(maxResults));
  const data = await httpJson(url.toString(), { headers: { Authorization: `Bearer ${googleAccessToken}` } });
  const meetings = (data.items || [])
    .filter((e) => e.start?.dateTime)
    .map((e) => {
      const attendees = (e.attendees || []).map((a) => a.email).filter(Boolean);
      const external = attendees.filter((em) => config.allowedEmailDomain && !em.endsWith(`@${config.allowedEmailDomain}`));
      const domain = external[0]?.split('@')[1] || null;
      return {
        id: e.id,
        title: e.summary || '(no title)',
        startsAt: e.start.dateTime,
        endsAt: e.end?.dateTime || null,
        attendees,
        externalDomain: domain,
        company: domain ? domain.replace(/\.[a-z]+$/, '') : null,
      };
    });
  return { enabled: true, meetings };
}
