import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS (the API is the
 * trusted layer that enforces per-AE scoping via owner_id on every query).
 * The browser uses the anon client for auth only; it never touches these tables
 * directly, and RLS policies (see supabase/migrations) deny anon access anyway.
 */
export const db = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Verify a Supabase-issued Google-SSO JWT and return the verified user. */
export async function verifyAccessToken(accessToken) {
  const { data, error } = await db.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user; // { id, email, ... } — email is Google-verified
}
