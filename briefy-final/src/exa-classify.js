/**
 * For ZoomInfo no-matches: Exa AI fetches clean indexed content from the company domain,
 * then Claude classifies from that content. Writes both the Exa content (for review)
 * and the ICP classification back to Airtable.
 *
 * Exa returns pre-indexed, clean text — no JS embeds, no video player garbage.
 * Falls back to Exa search (finds LinkedIn, articles, etc.) when direct fetch is thin.
 *
 * Usage: node src/exa-classify.js
 */
import 'dotenv/config';
import base, { getRecords, TABLES } from './lib/airtable.js';

const EXA_API_KEY = process.env.EXA_API_KEY;
const REQUESTY_API_KEY = process.env.REQUESTY_API_KEY;
const MODEL = 'anthropic/claude-sonnet-4-6';

const FIT_TO_ICP = {
  'Strong Fit': 'ICP',
  'Possible Fit': 'Needs Review',
  'Not Fit': 'Not ICP',
};
const FIT_TO_SCORE = {
  'Strong Fit': 100,
  'Possible Fit': 50,
  'Not Fit': 0,
};

async function exaGetContents(urls) {
  const res = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ids: urls,
      text: { maxCharacters: 2000 },
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).filter(r => r.text && r.text.trim().length > 100);
}

async function exaFindDomainPages(domain) {
  // Ask Exa to find the most content-rich pages from this domain
  // (homepage, about, services — whatever actually exists and is indexed)
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `${domain} services about us what we do contractor`,
      type: 'keyword',
      includeDomains: [domain],
      numResults: 5,
      contents: { text: { maxCharacters: 2000 } },
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).filter(r => r.text && r.text.trim().length > 100);
}

async function exaExternalSearch(domain, companyName) {
  // Last resort: find LinkedIn, Yelp, articles about the company from the open web
  const query = companyName && companyName !== 'unknown'
    ? `"${companyName}" contractor services what they do`
    : `${domain} company services industry`;

  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      type: 'keyword',
      numResults: 3,
      contents: { text: { maxCharacters: 1500 } },
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).filter(r => r.text && r.text.trim().length > 100);
}

async function getExaContent(domain, companyName) {
  const baseUrl = `https://${domain}`;

  // Step 1: pull homepage + common pages directly
  const directUrls = [baseUrl, `${baseUrl}/about-us`, `${baseUrl}/about`, `${baseUrl}/services`, `${baseUrl}/what-we-do`];
  const directResults = await exaGetContents(directUrls);

  // Step 2: Exa domain search — finds whichever pages are actually indexed & content-rich
  const domainResults = await exaFindDomainPages(domain);

  // Merge, deduplicate by URL, keep richest content
  const seen = new Set();
  const allPages = [...directResults, ...domainResults].filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  if (allPages.length > 0) {
    const sources = allPages.map(r => r.url).join(', ');
    const combined = allPages
      .map(r => `### ${r.title || r.url}\nURL: ${r.url}\n\n${r.text.trim()}`)
      .join('\n\n---\n\n');
    return { text: combined, sources, pageCount: allPages.length, source: 'multi-page' };
  }

  // Step 3: external fallback — LinkedIn, Yelp, news, directories
  const external = await exaExternalSearch(domain, companyName);
  if (external.length > 0) {
    const sources = external.map(r => r.url).join(', ');
    const combined = external.map(r => `### ${r.title || r.url}\nURL: ${r.url}\n\n${r.text.trim()}`).join('\n\n---\n\n');
    return { text: combined, sources, pageCount: external.length, source: 'external-search' };
  }

  return null;
}

async function classifyFromContent(domain, companyName, content, sourceUrl) {
  const prompt = `You are classifying whether a company matches the ideal customer profile for Beam AI (ibeam.ai), an AI takeoff and estimating software for construction trades.

Domain: ${domain}
Company name: ${companyName || 'unknown'}

Content retrieved from ${sourceUrl}:
---
${content}
---

Based on this content, classify the company for Beam AI.

Beam AI best fits:
- Direct construction companies: general contractors, subcontractors, builders, trade businesses
- Specialty trades: Electrical, Flooring, HVAC & Mechanical, Insulation, Roofing, Painting, Plumbing, Concrete & Rebar, Demolition, Earthwork, Civil, Masonry, Steel, Lumber

Strong Fit → contractor, subcontractor, builder, estimating firm, trade business that does construction work and would need takeoffs/estimating
Possible Fit → construction-adjacent: consulting, preconstruction advisory, construction tech/software integrator
Not Fit → non-construction business, cleaning/maintenance company, competitor, school, retailer, unrelated company

Also infer the primary industry and country from the content.

Return ONLY valid JSON:
{
  "classification": "Strong Fit" | "Possible Fit" | "Not Fit",
  "reason": "one sentence: what the company does and why it fits or doesn't",
  "industry": "primary industry (e.g. Roofing, HVAC & Mechanical, Plumbing, General Contractor)",
  "country": "full country name or empty string if unclear"
}`;

  const res = await fetch('https://router.requesty.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REQUESTY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`Requesty error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON: ${raw.slice(0, 150)}`);
  return JSON.parse(match[0]);
}

async function main() {
  // Process any record that was touched by Firecrawl OR is still a ZoomInfo no-match,
  // but doesn't have Exa data yet
  const records = await getRecords(TABLES.DEMO_SCHEDULED, {
    filterByFormula: `AND({Domain} != "", {Exa} = "", OR(FIND("Firecrawl", {Failed Signals}) > 0, FIND("Exa", {Failed Signals}) > 0, {Industry} = "", {Country} = ""))`,
  });

  console.log(`Found ${records.length} records to classify via Exa\n`);
  console.log(`${'Company'.padEnd(32)} | ${'Fit'.padEnd(13)} | ${'Industry'.padEnd(28)} | Reason`);
  console.log('-'.repeat(110));

  let strongFit = 0, possibleFit = 0, notFit = 0, noContent = 0, failed = 0;

  for (const record of records) {
    const domain = record.fields['Domain'];
    const dealName = (record.fields['Deal name'] || '').split(' - ')[0].trim();

    try {
      const exa = await getExaContent(domain, dealName);

      if (!exa) {
        console.log(`  ○ ${dealName.slice(0, 30).padEnd(30)} | no content from Exa`);
        await base(TABLES.DEMO_SCHEDULED).update(record.id, {
          'Exa': `PAGES SCRAPED (0): https://${domain}\n\n[No content found — domain may be dead, login-gated, or unindexed]`,
        });
        noContent++;
        await new Promise(r => setTimeout(r, 800));
        continue;
      }

      // Classify from combined multi-page Exa content
      const { classification, reason, industry, country } = await classifyFromContent(
        domain, dealName, exa.text, exa.sources
      );

      const fit = ['Strong Fit', 'Possible Fit', 'Not Fit'].includes(classification)
        ? classification
        : 'Not Fit';

      const exaFieldValue = `PAGES SCRAPED (${exa.pageCount}): ${exa.sources}\nSOURCE TYPE: ${exa.source}\n\n${exa.text.slice(0, 5000)}`;

      const updateFields = {
        'Exa': exaFieldValue,
        'Fit Classification': fit,
        'Fit Reason': reason,
        'ICP Status': FIT_TO_ICP[fit],
        'ICP Score': FIT_TO_SCORE[fit],
        'Failed Signals': `Source: Exa AI (${exa.pageCount} pages, ${exa.source}) → Claude`,
        'Enriched At': new Date().toISOString(),
      };
      if (industry) updateFields['Industry'] = industry;
      if (country) updateFields['Country'] = country;

      await base(TABLES.DEMO_SCHEDULED).update(record.id, updateFields);

      if (fit === 'Strong Fit') strongFit++;
      else if (fit === 'Possible Fit') possibleFit++;
      else notFit++;

      const icon = fit === 'Strong Fit' ? '✓' : fit === 'Possible Fit' ? '~' : '✗';
      console.log(`${icon} ${dealName.slice(0, 30).padEnd(30)} | ${fit.padEnd(13)} | ${(industry || '').padEnd(28)} | ${reason.slice(0, 55)}`);
    } catch (err) {
      console.error(`✗ ERROR ${domain}: ${err.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Strong Fit:   ${strongFit}`);
  console.log(`Possible Fit: ${possibleFit}`);
  console.log(`Not Fit:      ${notFit}`);
  console.log(`No content:   ${noContent}`);
  console.log(`Failed:       ${failed}`);
  console.log(`Total:        ${records.length}`);
}

main().catch(console.error);
