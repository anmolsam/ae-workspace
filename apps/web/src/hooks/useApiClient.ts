import { useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useViewAs } from '../lib/viewAs';
import { createApiClient, type ApiClient } from '../lib/api';

export function useApiClient(): ApiClient {
  const { session, signOut, reportAccessError } = useAuth();
  const { ownerId: viewAsOwnerId } = useViewAs();

  return useMemo<ApiClient>(
    () =>
      createApiClient({
        getTokens: () => ({
          accessToken: session?.access_token ?? null,
          providerToken: session?.provider_token ?? null,
        }),
        getViewAsOwnerId: () => viewAsOwnerId,
        onUnauthorized: () => {
          void signOut();
        },
        onForbidden: (kind) => reportAccessError(kind),
      }),
    // viewAsOwnerId in deps => switching AE makes a new client => hooks refetch.
    [session?.access_token, session?.provider_token, viewAsOwnerId, signOut, reportAccessError],
  );
}
