import { useEffect, useState } from 'react';
import { useApiClient } from '../../hooks/useApiClient';
import { useViewAs } from '../../lib/viewAs';
import { getAes } from '../../lib/endpoints';
import type { AeListItem } from '../../lib/types';

/**
 * Admin-only "view as AE" picker. Selecting an AE sets the view-as owner id,
 * which the API client sends on every request — so the whole workspace
 * (Taskee, Fight Score, funnel, Briefy) shows that AE's data.
 */
export function AeSwitcher() {
  const api = useApiClient();
  const { ownerId, setViewAs, clear } = useViewAs();
  const [aes, setAes] = useState<AeListItem[]>([]);

  useEffect(() => {
    let active = true;
    // ROMA does a read-time refresh on a cold hit, so the first call can 500.
    // Retry once after a short delay before giving up (non-admins get 403 — no retry).
    const load = (retry: boolean) =>
      getAes(api)
        .then((r) => { if (active) setAes(r.aes); })
        .catch((err) => {
          if (active && retry && err?.status !== 403) setTimeout(() => load(false), 2500);
        });
    load(true);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden text-xs font-medium text-ink-subtle sm:inline">Viewing:</span>
      <select
        value={ownerId ?? ''}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) { clear(); return; }
          const ae = aes.find((a) => a.ownerId === id);
          setViewAs({ ownerId: id, name: ae?.name ?? id });
        }}
        className="max-w-[11rem] rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
      >
        <option value="">Me (admin)</option>
        {aes.map((a) => (
          <option key={a.ownerId} value={a.ownerId}>
            {a.name}{a.team ? ` · ${a.team}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
