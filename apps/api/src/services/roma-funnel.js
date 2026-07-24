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
// Marketing + SDR Inbound only (exclude O = SDR Outbound), per the AE view.
const SOURCES = ['M', 'I'];
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** Month keys ("YYYY-MM-01") of the quarter BEFORE the one containing `now`. */
function prevQuarterKeys(now) {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3); // 0..3
  let py = y, pq = q - 1;
  if (pq < 0) { pq = 3; py = y - 1; }
  const startMonth = pq * 3; // 0,3,6,9
  const keys = [], labels = [];
  for (let i = 0; i < 3; i++) {
    const mm = String(startMonth + i + 1).padStart(2, '0');
    keys.push(`${py}-${mm}-01`);
  }
  return { keys, label: `Q${pq + 1} ${py}` };
}

// Sum a metric across SOURCES, but only over the given month indices.
function sumMetric(ownerMonthly, metric, indices) {
  let total = 0;
  for (const src of SOURCES) {
    const arr = ownerMonthly?.[src]?.[metric];
    if (!Array.isArray(arr)) continue;
    for (const i of indices) total += arr[i] || 0;
  }
  return total;
}

function buildStages(demos, dcc, qdd, pilots, cw) {
  return [
    { key: 'demos', label: 'Total Demos', count: demos, pct: 100, basisLabel: '' },
    { key: 'dcc', label: 'DCC', count: dcc, pct: pct(dcc, demos), basisLabel: 'of Total Demos' },
    { key: 'qdd', label: 'QDD', count: qdd, pct: pct(qdd, dcc), basisLabel: 'of DCC' },
    { key: 'pilots', label: 'Pilots', count: pilots, pct: pct(pilots, dcc), basisLabel: 'of DCC' },
    { key: 'cw', label: 'Closed Won', count: cw, pct: pct(cw, dcc), basisLabel: 'of DCC' },
  ];
}

/** Aggregate last-quarter (Marketing + Inbound) funnel across ALL AEs. */
export async function getFunnelOverall(now = new Date()) {
  const data = await fetchAeCr();
  const monthKeys = data.monthKeys || [];
  const { keys: qKeys, label: qLabel } = prevQuarterKeys(now);
  const indices = qKeys.map((k) => monthKeys.indexOf(k)).filter((i) => i >= 0);
  const owners = Object.values(data.byOwnerBySrc || {});
  const agg = (metric) => owners.reduce((sum, o) => sum + sumMetric(o.monthly || {}, metric, indices), 0);
  const demos = agg('demos'), dcc = agg('dcc'), qdd = agg('qdd'), pilots = agg('pilots'), cw = agg('cw');
  return {
    aeName: 'All AEs',
    team: 'Team',
    stages: buildStages(demos, dcc, qdd, pilots, cw),
    period: `${qLabel} · Marketing + Inbound · all AEs`,
    generatedAt: data.generated,
    source: 'roma',
  };
}

export async function getFunnelForOwner(ownerId, now = new Date()) {
  const data = await fetchAeCr();
  const owner = data.byOwnerBySrc?.[String(ownerId)];
  if (!owner) return null;

  const monthKeys = data.monthKeys || [];
  const { keys: qKeys, label: qLabel } = prevQuarterKeys(now);
  // Map the previous-quarter month keys to indices in ROMA's monthly arrays.
  const indices = qKeys.map((k) => monthKeys.indexOf(k)).filter((i) => i >= 0);

  const m = owner.monthly || {};
  const demos = sumMetric(m, 'demos', indices);
  const dcc = sumMetric(m, 'dcc', indices);
  const qdd = sumMetric(m, 'qdd', indices);
  const pilots = sumMetric(m, 'pilots', indices);
  const cw = sumMetric(m, 'cw', indices);

  const stages = buildStages(demos, dcc, qdd, pilots, cw);

  return {
    aeName: owner.name,
    team: (owner.team || '').replace(/ AEs$/, ''),
    stages,
    period: `${qLabel} · Marketing + Inbound`,
    generatedAt: data.generated,
    source: 'roma',
  };
}
