import { fetchAeCr } from '../adapters/roma.js';

/**
 * RomaFunnelService — surfaces ROMA's AE funnel for ONE AE, essentially as-is.
 * ROMA returns per-owner arrays split by source (M = Marketing, I = SDR
 * Inbound, O = SDR Outbound), per month. We combine all sources and all months
 * (the AE's YTD funnel) and compute the SAME conversion ratios ROMA's UI shows:
 *   DCC   % of Total Demos
 *   QDD   % of DCC
 *   Pilots% of DCC
 *   ClosedWon % of DCC
 * These ratios are ROMA's definitions — we only sum the counts ROMA already
 * produced; we never re-derive stage membership.
 */
const SOURCES = ['M', 'I', 'O'];
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

function sumMetric(ownerMonthly, metric) {
  let total = 0;
  for (const src of SOURCES) {
    const arr = ownerMonthly?.[src]?.[metric];
    if (Array.isArray(arr)) total += arr.reduce((a, b) => a + (b || 0), 0);
  }
  return total;
}

export async function getFunnelForOwner(ownerId) {
  const data = await fetchAeCr();
  const owner = data.byOwnerBySrc?.[String(ownerId)];
  if (!owner) return null;

  const m = owner.monthly || {};
  const demos = sumMetric(m, 'demos');
  const dcc = sumMetric(m, 'dcc');
  const qdd = sumMetric(m, 'qdd');
  const pilots = sumMetric(m, 'pilots');
  const cw = sumMetric(m, 'cw');

  const stages = [
    { key: 'demos', label: 'Total Demos', count: demos, pct: 100, basisLabel: '' },
    { key: 'dcc', label: 'DCC', count: dcc, pct: pct(dcc, demos), basisLabel: 'of Total Demos' },
    { key: 'qdd', label: 'QDD', count: qdd, pct: pct(qdd, dcc), basisLabel: 'of DCC' },
    { key: 'pilots', label: 'Pilots', count: pilots, pct: pct(pilots, dcc), basisLabel: 'of DCC' },
    { key: 'cw', label: 'Closed Won', count: cw, pct: pct(cw, dcc), basisLabel: 'of DCC' },
  ];

  return {
    aeName: owner.name,
    team: (owner.team || '').replace(/ AEs$/, ''),
    stages,
    generatedAt: data.generated,
    source: 'roma',
  };
}
