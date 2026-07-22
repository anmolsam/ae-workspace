import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AuthErrorKind } from '../lib/api';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  accessError: AuthErrorKind | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  reportAccessError: (kind: AuthErrorKind) => void;
  clearAccessError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<AuthErrorKind | null>(null);

  useEffect(() => {
    // TEMPORARY dev bypass (VITE_DEV_BYPASS): skip Google SSO, mount the app
    // with a synthetic session. Backend must have DEV_AUTH_BYPASS on too.
    if (import.meta.env.VITE_DEV_BYPASS === 'true') {
      setSession({
        access_token: 'dev-bypass',
        token_type: 'bearer',
        user: { email: import.meta.env.VITE_DEV_EMAIL ?? 'dev@local' },
      } as unknown as Session);
      setLoading(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) setAccessError(null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  }, []);

  // Passwordless email sign-in: Supabase emails a one-time "Sign in" link that
  // returns to the app authenticated. Verified email → mapped to the AE's
  // HubSpot owner server-side.
  const signInWithEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/taskee` },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setAccessError(null);
  }, []);

  const reportAccessError = useCallback((kind: AuthErrorKind) => {
    setAccessError(kind);
  }, []);

  const clearAccessError = useCallback(() => setAccessError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      accessError,
      signInWithGoogle,
      signInWithEmail,
      signOut,
      reportAccessError,
      clearAccessError,
    }),
    [session, loading, accessError, signInWithGoogle, signInWithEmail, signOut, reportAccessError, clearAccessError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
