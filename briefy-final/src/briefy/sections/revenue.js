import { enrichCompanyByDomain } from '../../lib/zoominfo.js';
import { triggerEnrichment } from '../../lib/clay.js';

/**
 * @param {string} domain
 * @param {string} dealId
 * @returns {Promise<{zoomInfoRevenue: string, clayRevenue: string, status: 'ready'}>}
 */
export async function buildRevenue(domain, dealId) {
  let zoomInfoRevenue = '';
  try {
    const data = await enrichCompanyByDomain(domain);
    zoomInfoRevenue = data?.revenue || '';
  } catch { /* leave blank — the rest of the brief still reports ready */ }

  const clay = await triggerEnrichment({ domain, dealId }).catch(() => ({ status: 'error' }));
  const clayRevenue = clay.status === 'triggered' ? 'pending' : clay.status === 'not_configured' ? 'not configured' : '';

  return { zoomInfoRevenue, clayRevenue, status: 'ready' };
}
