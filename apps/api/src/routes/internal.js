import { Router } from 'express';
import { config } from '../config/index.js';
import { reconcileAll } from '../services/reconciliation.js';

/**
 * Internal routes — protected by a shared secret, hit by the Railway cron
 * every 30 minutes (spec §12/§30). Not user-facing; no AE identity.
 */
export const internalRouter = Router();

function requireCronSecret(req, res, next) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!config.cronSecret || secret !== config.cronSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

internalRouter.post('/cron/reconcile', requireCronSecret, async (req, res, next) => {
  try {
    const report = await reconcileAll();
    res.json({ ok: true, ...report });
  } catch (err) { next(err); }
});
