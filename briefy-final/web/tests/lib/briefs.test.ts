import { describe, it, expect } from 'vitest';
import { groupByDay, deriveSectionState, recordToBriefDetail } from '../../lib/briefs';
import type { MeetingSummary } from '../../types/briefy';

function meeting(overrides: Partial<MeetingSummary>): MeetingSummary {
  return {
    id: 'rec1',
    dealName: 'Acme — Q3 Renewal',
    companyName: 'Acme',
    meetingDateTime: Date.now(),
    dealStage: 'Demo Scheduled',
    briefStatus: 'Ready',
    ...overrides,
  };
}

describe('groupByDay', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-07-20T12:00:00Z').getTime();
  const startOfToday = now - (now % DAY_MS);

  it('labels today and tomorrow correctly, and groups by calendar day', () => {
    const todayMeeting = meeting({ id: 'a', meetingDateTime: startOfToday + 2 * 60 * 60 * 1000 });
    const tomorrowMeeting = meeting({ id: 'b', meetingDateTime: startOfToday + DAY_MS + 60 * 60 * 1000 });

    const groups = groupByDay([todayMeeting, tomorrowMeeting], now);

    expect(groups[0].label).toBe('Today');
    expect(groups[0].meetings.map(m => m.id)).toEqual(['a']);
    expect(groups[1].label).toBe('Tomorrow');
    expect(groups[1].meetings.map(m => m.id)).toEqual(['b']);
  });

  it('includes an empty day with no meetings rather than hiding it', () => {
    const groups = groupByDay([], now);
    expect(groups).toHaveLength(8); // today + next 7 days
    expect(groups.every(g => g.meetings.length === 0)).toBe(true);
  });

  it('sorts meetings within a day soonest-first', () => {
    const later = meeting({ id: 'later', meetingDateTime: startOfToday + 10 * 60 * 60 * 1000 });
    const earlier = meeting({ id: 'earlier', meetingDateTime: startOfToday + 2 * 60 * 60 * 1000 });

    const groups = groupByDay([later, earlier], now);

    expect(groups[0].meetings.map(m => m.id)).toEqual(['earlier', 'later']);
  });
});

describe('deriveSectionState', () => {
  it('is unavailable for every section when the whole brief errored', () => {
    expect(deriveSectionState('Error', null, 'overview')).toBe('unavailable');
  });

  it('is pending for every section while the brief is still generating and has no Section Status yet', () => {
    expect(deriveSectionState('Generating', null, 'overview')).toBe('pending');
    expect(deriveSectionState('Refreshing', null, 'overview')).toBe('pending');
    expect(deriveSectionState('Not Started', null, 'overview')).toBe('pending');
  });

  it('reads the specific key out of a valid Section Status JSON string once the brief is Ready', () => {
    const json = JSON.stringify({
      overview: 'ready', portfolio: 'ready', orgTree: 'error', revenue: 'ready',
      hubspotSignals: 'ready', hiringSignals: 'unavailable', intent: 'unavailable',
    });
    expect(deriveSectionState('Ready', json, 'orgTree')).toBe('error');
    expect(deriveSectionState('Ready', json, 'hiringSignals')).toBe('unavailable');
  });

  it('falls back to pending on malformed Section Status JSON rather than throwing', () => {
    expect(deriveSectionState('Ready', 'not json', 'overview')).toBe('pending');
  });

  it('falls back to pending when Section Status is the JSON literal "null", not just on parse failure', () => {
    expect(deriveSectionState('Ready', 'null', 'overview')).toBe('pending');
  });

  it('falls back to pending when the parsed JSON object is missing the requested key', () => {
    const json = JSON.stringify({ overview: 'ready' }); // no 'revenue' key at all
    expect(deriveSectionState('Ready', json, 'revenue')).toBe('pending');
  });

  it('reads the ready value directly when present', () => {
    const json = JSON.stringify({
      overview: 'ready', portfolio: 'ready', orgTree: 'ready', revenue: 'ready',
      hubspotSignals: 'ready', hiringSignals: 'ready', intent: 'ready',
    });
    expect(deriveSectionState('Ready', json, 'overview')).toBe('ready');
  });
});

describe('recordToBriefDetail', () => {
  it('safely parses empty/malformed JSON array fields to empty arrays', () => {
    const fakeRecord = {
      id: 'rec1',
      get: (field: string) => {
        const values: Record<string, unknown> = {
          'Deal Name': 'Acme — Q3',
          'Company Name': 'Acme',
          'Company Domain': 'acme.com',
          'Meeting Date & Time': 1234567890,
          'Deal Stage': 'Demo Scheduled',
          'Deal Link': 'https://app.hubspot.com/deal/1',
          'Brief Status': 'Ready',
          'Section Status': null,
          'Org Tree': 'not json',
          'Prior Deals': 'not json',
          'Open Roles': 'not json',
        };
        return values[field];
      },
    } as unknown as Parameters<typeof recordToBriefDetail>[0];

    const detail = recordToBriefDetail(fakeRecord);
    expect(detail.orgTree).toEqual({ estimators: [], programManagers: [], upperManagement: [] });
    expect(detail.priorDeals).toEqual([]);
    expect(detail.openRoles).toEqual([]);
    expect(detail.sectionStatus.overview).toBe('pending');
  });

  it('falls back to empty values when a JSON field is the literal string "null"', () => {
    const fakeRecord = {
      id: 'rec2',
      get: (field: string) => {
        const values: Record<string, unknown> = {
          'Deal Name': 'Acme — Q3', 'Company Name': 'Acme', 'Company Domain': 'acme.com',
          'Meeting Date & Time': 1234567890, 'Deal Stage': 'Demo Scheduled',
          'Deal Link': 'https://app.hubspot.com/deal/1', 'Brief Status': 'Ready',
          'Section Status': null, 'Org Tree': 'null', 'Prior Deals': 'null', 'Open Roles': 'null',
        };
        return values[field];
      },
    } as unknown as Parameters<typeof recordToBriefDetail>[0];

    const detail = recordToBriefDetail(fakeRecord);
    expect(detail.orgTree).toEqual({ estimators: [], programManagers: [], upperManagement: [] });
    expect(detail.priorDeals).toEqual([]);
    expect(detail.openRoles).toEqual([]);
  });
});
