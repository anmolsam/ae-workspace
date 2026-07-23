import { exaScrape, firecrawlScrape, jinaScrape, companyNews } from '../../lib/scrapers.js';
import { chatCompletion, parseJsonResponse } from '../../lib/requesty.js';

// Only runs when ICP Match has NO stored content for the company (buildOverview
// reuses existingExaContent first). Jina is the primary live scraper now — Exa
// and Firecrawl credits are exhausted, so they're just last-ditch fallbacks.
async function scrapeCompany(domain) {
  const jina = await jinaScrape(domain).catch(() => null);
  if (jina && jina.pageCount >= 1) return jina.combined;

  const exa = await exaScrape(domain).catch(() => null);
  if (exa && exa.pageCount >= 2) return exa.combined;

  const firecrawl = await firecrawlScrape(domain).catch(() => null);
  return firecrawl?.combined || exa?.combined || jina?.combined || null;
}

async function synthesize(domain, combinedContent, news) {
  const newsBlock = news.length
    ? `\n\nRecent news/press about them (from the web):\n${news.map((n) => `- ${n.title}: ${n.text}`).join('\n').slice(0, 2500)}`
    : '';
  const prompt = `You are writing a pre-call brief section for a sales rep about to call ${domain}.

Below is scraped content from ${domain}'s own website:
---
${combinedContent.slice(0, 6000)}
---${newsBlock}

Return ONLY valid JSON:
{
  "overview": "3-4 sentence plain-English summary of what this company does; if the recent news adds a notable, verifiable fact (growth, a major project, an award), weave in ONE such fact — never invent anything",
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
/** ICP Match writes a placeholder when its scrapers found nothing — treat that
 *  as empty so we re-scrape live (via Jina) instead of summarizing "not found". */
function isPlaceholder(content) {
  return /PAGES SCRAPED \(0\)/i.test(content) || /Not Found\b/i.test(content) || /no data found/i.test(content);
}

export async function buildOverview(domain, existingExaContent, companyName) {
  try {
    let combinedContent = (existingExaContent || '').trim();
    if (!combinedContent || isPlaceholder(combinedContent)) {
      combinedContent = await scrapeCompany(domain);
    }
    if (!combinedContent) return { overview: '', portfolio: '', status: 'unavailable' };

    // Enrich the summary with recent web news (non-fatal if it returns nothing).
    const news = await companyNews(companyName, domain, 5).catch(() => []);
    const { overview, portfolio } = await synthesize(domain, combinedContent, news);
    return { overview: overview || '', portfolio: portfolio || '', status: 'ready' };
  } catch (err) {
    return { overview: '', portfolio: '', status: 'error', error: err.message };
  }
}
