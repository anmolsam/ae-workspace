import { useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { createApiClient, type ApiClient } from '../lib/api';

export function useApiClient(): ApiClient {
  const { session, signOut, reportAccessError } = useAuth();

  return useMemo<ApiClient>(
    () =>
      createApiClient({
        getTokens: () => ({
          accessToken: session?.access_token ?? null,
          providerToken: session?.provider_token ?? null,
        }),
        onUnauthorized: () => {
          void signOut();
        },
        onForbidden: (kind) => reportAccessError(kind),
      }),
    [session?.access_token, session?.provider_token, signOut, reportAccessError],
  );
}
