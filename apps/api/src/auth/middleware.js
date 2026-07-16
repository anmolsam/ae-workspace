import { resolveIdentity } from './google-auth.js';

/**
 * requireAuth — the backend isolation seam. Every /api/v1/me/* route uses ONLY
 * req.ae.ownerId (derived from the verified token) to scope data. There is no
 * code path where a client-supplied email/id selects the AE, so a regular AE
 * cannot fetch another AE's data by tampering with a request (spec §3/§29).
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  try {
    const { identity, error } = await resolveIdentity(token);
    if (error) {
      const code = error === 'domain_not_allowed' || error === 'no_matching_ae' ? 403 : 401;
      return res.status(code).json({ error });
    }
    req.ae = identity;
    next();
  } catch (err) {
    next(err);
  }
}

/** Future role gating. AEs pass through; wider roles reserved for later. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.ae) return res.status(401).json({ error: 'unauthorized' });
    if (roles.length && !roles.includes(req.ae.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
