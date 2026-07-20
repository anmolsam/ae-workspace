import type {
  MeetingSummary, BriefStatus, BriefDetail, SectionKey, SectionStatusMap,
  SectionStatusValue, OrgTree, PriorDeal, OpenRole,
} from '../types/briefy';
import { SECTION_KEYS } from '../types/briefy';
import type Airtable from 'airtable';

const DAY_MS = 24 * 60 * 60 * 1000;

export function recordToMeetingSummary(record: Airtable.Record<Airtable.FieldSet>): MeetingSummary {
  return {
    id: record.id,
    dealName: (record.get('Deal Name') as string) || '',
    companyName: (record.get('Company Name') as string) || '',
    meetingDateTime: (record.get('Meeting Date & Time') as number) || 0,
    dealStage: (record.get('Deal Stage') as string) || '',
    briefStatus: ((record.get('Brief Status') as string) || 'Not Started') as BriefStatus,
  };
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(dayStart: number, todayStart: number): string {
  const diffDays = Math.round((dayStart - todayStart) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return new Date(dayStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Today through the next 7 days, one group per calendar day — empty days included on purpose. */
export function groupByDay(
  meetings: MeetingSummary[],
  now: number
): { label: string; meetings: MeetingSummary[] }[] {
  const todayStart = startOfLocalDay(now);
  const groups = Array.from({ length: 8 }, (_, i) => {
    const dayStart = todayStart + i * DAY_MS;
    return { dayStart, label: dayLabel(dayStart, todayStart), meetings: [] as MeetingSummary[] };
  });

  for (const m of meetings) {
    const dayIndex = Math.floor((m.meetingDateTime - todayStart) / DAY_MS);
    if (dayIndex >= 0 && dayIndex < groups.length) {
      groups[dayIndex].meetings.push(m);
    }
  }

  for (const g of groups) {
    g.meetings.sort((a, b) => a.meetingDateTime - b.meetingDateTime);
  }

  return groups.map(({ label, meetings }) => ({ label, meetings }));
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function deriveSectionState(
  briefStatus: string,
  sectionStatusJson: string | null | undefined,
  key: SectionKey
): SectionStatusValue {
  if (briefStatus === 'Error') return 'unavailable';
  const parsed = safeJsonParse<Partial<Record<SectionKey, SectionStatusValue>>>(sectionStatusJson, {});
  const value = parsed[key];
  if (value === 'ready' || value === 'error' || value === 'unavailable') return value;
  return 'pending';
}

function deriveAllSectionStates(briefStatus: string, sectionStatusJson: string | null | undefined): SectionStatusMap {
  return Object.fromEntries(
    SECTION_KEYS.map(key => [key, deriveSectionState(briefStatus, sectionStatusJson, key)])
  ) as SectionStatusMap;
}

export function recordToBriefDetail(record: Airtable.Record<Airtable.FieldSet>): BriefDetail {
  const briefStatus = ((record.get('Brief Status') as string) || 'Not Started') as BriefDetail['briefStatus'];
  const sectionStatusJson = record.get('Section Status') as string | null;

  return {
    id: record.id,
    dealName: (record.get('Deal Name') as string) || '',
    companyName: (record.get('Company Name') as string) || '',
    companyDomain: (record.get('Company Domain') as string) || '',
    meetingDateTime: (record.get('Meeting Date & Time') as number) || 0,
    dealStage: (record.get('Deal Stage') as string) || '',
    dealLink: (record.get('Deal Link') as string) || '',
    briefStatus,
    sectionStatus: deriveAllSectionStates(briefStatus, sectionStatusJson),
    overview: (record.get('Company Overview') as string) || '',
    portfolio: (record.get('Portfolio / Projects') as string) || '',
    orgTree: safeJsonParse<OrgTree>(record.get('Org Tree'), { estimators: [], programManagers: [], upperManagement: [] }),
    zoomInfoRevenue: (record.get('ZoomInfo Revenue') as string) || '',
    clayRevenue: (record.get('Clay Revenue') as string) || '',
    lastPageVisited: (record.get('Last Page Visited') as string) || '',
    lastPageVisitedAt: (record.get('Last Page Visited At') as string) || null,
    priorDeals: safeJsonParse<PriorDeal[]>(record.get('Prior Deals'), []),
    openRoles: safeJsonParse<OpenRole[]>(record.get('Open Roles'), []),
    zoomInfoIntentScore: (record.get('ZoomInfo Intent Score') as string) || '',
  };
}
