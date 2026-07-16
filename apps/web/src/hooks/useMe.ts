import { useApiClient } from './useApiClient';
import { useAsync } from './useAsync';
import { getMe } from '../lib/endpoints';
import type { Me } from '../lib/types';

export function useMe() {
  const api = useApiClient();
  return useAsync<Me>((signal) => getMe(api, signal), [api]);
}
