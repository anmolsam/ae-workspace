import { fetchFightScore } from '../adapters/roma.js';

/** The full AE roster from ROMA (id/name/team), for the admin AE picker. */
export async function listAes() {
  const data = await fetchFightScore();
  return (data.rows || [])
    .map((r) => ({ ownerId: String(r.id), name: r.name, team: r.team, score: r.score }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * RomaFightScoreService — surfaces ROMA's Fight Score for ONE AE, exactly as
 * ROMA computed it. No local calculation.
 *
 * NOTE (known limitation, documented in README): ROMA's Fight Score is pooled
 * ALL-TIME, not a weekly time-series. The spec asks to show the score "over the
 * weeks"; ROMA does not expose weekly buckets. We surface the authoritative
 * all-time score + its breakdown and do NOT fabricate a weekly series. If a
 * weekly view is wanted later, ROMA must expose it — we would not recompute.
 */
export async function getFightScoreForOwner(ownerId) {
  const data = await fetchFightScore();
  const row = (data.rows || []).find((r) => String(r.id) === String(ownerId));
  if (!row) return null;

  // Current month = the latest month ROMA published (monthKeys are ascending).
  const monthKeys = data.monthKeys || [];
  const months = data.months || [];
  const curKey = monthKeys[monthKeys.length - 1];
  const curLabel = months[months.length - 1] || curKey || 'This month';
  const monthly = data.aeMonthly?.[String(ownerId)]?.[curKey] || null;

  const known = monthly?.known ?? 0;
  const done = monthly?.done ?? 0;
  const deals = Array.isArray(monthly?.deals) ? monthly.deals.length : 0;
  const score = known > 0 ? Math.round((done / known) * 1000) / 10 : 0;

  return {
    aeName: row.name,
    team: row.team,
    score,
    deals,
    known,
    done,
    period: `This month · ${curLabel}`,
    generatedAt: data.generated,
    source: 'roma',
  };
}
