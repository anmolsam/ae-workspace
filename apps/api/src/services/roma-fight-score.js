import { fetchFightScore } from '../adapters/roma.js';

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
  return {
    aeName: row.name,
    team: row.team,
    score: row.score,
    deals: row.deals,
    known: row.known,
    done: row.done,
    lt80: row.lt80,
    generatedAt: data.generated,
    source: 'roma',
  };
}
