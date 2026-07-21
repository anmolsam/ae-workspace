import 'dotenv/config';

const EXA_API_KEY = process.env.EXA_API_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// EXA — multi-page scraper
// ─────────────────────────────────────────────────────────────────────────────
export async function exaScrape(domain, location = '') {
  const baseUrl = `https://${domain}`;
  const wwwUrl = `https://www.${domain}`;

  const directUrls = [
    baseUrl, wwwUrl,
    `${baseUrl}/about`, `${wwwUrl}/about`,
    `${baseUrl}/about-us`, `${wwwUrl}/about-us`,
    `${baseUrl}/services`, `${wwwUrl}/services`,
    `${baseUrl}/service`,
    `${baseUrl}/what-we-do`,
    `${baseUrl}/products`,
    `${baseUrl}/product`,
    `${baseUrl}/projects`,
    `${baseUrl}/our-work`,
    `${baseUrl}/work`,
    `${baseUrl}/trades`,
    `${baseUrl}/specialties`,
  ];

  const directRes = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: directUrls, text: { maxCharacters: 3000 } }),
    signal: AbortSignal.timeout(20_000),
  });
  const directData = directRes.ok ? await directRes.json() : { results: [] };
  const directPages = (directData.results || []).filter(r => r.text?.trim().length > 100);

  const searchRes = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `${domain}${location ? ' ' + location : ''} services products about contractor supplier`,
      type: 'keyword',
      includeDomains: [domain],
      numResults: 8,
      contents: { text: { maxCharacters: 3000 } },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const searchData = searchRes.ok ? await searchRes.json() : { results: [] };
  const searchPages = (searchData.results || []).filter(r => r.text?.trim().length > 100);

  const seen = new Set();
  const allPages = [...directPages, ...searchPages].filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  if (!allPages.length) {
    const extRes = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `"${domain}" OR site:${domain} construction contractor services what they do`,
        type: 'keyword',
        numResults: 5,
        contents: { text: { maxCharacters: 2000 } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const extData = extRes.ok ? await extRes.json() : { results: [] };
    const extPages = (extData.results || []).filter(r => r.text?.trim().length > 100);
    if (extPages.length) allPages.push(...extPages);
  }

  if (!allPages.length) return null;

  const combined = allPages
    .map(r => `=== PAGE: ${r.title || r.url} ===\nURL: ${r.url}\n\n${r.text.trim()}`)
    .join('\n\n' + '─'.repeat(60) + '\n\n');

  const pagesList = allPages.map(r => r.url).join('\n');

  return { combined, pagesList, pageCount: allPages.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRECRAWL — live direct scrape (catches sites not indexed by Exa)
// ─────────────────────────────────────────────────────────────────────────────
export async function firecrawlScrape(domain) {
  const baseUrl = `https://${domain}`;
  const pages = [
    baseUrl,
    `${baseUrl}/about-us`,
    `${baseUrl}/about`,
    `${baseUrl}/services`,
    `${baseUrl}/what-we-do`,
  ];

  const results = [];
  for (const url of pages) {
    try {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 15000 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.data?.markdown;
      if (text && text.trim().length > 150) {
        results.push({ url, text: text.slice(0, 4000) });
      }
    } catch { continue; }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!results.length) return null;

  const combined = results
    .map(r => `=== PAGE: ${r.url} ===\nURL: ${r.url}\n\n${r.text.trim()}`)
    .join('\n\n' + '─'.repeat(60) + '\n\n');
  const pagesList = results.map(r => r.url).join('\n');

  return { combined, pagesList, pageCount: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// SERPAPI — Google organic + Knowledge Graph + Google Maps
// ─────────────────────────────────────────────────────────────────────────────
export async function serpFallback(domain, companyName, location = '') {
  const name = companyName && companyName !== 'unknown' ? companyName : domain;
  const KEY = process.env.SERPAPI_KEY;
  const sections = [];
  const locationHint = location ? ` ${location}` : '';

  try {
    const q1 = encodeURIComponent(`"${name}" ${domain}${locationHint}`);
    const res1 = await fetch(`https://serpapi.com/search.json?q=${q1}&num=5&api_key=${KEY}`, { signal: AbortSignal.timeout(20_000) });
    if (res1.ok) {
      const d1 = await res1.json();

      if (d1.knowledge_graph) {
        const kg = d1.knowledge_graph;
        const kgLines = [
          `=== GOOGLE KNOWLEDGE GRAPH: ${kg.title || name} ===`,
          `Source URL: https://www.google.com/search?q=${q1}`,
          ``,
          kg.type ? `Business Type: ${kg.type}` : '',
          kg.description ? `Description: ${kg.description}` : '',
          kg.address ? `Address: ${kg.address}` : '',
          kg.phone ? `Phone: ${kg.phone}` : '',
          kg.website ? `Website: ${kg.website}` : '',
          kg.rating ? `Rating: ${kg.rating} (${kg.reviews} reviews)` : '',
        ].filter(Boolean);
        sections.push(kgLines.join('\n'));
      }

      const localPack = (d1.local_results?.places || d1.local_results || []).slice(0, 3);
      if (localPack.length) {
        const lpLines = [`=== GOOGLE MAPS LOCAL RESULTS ===`];
        localPack.forEach(p => {
          lpLines.push(
            `\n[${p.title || p.name}]`,
            p.type ? `Type: ${p.type}` : '',
            p.address ? `Address: ${p.address}` : '',
            p.description ? `Description: ${p.description}` : '',
            p.snippet ? `Snippet: ${p.snippet}` : '',
            p.rating ? `Rating: ${p.rating}` : '',
          );
        });
        sections.push(lpLines.filter(Boolean).join('\n'));
      }

      const organic = (d1.organic_results || []).slice(0, 5);
      if (organic.length) {
        const orgLines = [`=== GOOGLE ORGANIC RESULTS ===`];
        organic.forEach(r => {
          orgLines.push(`\n[${r.link}]\n${r.title}\n${r.snippet || ''}`);
        });
        sections.push(orgLines.join('\n'));
      }
    }

    const q2 = encodeURIComponent(`${name} ${domain}${locationHint}`);
    const res2 = await fetch(`https://serpapi.com/search.json?engine=google_maps&q=${q2}&api_key=${KEY}`, { signal: AbortSignal.timeout(20_000) });
    if (res2.ok) {
      const d2 = await res2.json();
      const places = (d2.local_results || []).slice(0, 3);
      if (places.length) {
        const mapLines = [`=== GOOGLE MAPS SEARCH: ${name} ===`];
        places.forEach(p => {
          mapLines.push(
            `\n[${p.title}]`,
            p.type ? `Type: ${p.type}` : '',
            p.address ? `Address: ${p.address}` : '',
            p.description ? `Description: ${p.description}` : '',
            p.website ? `Website: ${p.website}` : '',
            p.phone ? `Phone: ${p.phone}` : '',
            p.rating ? `Rating: ${p.rating} (${p.reviews} reviews)` : '',
          );
        });
        sections.push(mapLines.filter(Boolean).join('\n'));
      }
    }

    if (!sections.length) return null;
    const header = `⚠️  DOMAIN MATCH WARNING: All results below must relate to "${domain}".
If a Knowledge Graph or Maps result shows a DIFFERENT company that merely shares the name, IGNORE it entirely — do not use it as evidence for ${domain}.
Only classify based on results that clearly belong to ${domain}.\n\n${'─'.repeat(60)}\n\n`;
    const text = header + sections.join('\n\n' + '─'.repeat(60) + '\n\n');
    return { text, source: 'SerpAPI' };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXA — recent news (for richer Overview + Buying Intent signals)
// ─────────────────────────────────────────────────────────────────────────────
export async function exaNews(companyName, domain, num = 5) {
  if (!EXA_API_KEY || (!companyName && !domain)) return [];
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${companyName || domain} construction company recent news, projects, expansion, hiring, contracts`,
        type: 'auto', numResults: num, category: 'news',
        contents: { text: { maxCharacters: 500 } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r) => ({ title: r.title, url: r.url, text: r.text || '' }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERPAPI — find decision-makers on LinkedIn (Org Tree fallback)
// ─────────────────────────────────────────────────────────────────────────────
export async function serpPeople(companyName, domain) {
  const KEY = process.env.SERPAPI_KEY;
  if (!KEY || (!companyName && !domain)) return [];
  const co = companyName || domain;
  const queries = [
    `site:linkedin.com/in "${co}" (estimator OR "chief estimator" OR preconstruction)`,
    `site:linkedin.com/in "${co}" ("project manager" OR "program manager" OR "construction manager")`,
    `site:linkedin.com/in "${co}" (president OR owner OR CEO OR "vice president" OR director OR principal)`,
  ];
  const people = [];
  for (const q of queries) {
    try {
      const res = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(q)}&num=5&api_key=${KEY}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of (data.organic_results || []).slice(0, 5)) {
        // LinkedIn result titles look like "Jane Doe - Chief Estimator - Acme | LinkedIn"
        const raw = (r.title || '').replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
        const parts = raw.split(/\s+[-–—]\s+/);
        const name = parts[0]?.trim();
        const title = parts[1]?.trim() || '';
        if (name && /linkedin\.com\/in/i.test(r.link || '')) {
          people.push({ name, title, link: r.link, source: 'LinkedIn (via Google)' });
        }
      }
    } catch { /* non-fatal */ }
  }
  // de-dupe by name
  const seen = new Set();
  return people.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ─────────────────────────────────────────────────────────────────────────────
// JINA (r.jina.ai) — cheap scraper fallback, replaces Exa/Firecrawl when their
// credits are exhausted. Only used when ICP Match has no stored content for the
// company, so it barely runs.
// ─────────────────────────────────────────────────────────────────────────────
export async function jinaScrape(domain) {
  const KEY = process.env.JINA_API_KEY;
  if (!KEY || !domain) return null;
  const urls = [`https://${domain}`, `https://${domain}/about`, `https://${domain}/services`, `https://${domain}/projects`];
  const pages = [];
  for (const u of urls) {
    try {
      const res = await fetch(`https://r.jina.ai/${u}`, {
        headers: { Authorization: `Bearer ${KEY}`, Accept: 'text/plain' },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.trim().length > 120) pages.push(`=== PAGE: ${u} ===\n${text.slice(0, 4000)}`);
    } catch { /* skip this page */ }
  }
  if (!pages.length) return null;
  return { combined: `PAGES SCRAPED (${pages.length}) via Jina\n\n${pages.join('\n\n')}`, pageCount: pages.length, source: 'Jina' };
}
