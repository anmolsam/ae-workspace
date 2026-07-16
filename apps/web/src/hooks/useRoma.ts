import { useApiClient } from './useApiClient';
import { useAsync } from './useAsync';
import { getFightScore, getFunnel } from '../lib/endpoints';
import type { FightScoreResponse, FunnelResponse } from '../lib/types';

export function useFunnel() {
  const api = useApiClient();
  return useAsync<FunnelResponse>((signal) => getFunnel(api, signal), [api]);
}

export function useFightScore() {
  const api = useApiClient();
  return useAsync<FightScoreResponse>((signal) => getFightScore(api, signal), [api]);
}
