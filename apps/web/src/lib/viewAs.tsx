import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * "View as AE" state (admin only). When an admin picks an AE, their owner id is
 * sent on every API request as `x-view-as-owner`, so the whole workspace shows
 * that AE's data. Regular AEs never set this (and the backend ignores it for
 * them). Persisted so it survives reloads within a session.
 */
interface ViewAs {
  ownerId: string | null;
  name: string | null;
}
interface ViewAsContextValue extends ViewAs {
  setViewAs: (v: ViewAs) => void;
  clear: () => void;
}

const KEY = 'ae-view-as';
const ViewAsContext = createContext<ViewAsContextValue | null>(null);

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewAs>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as ViewAs) : { ownerId: null, name: null };
    } catch {
      return { ownerId: null, name: null };
    }
  });

  const setViewAs = useCallback((v: ViewAs) => {
    setState(v);
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ }
  }, []);

  const clear = useCallback(() => {
    setState({ ownerId: null, name: null });
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ ...state, setViewAs, clear }), [state, setViewAs, clear]);
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>;
}

export function useViewAs(): ViewAsContextValue {
  const ctx = useContext(ViewAsContext);
  if (!ctx) throw new Error('useViewAs must be used within ViewAsProvider');
  return ctx;
}
