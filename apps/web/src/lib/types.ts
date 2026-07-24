export type Role = string;

export interface Me {
  email: string;
  aeName: string;
  role: Role;
  isAdmin?: boolean;
}

export interface AeListItem {
  ownerId: string;
  name: string;
  team: string;
  score?: number;
}

export type Track = 'DS' | 'DO' | 'OI';

export type FollowUpBucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'week';

export type FollowUpState =
  | 'MANUALLY_CHECKED_PENDING_VERIFICATION'
  | 'COMPLETED_VERIFIED'
  | string;

export interface FollowUp {
  id: string;
  dealId: string;
  companyName: string;
  dealName: string;
  stageLabel: string;
  track: Track;
  slot: number;
  followUpLabel: string;
  draft: string;
  draftGeneratedAt: string;
  overdueAt: string;
  state: FollowUpState;
  checked: boolean;
  overdue: boolean;
  verifiedCompletedAt: string | null;
  hubspotDealUrl: string;
  bucket: FollowUpBucket;
}

export interface FollowUpSummary {
  dueToday: number;
  overdue: number;
  thisWeek: number;
}

export interface FollowUpsResponse {
  followUps: FollowUp[];
  summary: FollowUpSummary;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  pct: number | null;
  basisLabel: string;
}

export interface FunnelResponse {
  aeName: string;
  team: string;
  stages: FunnelStage[];
  period?: string;
  generatedAt: string;
  source: string;
}

export interface FightScoreResponse {
  aeName: string;
  team: string;
  score: number;
  deals: number;
  known: number;
  done: number;
  lt80?: number;
  period?: string;
  generatedAt: string;
  source: string;
}

export type BriefStatus =
  | 'ready'
  | 'generating'
  | 'needs_data'
  | 'needs_generation'
  | 'completed';

export interface Meeting {
  id: string;
  title: string;
  company: string;
  startsAt: string;
  attendees: string[];
  timeRemainingMs: number;
  briefStatus: BriefStatus;
  briefId: string | null;
}

export interface MeetingsResponse {
  calendarConnected: boolean;
  meetings: Meeting[];
}

export interface GenerateBriefResponse {
  status: string;
  meetingId: string;
}

export type BriefJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type BriefSectionKind = 'markdown' | 'list' | 'keyvalue';

export interface BriefListItem {
  title?: string;
  url?: string;
  snippet?: string;
}

export type BriefSectionContent =
  | string
  | BriefListItem[]
  | Record<string, string>;

export interface BriefSection {
  key: string;
  title: string;
  order: number;
  kind: BriefSectionKind;
  content: BriefSectionContent;
}

export interface BriefSource {
  provider: string;
  kind: string;
}

export interface Brief {
  id: string;
  meetingId: string;
  jobStatus: BriefJobStatus;
  generatedAt?: string;
  sections?: BriefSection[];
  sources?: BriefSource[];
  // briefy-final BriefDetail fields (shashank's exact output), returned inline.
  briefStatus?: BriefDetailStatus;
  companyName?: string;
  dealName?: string;
  companyDomain?: string;
  meetingDateTime?: number;
  dealStage?: string;
  dealLink?: string;
  sectionStatus?: Record<SectionKey, SectionStatusValue>;
  overview?: string;
  portfolio?: string;
  orgTree?: OrgTree;
  zoomInfoRevenue?: string;
  company?: CompanyInfo | null;
  clayRevenue?: string;
  lastPageVisited?: string;
  lastPageVisitedAt?: string | null;
  priorDeals?: PriorDeal[];
  openRoles?: OpenRole[];
  zoomInfoIntentScore?: string;
}

// ---- briefy-final exact brief output (mirrors shashank's types/briefy.ts) ----
export type BriefDetailStatus = 'Not Started' | 'Generating' | 'Ready' | 'Error' | 'Refreshing';
export type SectionKey =
  | 'overview' | 'portfolio' | 'orgTree' | 'revenue'
  | 'hubspotSignals' | 'hiringSignals' | 'intent';
export type SectionStatusValue = 'ready' | 'pending' | 'error' | 'unavailable';

export interface CompanyInfo {
  name?: string; website?: string; revenue?: string; employeeCount?: string | number;
  foundedYear?: string | number; industry?: string; phone?: string; location?: string;
  description?: string;
}
export interface OrgTreeContact { name?: string; title?: string; email?: string; phone?: string; linkedin?: string; source?: string; }
export interface OrgTree { estimators: OrgTreeContact[]; programManagers: OrgTreeContact[]; upperManagement: OrgTreeContact[]; }
export interface PriorDeal { dealName: string; dealOwner: string; dealLink: string; meetingDateTimeSales?: string | null; }
export interface OpenRole { title: string; source: string; link: string; }

export type ApiErrorKind = 'no_matching_ae' | 'domain_not_allowed' | string;

export interface ApiErrorBody {
  error?: ApiErrorKind;
  message?: string;
}
