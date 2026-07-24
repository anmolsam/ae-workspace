import { enrichCompanyByDomain } from '../../lib/zoominfo.js';
import { mcpAvailable, enrichCompanyMcp } from '../../lib/zoominfo-mcp.js';
import { triggerEnrichment } from '../../lib/clay.js';

/**
 * @param {string} domain
 * @param {string} dealId
 * @returns {Promise<{zoomInfoRevenue: string, clayRevenue: string, company: object|null, status: 'ready'}>}
 */
export async function buildRevenue(domain, dealId) {
  let zoomInfoRevenue = '';
  let company = null;

  // Primary: ZoomInfo MCP company enrich (revenue + employees/founded/industry/etc.).
  if (mcpAvailable()) {
    try {
      company = await enrichCompanyMcp(domain);
      if (company?.revenue) zoomInfoRevenue = company.revenue;
    } catch { /* fall through */ }
  }

  // Fallback / fill: old REST enrich (company scope) for revenue when MCP is off or blank.
  if (!zoomInfoRevenue) {
    try {
      const data = await enrichCompanyByDomain(domain);
      zoomInfoRevenue = data?.revenue || '';
    } catch { /* leave blank — the rest of the brief still reports ready */ }
  }

  const clay = await triggerEnrichment({ domain, dealId }).catch(() => ({ status: 'error' }));
  const clayRevenue = clay.status === 'triggered' ? 'pending' : clay.status === 'not_configured' ? 'not configured' : '';

  return { zoomInfoRevenue, clayRevenue, company, status: 'ready' };
}
