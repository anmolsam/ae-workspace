import { getOwnerForEmail } from '../../src/briefy/owner-map.js';

export type OwnerResolution =
  | { ok: true; dealOwner: string }
  | { ok: false; reason: 'not_attentive_domain' | 'not_mapped' };

/**
 * Pure decision function: is this email allowed into Briefy, and if so, which
 * Airtable "Deal Owner" does it map to? No I/O — safe to unit test directly.
 */
export function resolveOwner(
  email: string | null | undefined,
  lookupOwner: (email: string) => string | null = getOwnerForEmail
): OwnerResolution {
  if (!email || !email.toLowerCase().endsWith('@attentive.ai')) {
    return { ok: false, reason: 'not_attentive_domain' };
  }
  const dealOwner = lookupOwner(email);
  if (!dealOwner) {
    return { ok: false, reason: 'not_mapped' };
  }
  return { ok: true, dealOwner };
}
