import type { ApiErrorBody } from './types';

export const API_BASE = '/api/v1/me';

export type AuthErrorKind = 'no_matching_ae' | 'domain_not_allowed';

export class ApiError extends Error {
  status: number;
  kind?: string;
  body?: ApiErrorBody;

  constructor(status: number, message: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.kind = body?.error;
  }
}

export interface AuthTokens {
  accessToken: string | null;
  providerToken: string | null;
}

export interface ApiClientOptions {
  getTokens: () => AuthTokens;
  onUnauthorized: () => void;
  onForbidden: (kind: AuthErrorKind) => void;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  withGoogleToken?: boolean;
  signal?: AbortSignal;
}

export function createApiClient(opts: ApiClientOptions) {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { accessToken, providerToken } = opts.getTokens();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (options.withGoogleToken && providerToken) {
      headers['x-google-token'] = providerToken;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    if (res.status === 401) {
      opts.onUnauthorized();
      throw new ApiError(401, 'Unauthorized');
    }

    let parsed: unknown = undefined;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (res.status === 403) {
      const body = (parsed as ApiErrorBody) ?? {};
      if (body.error === 'no_matching_ae' || body.error === 'domain_not_allowed') {
        opts.onForbidden(body.error);
      }
      throw new ApiError(403, body.message ?? 'Forbidden', body);
    }

    if (!res.ok) {
      const body = (parsed as ApiErrorBody) ?? {};
      throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`, body);
    }

    return parsed as T;
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
