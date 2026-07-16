import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from './useApiClient';
import { checkFollowUp, getFollowUps, uncheckFollowUp } from '../lib/endpoints';
import type { FollowUp, FollowUpsResponse } from '../lib/types';

const DEFAULT_REFETCH_MS = 120000;

function refetchInterval(): number {
  const raw = import.meta.env.VITE_TASKEE_REFETCH_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REFETCH_MS;
}

export interface UseFollowUpsResult {
  data: FollowUpsResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  pendingIds: Set<string>;
  check: (fu: FollowUp) => Promise<void>;
  uncheck: (fu: FollowUp) => Promise<void>;
}

export function useFollowUps(): UseFollowUpsResult {
  const api = useApiClient();
  const [data, setData] = useState<FollowUpsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const controller = new AbortController();
    try {
      const res = await getFollowUps(api, controller.signal);
      if (mounted.current) {
        setData(res);
        setError(null);
      }
    } catch (err) {
      if (mounted.current && !controller.signal.aborted) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const id = window.setInterval(() => void load(), refetchInterval());
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(id);
    };
  }, [load]);

  const applyOptimistic = useCallback((id: string, patch: Partial<FollowUp>) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        followUps: prev.followUps.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      };
    });
  }, []);

  const setPending = useCallback((id: string, on: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const mutate = useCallback(
    async (fu: FollowUp, checked: boolean) => {
      const snapshot = fu;
      applyOptimistic(fu.id, { checked });
      setPending(fu.id, true);
      try {
        const updated = checked
          ? await checkFollowUp(api, fu.id)
          : await uncheckFollowUp(api, fu.id);
        applyOptimistic(fu.id, updated);
      } catch (err) {
        applyOptimistic(fu.id, snapshot);
        throw err;
      } finally {
        setPending(fu.id, false);
        await load();
      }
    },
    [api, applyOptimistic, setPending, load],
  );

  const check = useCallback((fu: FollowUp) => mutate(fu, true), [mutate]);
  const uncheck = useCallback((fu: FollowUp) => mutate(fu, false), [mutate]);

  return { data, loading, error, refetch: load, pendingIds, check, uncheck };
}
