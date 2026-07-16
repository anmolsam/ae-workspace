import { config } from '../config/index.js';
import { db, verifyAccessToken } from '../db/supabase.js';
import { getOwnerByEmail } from '../adapters/hubspot.js';

/**
 * GoogleAuthService — turns a Supabase-issued Google-SSO access token into a
 * resolved AE identity. The email is Google-verified by Supabase; we then map
 * it to a HubSpot owner (ROMA + HubSpot both key on owner id) and cache the
 * mapping in `ae_identities`.
 *
 * Roles are stored per identity (default 'AE'); future roles (TEAM_LEAD,
 * REVOPS_ADMIN, SALES_LEADERSHIP) can widen scope later without changing the
 * isolation seam — regular AEs resolve to exactly one owner_id.
 */
export async function resolveIdentity(accessToken) {
  const user = await verifyAccessToken(accessToken);
  if (!user?.email) return { error: 'invalid_token' };
  const email = user.email.toLowerCase();

  if (config.allowedEmailDomain && !email.endsWith(`@${config.allowedEmailDomain}`)) {
    return { error: 'domain_not_allowed' };
  }

  // Cache-first identity lookup.
  const { data: cached } = await db.from('ae_identities').select('*').eq('email', email).maybeSingle();
  if (cached?.owner_id) {
    return { identity: { userId: user.id, email, ownerId: cached.owner_id, aeName: cached.ae_name, role: cached.role || 'AE' } };
  }

  // Map email -> HubSpot owner.
  const owner = await getOwnerByEmail(email);
  if (!owner) return { error: 'no_matching_ae' };

  const row = {
    supabase_user_id: user.id,
    email,
    owner_id: owner.id,
    ae_name: owner.name,
    role: 'AE',
    updated_at: new Date().toISOString(),
  };
  await db.from('ae_identities').upsert(row, { onConflict: 'email' });
  return { identity: { userId: user.id, email, ownerId: owner.id, aeName: owner.name, role: 'AE' } };
}
