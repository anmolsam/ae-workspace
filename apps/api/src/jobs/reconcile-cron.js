import { reconcileAll } from '../services/reconciliation.js';

/**
 * In-process 30-minute scheduler. On Railway, the canonical trigger is the
 * platform cron hitting POST /internal/cron/reconcile (the guaranteed
 * backstop). This in-process loop is convenient for local dev / single-instance
 * deploys and is gated by ENABLE_INPROCESS_CRON so it never double-runs
 * alongside the platform cron in production.
 */
const THIRTY_MIN = 30 * 60 * 1000;

export function startInProcessCron() {
  if (process.env.ENABLE_INPROCESS_CRON !== 'true') return;
  const run = async () => {
    try {
      const report = await reconcileAll();
      console.log(`[cron] reconciled ${report.owners} owners`);
    } catch (err) {
      console.error('[cron] reconcile failed:', err.message);
    }
  };
  console.log('[cron] in-process reconciliation every 30m enabled');
  setTimeout(run, 5000); // initial run shortly after boot
  setInterval(run, THIRTY_MIN);
}
