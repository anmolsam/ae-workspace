export type BriefStatus = 'Not Started' | 'Generating' | 'Ready' | 'Error' | 'Refreshing';

export const SECTION_KEYS = [
  'overview',
  'portfolio',
  'orgTree',
  'revenue',
  'hubspotSignals',
  'hiringSignals',
  'intent',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/** 'pending' is frontend-only — the backend never writes it (see lib/briefs.ts deriveSectionState). */
export type SectionStatusValue = 'ready' | 'pending' | 'error' | 'unavailable';

export type SectionStatusMap = Record<SectionKey, SectionStatusValue>;

export interface MeetingSummary {
  id: string;
  dealName: string;
  companyName: string;
  meetingDateTime: number; // epoch ms
  dealStage: string;
  briefStatus: BriefStatus;
}

export interface PriorDeal {
  dealName: string;
  dealOwner: string;
  dealLink: string;
  meetingDateTimeSales: string | null;
}

export interface OpenRole {
  title: string;
  source: string;
  link: string;
}

export interface OrgTreeContact {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  source: string;
}

export interface OrgTree {
  estimators: OrgTreeContact[];
  programManagers: OrgTreeContact[];
  upperManagement: OrgTreeContact[];
}

export interface BriefDetail {
  id: string;
  dealName: string;
  companyName: string;
  companyDomain: string;
  meetingDateTime: number;
  dealStage: string;
  dealLink: string;
  briefStatus: BriefStatus;
  sectionStatus: SectionStatusMap;
  overview: string;
  portfolio: string;
  orgTree: OrgTree;
  zoomInfoRevenue: string;
  clayRevenue: string;
  lastPageVisited: string;
  lastPageVisitedAt: string | null;
  priorDeals: PriorDeal[];
  openRoles: OpenRole[];
  zoomInfoIntentScore: string;
}
