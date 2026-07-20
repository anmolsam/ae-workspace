import { enrichIntent } from '../../lib/zoominfo.js';

function getTopics() {
  return (process.env.ZOOMINFO_INTENT_TOPICS || '').split(',').map(t => t.trim()).filter(Boolean);
}

/**
 * @param {string} domain
 * @returns {Promise<{intentScore: string, status: 'ready'|'unavailable'|'error'}>}
 */
export async function buildIntent(domain) {
  const topics = getTopics();
  if (!topics.length) return { intentScore: '', status: 'unavailable' };

  try {
    const result = await enrichIntent(domain, topics);
    if (!result) return { intentScore: '', status: 'ready' };
    return { intentScore: String(result.score ?? ''), status: 'ready' };
  } catch (err) {
    return { intentScore: '', status: 'error', error: err.message };
  }
}
