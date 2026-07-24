import { useApiClient } from './useApiClient';
import { useAsync } from './useAsync';
import { getMeetings } from '../lib/endpoints';
import type { MeetingsResponse } from '../lib/types';

export function useMeetings() {
  const api = useApiClient();
  return useAsync<MeetingsResponse>((signal) => getMeetings(api, signal), [api], { resetOnDepsChange: true });
}
