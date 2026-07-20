import { exaScrape, firecrawlScrape } from '../../lib/scrapers.js';
import { chatCompletion, parseJsonResponse } from '../../lib/requesty.js';

async function scrapeCompany(domain) {
  const exa = await exaScrape(domain).catch(() => null);
  if (exa && exa.pageCount >= 2) return exa.combined;

  const firecrawl = await firecrawlScrape(domain).catch(() => null);
  if (exa && firecrawl) {
    return `${exa.combined}\n\n${firecrawl.combined}`;
  }
  return firecrawl?.combined || exa?.combined || null;
}

async function synthesize(domain, combinedContent) {
  const prompt = `You are writing a pre-call brief section for a sales rep about to call ${domain}.

Below is scraped content from ${domain}'s own website:
---
${combinedContent.slice(0, 6000)}
---

Return ONLY valid JSON:
{
  "overview": "2-3 sentence plain-English summary of what this company does",
  "portfolio": "newline-separated list of any project/portfolio pages found on THEIR OWN site with a one-line note each, or empty string if none found — never invent one"
}`;
  const raw = await chatCompletion({ model: 'google/gemini-2.5-pro', messages: [{ role: 'user', content: prompt }], temperature: 0.1 });
  return parseJsonResponse(raw);
}

/**
 * @param {string} domain
 * @param {string} [existingExaContent] - already-scraped content copied from ICP Match
 *   Final (Task 2.2); reused directly instead of re-scraping when non-empty
 * @returns {Promise<{overview: string, portfolio: string, status: 'ready'|'unavailable'|'error'}>}
 */
export async function buildOverview(domain, existingExaContent) {
  try {
    let combinedContent = (existingExaContent || '').trim();
    if (!combinedContent) {
      combinedContent = await scrapeCompany(domain);
    }
    if (!combinedContent) return { overview: '', portfolio: '', status: 'unavailable' };

    const { overview, portfolio } = await synthesize(domain, combinedContent);
    return { overview: overview || '', portfolio: portfolio || '', status: 'ready' };
  } catch (err) {
    return { overview: '', portfolio: '', status: 'error', error: err.message };
  }
}
