import { enrichIntent } from '../../lib/zoominfo.js';
import { companyNews } from '../../lib/scrapers.js';
import { chatCompletion } from '../../lib/requesty.js';

function getTopics() {
  return (process.env.ZOOMINFO_INTENT_TOPICS || '').split(',').map((t) => t.trim()).filter(Boolean);
}

/** Synthesize a buying-intent read from recent news when ZoomInfo intent is
 *  unavailable. Returns a short string, or '' if no signal. */
async function intentFromSignals(domain, companyName) {
  const news = await companyNews(companyName, domain, 6).catch(() => []);
  if (!news.length) return '';
  const context = news.map((n) => `- ${n.title}: ${n.text}`).join('\n').slice(0, 4000);
  const prompt = `You are assessing BUYING INTENT for a sales rep selling AI construction takeoff/estimating software to ${companyName || domain}.

Recent news/signals about them:
---
${context}
---

Based ONLY on these signals, output ONE short line (max 25 words) describing buying-intent signals (growth, hiring estimators, new projects/contracts, tech adoption). Start with High / Medium / Low. If nothing relevant, output exactly "No strong signals". No preamble.`;
  try {
    const raw = await chatCompletion({ model: 'google/gemini-2.5-pro', messages: [{ role: 'user', content: prompt }], temperature: 0.2 });
    const line = String(raw || '').trim().replace(/^["']|["']$/g, '');
    return line && !/^no strong signals$/i.test(line) ? `${line} (from recent news)` : '';
  } catch {
    return '';
  }
}

/**
 * @param {string} domain
 * @param {string} [companyName]
 * @returns {Promise<{intentScore: string, status: 'ready'|'unavailable'|'error'}>}
 */
export async function buildIntent(domain, companyName) {
  const topics = getTopics();

  // Primary: ZoomInfo intent (when topics are configured + entitled).
  if (topics.length) {
    try {
      const result = await enrichIntent(domain, topics);
      if (result && (result.score ?? '') !== '') return { intentScore: String(result.score), status: 'ready' };
    } catch { /* fall through to signal-based intent */ }
  }

  // Fallback: derive intent from real recent-news signals (Exa + LLM).
  const signal = await intentFromSignals(domain, companyName);
  if (signal) return { intentScore: signal, status: 'ready' };
  return { intentScore: '', status: 'ready' };
}
