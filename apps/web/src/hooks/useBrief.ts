import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from './useApiClient';
import { generateBrief, getBrief } from '../lib/endpoints';
import type { Brief } from '../lib/types';

const POLL_MS = 3000;
const MAX_POLLS = 60;

export interface UseBriefResult {
  brief: Brief | null;
  loading: boolean;
  polling: boolean;
  error: Error | null;
  generate: () => Promise<void>;
  reload: () => Promise<void>;
}

export interface UseBriefOptions {
  onGenerated?: () => void;
}

export function useBrief(
  meetingId: string,
  briefId: string | null,
  options: UseBriefOptions = {},
): UseBriefResult {
  const api = useApiClient();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  const onGenerated = options.onGenerated;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const poll = useCallback(
    async (id: string, count = 0) => {
      if (!mounted.current) return;
      try {
        const res = await getBrief(api, id);
        if (mounted.current) setBrief(res);
        if (res.jobStatus === 'completed' || res.jobStatus === 'failed') {
          setPolling(false);
          return;
        }
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err : new Error(String(err)));
      }
      if (count >= MAX_POLLS) {
        setPolling(false);
        return;
      }
      timer.current = window.setTimeout(() => void poll(id, count + 1), POLL_MS);
    },
    [api],
  );

  const reload = useCallback(async () => {
    if (!briefId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getBrief(api, briefId);
      if (mounted.current) setBrief(res);
      if (res.jobStatus === 'queued' || res.jobStatus === 'processing') {
        setPolling(true);
        void poll(briefId, 0);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [api, briefId, poll]);

  useEffect(() => {
    if (briefId) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefId]);

  const generate = useCallback(async () => {
    setError(null);
    setPolling(true);
    try {
      await generateBrief(api, meetingId);
      if (briefId) {
        void poll(briefId, 0);
      }
      onGenerated?.();
    } catch (err) {
      setPolling(false);
      if (mounted.current) setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [api, meetingId, briefId, poll, onGenerated]);

  return { brief, loading, polling, error, generate, reload };
}
