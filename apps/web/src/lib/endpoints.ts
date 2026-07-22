import type { ApiClient } from './api';
import type {
  AeListItem,
  Brief,
  FightScoreResponse,
  FollowUp,
  FollowUpsResponse,
  FunnelResponse,
  GenerateBriefResponse,
  Me,
  MeetingsResponse,
} from './types';

export function getMe(api: ApiClient, signal?: AbortSignal): Promise<Me> {
  return api.request<Me>('/', { signal });
}

export function getAes(api: ApiClient, signal?: AbortSignal): Promise<{ aes: AeListItem[] }> {
  return api.request<{ aes: AeListItem[] }>('/aes', { signal });
}

export function getFollowUps(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<FollowUpsResponse> {
  return api.request<FollowUpsResponse>('/follow-ups', { signal });
}

export function checkFollowUp(api: ApiClient, id: string): Promise<FollowUp> {
  return api.request<FollowUp>(`/follow-ups/${encodeURIComponent(id)}/check`, {
    method: 'POST',
  });
}

export function uncheckFollowUp(api: ApiClient, id: string): Promise<FollowUp> {
  return api.request<FollowUp>(`/follow-ups/${encodeURIComponent(id)}/uncheck`, {
    method: 'POST',
  });
}

export function getFunnel(api: ApiClient, signal?: AbortSignal): Promise<FunnelResponse> {
  return api.request<FunnelResponse>('/funnel', { signal });
}

export function getFightScore(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<FightScoreResponse> {
  return api.request<FightScoreResponse>('/fight-score', { signal });
}

export function getMeetings(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<MeetingsResponse> {
  return api.request<MeetingsResponse>('/meetings', {
    withGoogleToken: true,
    signal,
  });
}

export function generateBrief(
  api: ApiClient,
  meetingId: string,
): Promise<GenerateBriefResponse> {
  return api.request<GenerateBriefResponse>(
    `/meetings/${encodeURIComponent(meetingId)}/generate-brief`,
    { method: 'POST', withGoogleToken: true },
  );
}

export function getBrief(
  api: ApiClient,
  briefId: string,
  signal?: AbortSignal,
): Promise<Brief> {
  return api.request<Brief>(`/briefs/${encodeURIComponent(briefId)}`, { signal });
}
