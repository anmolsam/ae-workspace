import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  opts: { retries?: number; retryDelayMs?: number } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const { retries = 0, retryDelayMs = 3000 } = opts;
  const retriesLeft = useRef(retries);
  useEffect(() => { retriesLeft.current = retries; }, [retries, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    fnRef
      .current(controller.signal)
      .then((res) => {
        if (!active) return;
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted) return;
        // Auto-retry transient failures (e.g. ROMA cold-start timeout) before
        // surfacing an error card.
        if (retriesLeft.current > 0) {
          retriesLeft.current -= 1;
          setTimeout(() => { if (active) setNonce((n) => n + 1); }, retryDelayMs);
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Keep data fresh: refetch when the tab regains focus / becomes visible,
  // throttled so rapid focus changes don't spam the API. This is why a stale
  // tab left open would otherwise show old meetings/scores.
  const lastFetchRef = useRef(0);
  useEffect(() => { lastFetchRef.current = Date.now(); }, [nonce, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const maybeRefetch = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastFetchRef.current < 15000) return;
      setNonce((n) => n + 1);
    };
    window.addEventListener('focus', maybeRefetch);
    document.addEventListener('visibilitychange', maybeRefetch);
    return () => {
      window.removeEventListener('focus', maybeRefetch);
      document.removeEventListener('visibilitychange', maybeRefetch);
    };
  }, []);

  return { data, loading, error, refetch };
}
