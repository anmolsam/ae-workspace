# Briefy Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Briefy's backend — the shared library extensions, the Airtable table, the company/contact resolution logic, the six research sections, and the polling engine that ties them together — so that a row in Briefy's Airtable table gets fully researched and written back automatically, with zero changes to ICP Match's behavior.

**Architecture:** Mirrors `src/watch.js`'s poll-loop pattern. On every tick, `src/briefy/engine.js` first runs `syncFromIcpMatch.js` — mirroring newly-eligible rows from the existing "ICP Match Final" table into Briefy's own base, replacing the need for any new HubSpot→Airtable workflow — then polls the Briefy base for pending rows; for each one, `briefBuilder.js` resolves the company (or two, on a genuine tie), then fans out six independent research sections concurrently, merges their output, and writes it all back to that row. Everything reuses `src/lib/` clients — no new HubSpot/ZoomInfo/Exa/Firecrawl/SerpAPI/Requesty code paths are invented from scratch.

**Tech Stack:** Node ESM (matches the rest of this repo), `airtable` npm package, Node's built-in `node:test` for unit tests (repo has zero test infrastructure today — this avoids adding a new dependency for it).

**Spec:** `architecturefinal.md` at the repo root. This plan implements only the backend (Milestones 1–6 below); the Next.js frontend (`web/`) is a separate follow-up plan once this backend is reviewed and working, since it's an independently testable subsystem on its own (you can watch Airtable rows get populated with zero UI).

## Global Constraints

- Node >= 20, ESM (`"type": "module"` in `package.json`) — match existing repo conventions exactly.
- Never modify ICP Match's runtime behavior — only import-path changes to existing files are allowed.
- Briefy uses a **completely separate Airtable base** (`BRIEFY_AIRTABLE_BASE_ID`), not just a separate table inside ICP Match's base — the two bases must never be conflated in code, env vars, or scripts.
- Within that base, the table is `BRIEFY_AIRTABLE_TABLE` (default `"Briefy"`).
- No new test framework dependency — use `node:test` + `node:assert/strict`, run via `node --test` (bare, no path argument — Node's built-in recursive discovery finds every `*.test.js` under the tree with zero manual maintenance; a `tests/` argument requires a hand-maintained entry file and silently skips any test file someone forgets to register there, discovered and rejected during Task 1.1's review).
- Every new/modified file must pass `node --check <file>` before being considered done.
- HubSpot property names, ZoomInfo endpoints, and Clay's shape are exactly as documented in `architecturefinal.md`'s "Confirmed vs. inferred vs. pending" section — do not silently invent different ones.

---

## Milestone 1: Shared library foundation (`src/lib/`)

Extract the reusable scraping/LLM logic out of `icp-final.js` into `src/lib/`, extend the HubSpot/ZoomInfo clients with the new functions Briefy needs, add the Clay stub, and generalize `lib/airtable.js` so Briefy can connect to its own, completely separate Airtable base. This milestone touches ICP Match's main pipeline file, so it ends with an explicit verification step that ICP Match still behaves identically.

### Task 1.1: Extract Exa/Firecrawl/SerpAPI scraping into `src/lib/scrapers.js`

**Files:**
- Create: `src/lib/scrapers.js`
- Modify: `src/icp-final.js` (remove the three extracted functions, add an import)
- Test: `tests/lib/scrapers.test.js`

**Interfaces:**
- Produces: `exaScrape(domain, location = '')`, `firecrawlScrape(domain)`, `serpFallback(domain, companyName, location = '')` — all `async`, all return `{ combined, pagesList, pageCount }` (Exa/Firecrawl) or `{ text, source }` (SerpAPI), or `null` if nothing found. Every later task that scrapes a company's own site imports from here.

- [ ] **Step 1: Create `src/lib/scrapers.js` with the extracted, byte-identical logic**

```javascript
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
    const res1 = await fetch(`https://serpapi.com/search.json?q=${q1}&num=5&api_key=${KEY}`);
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
    const res2 = await fetch(`https://serpapi.com/search.json?engine=google_maps&q=${q2}&api_key=${KEY}`);
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
```

- [ ] **Step 2: Write the smoke test verifying the extraction preserves behavior**

```javascript
// tests/lib/scrapers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exaScrape, firecrawlScrape, serpFallback } from '../../src/lib/scrapers.js';

test('exaScrape returns null when Exa has no pages for the domain', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const result = await exaScrape('nosuchcompany-xyz.com');
  assert.equal(result, null);
});

test('exaScrape returns combined content when Exa finds pages', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    results: [{ url: 'https://acme.com', title: 'Acme', text: 'a'.repeat(200) }],
  }), { status: 200 }));
  const result = await exaScrape('acme.com');
  assert.equal(result.pageCount, 1);
  assert.match(result.combined, /PAGE: Acme/);
});

test('firecrawlScrape returns null when every page is too thin', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: { markdown: 'short' } }), { status: 200 }));
  const result = await firecrawlScrape('acme.com');
  assert.equal(result, null);
});

test('serpFallback returns null when SerpAPI returns nothing usable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({}), { status: 200 }));
  const result = await serpFallback('acme.com', 'Acme Inc');
  assert.equal(result, null);
});
```

- [ ] **Step 3: Add the test script to `package.json`**

Modify the `"scripts"` block in `package.json` to add:

```json
    "test": "node --test",
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: 4 passing tests under `tests/lib/scrapers.test.js`, 0 failures.

- [ ] **Step 5: Remove the three extracted functions from `icp-final.js` and import them instead**

In `src/icp-final.js`, delete the three function definitions (currently spanning roughly from the `// EXA — multi-page scraper` comment through the end of `serpFallback`'s closing brace — i.e. everything between `zoomInfoFallback`'s section and the `// GEMINI 2.5 PRO` section, MINUS `zoomInfoFallback` itself, which stays). Concretely, delete this exact block:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// EXA — multi-page scraper
// ─────────────────────────────────────────────────────────────────────────────
async function exaScrape(domain, location = '') {
```
... (the full body of `exaScrape`, through its closing `}`) ...

and this exact block:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK 1 — Firecrawl (live direct scrape — catches sites not indexed by Exa)
// ─────────────────────────────────────────────────────────────────────────────
async function firecrawlScrape(domain) {
```
... (the full body of `firecrawlScrape`, through its closing `}`) ...

and this exact block:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK 3 — SerpAPI: Google organic + Knowledge Graph + Google Maps
// ─────────────────────────────────────────────────────────────────────────────
async function serpFallback(domain, companyName, location = '') {
```
... (the full body of `serpFallback`, through its closing `}`) ...

Leave `zoomInfoFallback` (the function between Firecrawl and SerpAPI) untouched — it's icp-final-specific formatting logic around `enrichCompanyByDomain`, not part of the extraction.

Then add this import near the top of the file, alongside the existing `lib/` imports:

```javascript
import { exaScrape, firecrawlScrape, serpFallback } from './lib/scrapers.js';
```

- [ ] **Step 6: Verify `icp-final.js` still parses and has no leftover duplicate definitions**

Run: `node --check src/icp-final.js && grep -c "^async function exaScrape\|^async function firecrawlScrape\|^async function serpFallback" src/icp-final.js`
Expected: no syntax error, and the grep count is `0` (the functions now live only in `src/lib/scrapers.js`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/scrapers.js src/icp-final.js tests/lib/scrapers.test.js package.json
git commit -m "refactor: extract Exa/Firecrawl/SerpAPI scraping into src/lib/scrapers.js"
```

---

### Task 1.2: Extract the Requesty LLM call into `src/lib/requesty.js`

**Files:**
- Create: `src/lib/requesty.js`
- Modify: `src/icp-final.js`
- Test: `tests/lib/requesty.test.js`

**Interfaces:**
- Produces: `chatCompletion({ model, messages, temperature = 0.1 })` → `Promise<string>` (raw LLM text content). `parseJsonResponse(raw)` → parsed JSON object, throws if no JSON object is found in the text. Every Briefy section that calls an LLM imports both of these.

- [ ] **Step 1: Create `src/lib/requesty.js`**

```javascript
import 'dotenv/config';

const REQUESTY_URL = 'https://router.requesty.ai/v1/chat/completions';

export async function chatCompletion({ model, messages, temperature = 0.1 }) {
  const res = await fetch(REQUESTY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.REQUESTY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  if (!res.ok) throw new Error(`Requesty ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export function parseJsonResponse(raw) {
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${clean.slice(0, 200)}`);
  return JSON.parse(match[0]);
}
```

- [ ] **Step 2: Write the test**

```javascript
// tests/lib/requesty.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion, parseJsonResponse } from '../../src/lib/requesty.js';

test('chatCompletion returns the message content on success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'hello world' } }],
  }), { status: 200 }));
  const content = await chatCompletion({ model: 'google/gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(content, 'hello world');
});

test('chatCompletion throws on a non-ok response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('rate limited', { status: 429 }));
  await assert.rejects(
    () => chatCompletion({ model: 'google/gemini-2.5-pro', messages: [] }),
    /Requesty 429/,
  );
});

test('parseJsonResponse strips markdown fences and parses the JSON object', () => {
  const raw = '```json\n{"a": 1, "b": "two"}\n```';
  assert.deepEqual(parseJsonResponse(raw), { a: 1, b: 'two' });
});

test('parseJsonResponse throws when there is no JSON object in the text', () => {
  assert.throws(() => parseJsonResponse('not json at all'), /No JSON in response/);
});
```

- [ ] **Step 3: Run the tests and verify they pass**

Run: `npm test`
Expected: 4 new passing tests under `tests/lib/requesty.test.js` (8 total across both test files so far), 0 failures.

- [ ] **Step 4: Replace the inline Requesty call in `icp-final.js`**

In `src/icp-final.js`, inside `classifyWithGemini`, replace this exact block:

```javascript
  const res = await fetch('https://router.requesty.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${REQUESTY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`Requesty ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || '')
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${raw.slice(0, 200)}`);
  return JSON.parse(match[0]);
}
```

with:

```javascript
  const raw = await chatCompletion({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1 });
  return parseJsonResponse(raw);
}
```

Then add this import near the top of the file:

```javascript
import { chatCompletion, parseJsonResponse } from './lib/requesty.js';
```

The module-level `const REQUESTY_KEY = process.env.REQUESTY_API_KEY;` can stay (it's unused now but harmless) or be deleted — delete it, since it becomes dead code:

Remove this line:
```javascript
const REQUESTY_KEY  = process.env.REQUESTY_API_KEY;
```

- [ ] **Step 5: Verify `icp-final.js` still parses**

Run: `node --check src/icp-final.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/requesty.js src/icp-final.js tests/lib/requesty.test.js
git commit -m "refactor: extract Requesty LLM gateway call into src/lib/requesty.js"
```

---

### Task 1.3: Extend `src/lib/hubspot.js` with the four new functions Briefy needs

**Files:**
- Modify: `src/lib/hubspot.js`
- Test: `tests/lib/hubspot.test.js`

**Interfaces:**
- Consumes: existing `hubspotRequest(method, path, body)` from the same file.
- Produces: `GENERIC_EMAIL_DOMAINS` (now exported `Set<string>`), `getDealContact(dealId)` → `Promise<{id, email, firstName, lastName} | null>`, `getDealsForContact(contactId, excludeDealId)` → `Promise<Array<{id, dealName, ownerId, meetingDateTimeSales}>>`, `getContactAnalytics(contactId)` → `Promise<{lastUrl, lastTimestamp}>`, `getOwnerName(ownerId)` → `Promise<string>` (cached 5 min).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/lib/hubspot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUBSPOT_API_KEY = 'pat-test-key';

import {
  GENERIC_EMAIL_DOMAINS,
  getDealContact,
  getDealsForContact,
  getContactAnalytics,
  getOwnerName,
} from '../../src/lib/hubspot.js';

test('GENERIC_EMAIL_DOMAINS is exported and contains gmail.com', () => {
  assert.ok(GENERIC_EMAIL_DOMAINS.has('gmail.com'));
});

test('getDealContact returns null when the deal has no associated contacts', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const contact = await getDealContact('12345');
  assert.equal(contact, null);
});

test('getDealContact returns the contact when one is associated', async (t) => {
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ results: [{ id: '999' }] }), { status: 200 });
    return new Response(JSON.stringify({ id: '999', properties: { email: 'jane@acme.com', firstname: 'Jane', lastname: 'Doe' } }), { status: 200 });
  });
  const contact = await getDealContact('12345');
  assert.deepEqual(contact, { id: '999', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe' });
});

test('getDealsForContact excludes the current deal from the results', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    results: [
      { id: '111', properties: { dealname: 'Old Deal', hubspot_owner_id: '55', meeting_date___time___sales: '2025-01-01T10:00:00Z' } },
      { id: '222', properties: { dealname: 'Current Deal', hubspot_owner_id: '55', meeting_date___time___sales: '2026-01-01T10:00:00Z' } },
    ],
  }), { status: 200 }));
  const deals = await getDealsForContact('999', '222');
  assert.equal(deals.length, 1);
  assert.equal(deals[0].id, '111');
  assert.equal(deals[0].dealName, 'Old Deal');
  assert.equal(deals[0].meetingDateTimeSales, '2025-01-01T10:00:00Z');
});

test('getContactAnalytics returns last-page-visited fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    properties: { hs_analytics_last_url: 'https://acme.com/pricing', hs_analytics_last_timestamp: '2026-02-01T00:00:00Z' },
  }), { status: 200 }));
  const analytics = await getContactAnalytics('999');
  assert.deepEqual(analytics, { lastUrl: 'https://acme.com/pricing', lastTimestamp: '2026-02-01T00:00:00Z' });
});

test('getOwnerName resolves an owner id to a full name and caches the owners list', async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ results: [{ id: '77', firstName: 'Sam', lastName: 'Lee' }] }), { status: 200 });
  });
  const first = await getOwnerName('77');
  const second = await getOwnerName('77');
  assert.equal(first, 'Sam Lee');
  assert.equal(second, 'Sam Lee');
  assert.equal(fetchCalls, 1, 'second call should hit the cache, not fetch again');
});

test('getOwnerName returns an empty string for an unknown owner id', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const name = await getOwnerName('does-not-exist');
  assert.equal(name, '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `getDealContact`, `getDealsForContact`, `getContactAnalytics`, `getOwnerName` are not exported yet, and `GENERIC_EMAIL_DOMAINS` import is `undefined`.

- [ ] **Step 3: Implement the four functions in `src/lib/hubspot.js`**

First, change the existing line:
```javascript
const GENERIC_EMAIL_DOMAINS = new Set([
```
to:
```javascript
export const GENERIC_EMAIL_DOMAINS = new Set([
```

Then append these functions at the end of the file:

```javascript
/**
 * Get the contact associated with a deal — no primary/secondary distinction,
 * just whichever contact is on the deal (used to find "the person who booked the demo").
 * @param {string} dealId
 * @returns {Promise<{id: string, email: string|null, firstName: string, lastName: string} | null>}
 */
export async function getDealContact(dealId) {
  const assoc = await hubspotRequest('GET', `/crm/v3/objects/deals/${dealId}/associations/contacts`);
  const results = assoc?.results ?? [];
  if (results.length === 0) return null;

  const contactId = results[0].id;
  const contact = await hubspotRequest('GET', `/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname`);
  return {
    id: contact.id,
    email: contact.properties?.email || null,
    firstName: contact.properties?.firstname || '',
    lastName: contact.properties?.lastname || '',
  };
}

/**
 * Find every other deal associated with a given contact — used for "prior deals".
 * Reuses the same associations.contact deal-search pattern as findDealIdByDomain above,
 * just scoped to one specific contact instead of a domain-wide contact list.
 * @param {string} contactId
 * @param {string} excludeDealId - the current deal, excluded from the results
 * @returns {Promise<Array<{id: string, dealName: string, ownerId: string|null, meetingDateTimeSales: string|null}>>}
 */
export async function getDealsForContact(contactId, excludeDealId) {
  const data = await hubspotRequest('POST', '/crm/v3/objects/deals/search', {
    filterGroups: [{ filters: [{ propertyName: 'associations.contact', operator: 'EQ', value: contactId }] }],
    properties: ['dealname', 'hubspot_owner_id', 'meeting_date___time___sales'],
    limit: 50,
  });

  const results = data?.results ?? [];
  return results
    .filter(d => String(d.id) !== String(excludeDealId))
    .map(d => ({
      id: d.id,
      dealName: d.properties?.dealname || '',
      ownerId: d.properties?.hubspot_owner_id || null,
      meetingDateTimeSales: d.properties?.meeting_date___time___sales || null,
    }));
}

/**
 * Read a contact's website analytics — the "last page visited before booking" signal.
 * @param {string} contactId
 * @returns {Promise<{lastUrl: string|null, lastTimestamp: string|null}>}
 */
export async function getContactAnalytics(contactId) {
  const contact = await hubspotRequest('GET', `/crm/v3/objects/contacts/${contactId}?properties=hs_analytics_last_url,hs_analytics_last_timestamp`);
  return {
    lastUrl: contact.properties?.hs_analytics_last_url || null,
    lastTimestamp: contact.properties?.hs_analytics_last_timestamp || null,
  };
}

let _ownersCache = null;
let _ownersCacheAt = 0;
const OWNERS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve a HubSpot owner id to a display name, e.g. for prior deals' owners.
 * Caches the full owners list for 5 minutes so a brief with several prior deals
 * doesn't make one HubSpot call per deal.
 * @param {string} ownerId
 * @returns {Promise<string>} full name, or '' if not found
 */
export async function getOwnerName(ownerId) {
  if (!ownerId) return '';
  const now = Date.now();
  if (!_ownersCache || now - _ownersCacheAt > OWNERS_CACHE_TTL_MS) {
    const data = await hubspotRequest('GET', '/crm/v3/owners?limit=100');
    _ownersCache = new Map((data?.results ?? []).map(o => [String(o.id), `${o.firstName || ''} ${o.lastName || ''}`.trim()]));
    _ownersCacheAt = now;
  }
  return _ownersCache.get(String(ownerId)) || '';
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all `tests/lib/hubspot.test.js` tests pass (7 new tests). Note: the cache is module-level state, so if you re-run the whole suite twice in the same process the second `getOwnerName` test run may hit stale cache — that's expected and fine for `node --test` (each test file run is a fresh process).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubspot.js tests/lib/hubspot.test.js
git commit -m "feat: add getDealContact/getDealsForContact/getContactAnalytics/getOwnerName to lib/hubspot.js"
```

---

### Task 1.4: Extend `src/lib/zoominfo.js` with contact search and Intent

**Files:**
- Modify: `src/lib/zoominfo.js`
- Test: `tests/lib/zoominfo.test.js`

**Interfaces:**
- Consumes: the existing private `getToken()` and `API_BASE` from the same file.
- Produces: `searchContacts(domain, titles = [])` → `Promise<Array<{name, title, phone, email}>>`, `enrichIntent(domain, topics = [])` → `Promise<{score, topics: Array<{name, score}>} | null>`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/lib/zoominfo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ZOOMINFO_CLIENT_ID = 'test-client-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-client-secret';

import { searchContacts, enrichIntent } from '../../src/lib/zoominfo.js';

function mockTokenThenPayload(payload, status = 200) {
  let call = 0;
  return async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
    return new Response(JSON.stringify(payload), { status });
  };
}

test('searchContacts maps ZoomInfo contact records into a flat shape', async (t) => {
  t.mock.method(globalThis, 'fetch', mockTokenThenPayload({
    data: [{ attributes: { firstName: 'Sam', lastName: 'Lee', jobTitle: 'Estimator', directPhone: '555-1234', email: 'sam@acme.com' } }],
  }));
  const contacts = await searchContacts('acme.com', ['estimator']);
  assert.deepEqual(contacts, [{ name: 'Sam Lee', title: 'Estimator', phone: '555-1234', email: 'sam@acme.com' }]);
});

test('searchContacts throws with a clear message on a non-ok response', async (t) => {
  t.mock.method(globalThis, 'fetch', mockTokenThenPayload({ error: 'bad request' }, 400));
  await assert.rejects(() => searchContacts('acme.com', ['estimator']), /ZoomInfo contact search failed/);
});

test('enrichIntent returns null immediately when no topics are given', async () => {
  const result = await enrichIntent('acme.com', []);
  assert.equal(result, null);
});

test('enrichIntent returns the top topic score', async (t) => {
  t.mock.method(globalThis, 'fetch', mockTokenThenPayload({
    data: [{ attributes: { topics: [{ topic: 'Construction Software', score: 87 }] } }],
  }));
  const result = await enrichIntent('acme.com', ['topic-123']);
  assert.deepEqual(result, { score: 87, topics: [{ name: 'Construction Software', score: 87 }] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `searchContacts` and `enrichIntent` are not exported yet.

- [ ] **Step 3: Implement both functions in `src/lib/zoominfo.js`**

Append at the end of the file:

```javascript
/**
 * Search ZoomInfo contacts at a company by job title — used for the org tree
 * (estimators, program/project managers, upper management).
 * @param {string} domain
 * @param {string[]} titles - job title keywords to match
 * @returns {Promise<Array<{name: string, title: string, phone: string, email: string}>>}
 */
export async function searchContacts(domain, titles = []) {
  const token = await getToken();

  const res = await fetch(`${API_BASE}/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'ContactSearch',
        attributes: {
          companyWebsite: domain,
          jobTitle: titles,
          rpp: 25,
        },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`ZoomInfo contact search failed for ${domain}: ${res.status} ${text}`);

  const json = JSON.parse(text);
  return (json?.data ?? []).map(d => ({
    name: [d.attributes?.firstName, d.attributes?.lastName].filter(Boolean).join(' '),
    title: d.attributes?.jobTitle || '',
    phone: d.attributes?.directPhone || d.attributes?.phone || '',
    email: d.attributes?.email || '',
  }));
}

/**
 * ZoomInfo Intent Enrich — buying-intent score for a company against a set of topics.
 * @param {string} domain
 * @param {string[]} topics - ZoomInfo intent topic IDs
 * @returns {Promise<{score: number, topics: Array<{name: string, score: number}>} | null>}
 */
export async function enrichIntent(domain, topics = []) {
  if (!topics.length) return null;
  const token = await getToken();

  const res = await fetch(`${API_BASE}/intent/enrich`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'IntentEnrich',
        attributes: {
          matchCompanyInput: [{ companyWebsite: domain }],
          topicIds: topics,
        },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`ZoomInfo intent enrich failed for ${domain}: ${res.status} ${text}`);

  const json = JSON.parse(text);
  const result = json?.data?.[0]?.attributes;
  if (!result || !result.topics?.length) return null;

  return {
    score: result.topics[0]?.score ?? null,
    topics: result.topics.map(t => ({ name: t.topic || t.name, score: t.score })),
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all `tests/lib/zoominfo.test.js` tests pass (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/zoominfo.js tests/lib/zoominfo.test.js
git commit -m "feat: add searchContacts and enrichIntent to lib/zoominfo.js"
```

---

### Task 1.5: Create `src/lib/clay.js`

**Files:**
- Create: `src/lib/clay.js`
- Test: `tests/lib/clay.test.js`

**Interfaces:**
- Produces: `triggerEnrichment({ domain, dealId })` → `Promise<{status: 'triggered' | 'not_configured'}>`, throws on a real HTTP failure from Clay.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/lib/clay.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerEnrichment } from '../../src/lib/clay.js';

test('triggerEnrichment returns not_configured when CLAY_WEBHOOK_URL is unset', async () => {
  delete process.env.CLAY_WEBHOOK_URL;
  delete process.env.CLAY_API_KEY;
  const result = await triggerEnrichment({ domain: 'acme.com', dealId: '123' });
  assert.deepEqual(result, { status: 'not_configured' });
});

test('triggerEnrichment posts to the webhook and returns triggered on success', async (t) => {
  process.env.CLAY_WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/test';
  process.env.CLAY_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  const result = await triggerEnrichment({ domain: 'acme.com', dealId: '123' });
  assert.deepEqual(result, { status: 'triggered' });
});

test('triggerEnrichment throws with a clear message when Clay rejects the request', async (t) => {
  process.env.CLAY_WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/test';
  process.env.CLAY_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async () => new Response('bad payload', { status: 422 }));
  await assert.rejects(() => triggerEnrichment({ domain: 'acme.com', dealId: '123' }), /Clay trigger failed: 422/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/lib/clay.js` does not exist yet.

- [ ] **Step 3: Implement `src/lib/clay.js`**

```javascript
import 'dotenv/config';

/**
 * Fire-and-forget trigger for Clay's async enrichment (revenue + org-tree supplement).
 * Clay's integration model is webhook-in/webhook-out — this only fires the trigger;
 * the result lands later via a webhook callback (see web/app/api/webhooks/clay).
 * Stubs cleanly if Clay isn't configured yet.
 * @param {{domain: string, dealId: string}} params
 * @returns {Promise<{status: 'triggered' | 'not_configured'}>}
 */
export async function triggerEnrichment({ domain, dealId }) {
  const webhookUrl = process.env.CLAY_WEBHOOK_URL;
  const apiKey = process.env.CLAY_API_KEY;
  if (!webhookUrl || !apiKey) return { status: 'not_configured' };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ domain, dealId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Clay trigger failed: ${res.status} ${text.slice(0, 300)}`);
  }

  return { status: 'triggered' };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all `tests/lib/clay.test.js` tests pass (3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/clay.js tests/lib/clay.test.js
git commit -m "feat: add src/lib/clay.js with a graceful not_configured stub"
```

---

### Task 1.6: Generalize `src/lib/airtable.js` for a separate Briefy Airtable base

Briefy gets its own Airtable **base** (`BRIEFY_AIRTABLE_BASE_ID`), not just a separate
table inside ICP Match's existing base — no shared base, zero risk of touching "ICP
Match Final" or its schema. `lib/airtable.js` needs a `createBase(baseId)` factory so
both bases can be reached through the same helper functions, with ICP Match's own call
sites completely unchanged (they keep using the default base).

**Files:**
- Modify: `src/lib/airtable.js`
- Test: `tests/lib/airtable.test.js`

**Interfaces:**
- Produces: `createBase(baseId)` → an Airtable base instance. `getRecords(tableName, options, targetBase)`, `createRecord(tableName, fields, targetBase)`, `updateRecord(tableName, recordId, fields, targetBase)` — `targetBase` is optional and defaults to ICP Match's existing base, so every current call site (`icp-final.js`, `push-to-hubspot.js`, `run-test-table.js`, `exa-classify.js`) needs zero changes. `briefBuilder.js` (Milestone 6) will pass `createBase(process.env.BRIEFY_AIRTABLE_BASE_ID)` explicitly.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/lib/airtable.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBase, getRecords, updateRecord } from '../../src/lib/airtable.js';

test('createBase returns a callable Airtable base bound to the given base id', () => {
  const base = createBase('appTestBriefyBase');
  assert.equal(typeof base, 'function');
});

test('getRecords targets the explicitly passed base, not the default ICP Match base', async () => {
  const calls = [];
  const fakeTable = { select: () => ({ eachPage: (onPage, done) => { calls.push('used-fake-base'); onPage([{ id: 'rec1' }], () => done()); } }) };
  const fakeBase = () => fakeTable;
  const records = await getRecords('Briefy', {}, fakeBase);
  assert.deepEqual(calls, ['used-fake-base']);
  assert.equal(records.length, 1);
});

test('updateRecord targets the explicitly passed base', async () => {
  let capturedArgs = null;
  const fakeTable = { update: (id, fields) => { capturedArgs = { id, fields }; return Promise.resolve(); } };
  const fakeBase = () => fakeTable;
  await updateRecord('Briefy', 'rec1', { 'Brief Status': 'Ready' }, fakeBase);
  assert.deepEqual(capturedArgs, { id: 'rec1', fields: { 'Brief Status': 'Ready' } });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `createBase` is not exported yet, and `getRecords`/`updateRecord` don't accept a `targetBase` parameter yet.

- [ ] **Step 3: Modify `src/lib/airtable.js`**

Replace the current file contents with:

```javascript
import 'dotenv/config';
import Airtable from 'airtable';

/**
 * Create an Airtable base connection for any base id — used so Briefy can
 * connect to its own, completely separate base while ICP Match keeps using
 * its existing one by default (see the `base` singleton below).
 * @param {string} baseId
 */
export function createBase(baseId) {
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
}

const base = createBase(process.env.AIRTABLE_BASE_ID);

export const TABLES = {
  DEMO_SCHEDULED: 'Demo scheduled',
};

export async function getRecords(tableName, options = {}, targetBase = base) {
  const records = [];
  await targetBase(tableName).select(options).eachPage((page, next) => {
    records.push(...page);
    next();
  });
  return records;
}

export async function createRecord(tableName, fields, targetBase = base) {
  return targetBase(tableName).create(fields);
}

export async function updateRecord(tableName, recordId, fields, targetBase = base) {
  return targetBase(tableName).update(recordId, fields);
}

export default base;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all 3 `tests/lib/airtable.test.js` tests pass, and every pre-existing test in `tests/lib/*.test.js` still passes too (this is a backward-compatible change — default parameters mean no existing call site needs updating).

- [ ] **Step 5: Verify no existing call site needs changes**

Run: `grep -rn "getRecords(\|createRecord(\|updateRecord(" src/icp-final.js src/push-to-hubspot.js src/run-test-table.js src/exa-classify.js`
Expected: every call site passes only `(tableName, ...)` with 1-2 arguments, never a 3rd/4th — confirming they'll keep using the default ICP Match base unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/airtable.js tests/lib/airtable.test.js
git commit -m "feat: generalize lib/airtable.js with createBase() for Briefy's separate base"
```

---

### Task 1.7: Verify ICP Match is unaffected by this milestone

**Files:** none created — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests across `tests/lib/*.test.js` pass, 0 failures.

- [ ] **Step 2: Syntax-check every file touched this milestone**

Run: `node --check src/icp-final.js && node --check src/lib/hubspot.js && node --check src/lib/zoominfo.js && node --check src/lib/scrapers.js && node --check src/lib/requesty.js && node --check src/lib/clay.js && node --check src/lib/airtable.js && echo ALL_OK`
Expected: `ALL_OK` printed, no syntax errors.

- [ ] **Step 3: Confirm no stray references to removed inline code remain**

Run: `grep -n "REQUESTY_KEY" src/icp-final.js || echo "clean"`
Expected: `clean` (the dead `REQUESTY_KEY` const was removed in Task 1.2).

- [ ] **Step 4: If a real `.env` with credentials is available, do a live dry-run; otherwise document that this step is deferred**

Run: `test -f .env && npm run sync-hubspot:dry || echo "No .env present — live verification deferred until real credentials are available"`
Expected: either a clean dry-run preview with no errors, or the deferred message — both are acceptable outcomes for this step; a thrown error is not.

---

## Milestone 2: Briefy Airtable table

Create a brand-new Airtable base for Briefy (done by hand in the Airtable UI — base creation itself isn't scriptable via the API), the "Briefy" table inside it via Airtable's Metadata API, and the sync step that mirrors eligible rows into it from "ICP Match Final" — no new HubSpot workflow needed, per `architecturefinal.md`'s "Data source" section.

> **Manual prerequisite before Task 2.1 can run:** create a new, empty Airtable base
> (e.g. "Briefy") in the Airtable UI, note its base id (starts with `app...`), and set
> `BRIEFY_AIRTABLE_BASE_ID` to it in `.env`. Also make sure the `AIRTABLE_API_KEY`
> token has access to this new base (Airtable PATs are scoped per-base) and has the
> `schema.bases:write` scope, or table creation will 403.

### Task 2.1: Write the idempotent table-setup script

**Files:**
- Create: `scripts/setup-briefy-table.js`

**Interfaces:**
- Produces: a one-shot CLI script (no exports) — `node scripts/setup-briefy-table.js`. Requires `AIRTABLE_API_KEY` (with `schema.bases:write` scope, and access granted to the new Briefy base) and `BRIEFY_AIRTABLE_BASE_ID` in `.env`. This deliberately targets `BRIEFY_AIRTABLE_BASE_ID`, never `AIRTABLE_BASE_ID` (ICP Match's base) — the two must never be conflated.

- [ ] **Step 1: Create `scripts/setup-briefy-table.js`**

```javascript
/**
 * One-time (idempotent) setup: creates the "Briefy" table with the full field
 * schema from architecturefinal.md, inside Briefy's OWN Airtable base — if it
 * doesn't already exist. Never touches ICP Match's base or "ICP Match Final".
 *
 * Requires AIRTABLE_API_KEY with schema.bases:write scope AND access granted
 * to the Briefy base specifically (a token scoped only to ICP Match's base
 * will 403 here — that's the correct, safe failure mode).
 *
 * Usage: node scripts/setup-briefy-table.js
 */
import 'dotenv/config';

const BASE_ID = process.env.BRIEFY_AIRTABLE_BASE_ID;
const API_KEY = process.env.AIRTABLE_API_KEY;
const TABLE_NAME = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

const FIELDS = [
  // Seed fields — copied by syncFromIcpMatch.js from "ICP Match Final"
  { name: 'Deal ID', type: 'singleLineText' },
  { name: 'Deal Name', type: 'singleLineText' },
  { name: 'Company Name', type: 'singleLineText' },
  { name: 'Company Domain', type: 'singleLineText' },
  { name: 'IP State', type: 'singleLineText' },
  { name: 'IP Country', type: 'singleLineText' },
  { name: 'Meeting Date & Time', type: 'number', options: { precision: 0 } },
  { name: 'Exa Content', type: 'multilineText' },
  { name: 'Pages Scraped', type: 'multilineText' },
  { name: 'Trade Category', type: 'singleLineText' },
  {
    name: 'ICP Enriched At',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },
  { name: 'Deal Owner', type: 'singleLineText' },
  { name: 'Deal Stage', type: 'singleLineText' },
  { name: 'Deal Link', type: 'url' },

  // Engine-owned fields
  {
    name: 'Brief Status',
    type: 'singleSelect',
    options: {
      choices: [
        { name: 'Not Started' },
        { name: 'Generating' },
        { name: 'Ready' },
        { name: 'Error' },
        { name: 'Refreshing' },
      ],
    },
  },
  { name: 'Section Status', type: 'multilineText' },
  {
    name: 'Last Enriched At',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },

  // Research output fields — Briefy's own six sections
  { name: 'Company Overview', type: 'multilineText' },
  { name: 'Portfolio / Projects', type: 'multilineText' },
  { name: 'Org Tree', type: 'multilineText' },
  { name: 'ZoomInfo Revenue', type: 'singleLineText' },
  { name: 'Clay Revenue', type: 'singleLineText' },
  { name: 'Last Page Visited', type: 'singleLineText' },
  {
    name: 'Last Page Visited At',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },
  { name: 'Prior Deals', type: 'multilineText' },
  { name: 'Open Roles', type: 'multilineText' },
  { name: 'ZoomInfo Intent Score', type: 'singleLineText' },
];

async function main() {
  if (!BASE_ID || !API_KEY) {
    throw new Error('BRIEFY_AIRTABLE_BASE_ID and AIRTABLE_API_KEY must be set in .env');
  }

  const listRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!listRes.ok) {
    throw new Error(`Failed to list tables: ${listRes.status} ${await listRes.text()}`);
  }
  const { tables } = await listRes.json();

  if (tables.some(t => t.name === TABLE_NAME)) {
    console.log(`Table "${TABLE_NAME}" already exists — nothing to do.`);
    return;
  }

  const createRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: TABLE_NAME, fields: FIELDS }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create table: ${createRes.status} ${await createRes.text()}`);
  }

  console.log(`Table "${TABLE_NAME}" created with ${FIELDS.length} fields.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax-check it**

Run: `node --check scripts/setup-briefy-table.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Add an npm script for it**

Modify `package.json`'s `"scripts"` block to add:

```json
    "briefy:setup-table": "node scripts/setup-briefy-table.js",
```

- [ ] **Step 4: Run it manually once real Airtable credentials with schema-write access are available (not automatable here)**

Run: `npm run briefy:setup-table`
Expected: either `Table "Briefy" created with 27 fields.` (first run) or `Table "Briefy" already exists — nothing to do.` (subsequent runs). This step requires a real `AIRTABLE_API_KEY` scoped for `schema.bases:write` — flag to the user if that scope isn't on the current token, since a regular data-only PAT will 403 on the metadata endpoints. Also confirm the three fields you're adding to "ICP Match Final" yourself (`Deal Owner`, `Deal Stage`, `Deal Link`) exist there and that `IP State`/`IP Country`/`Meeting Date & Time` match their exact live field names — this script only creates Briefy's table, it doesn't verify the source table's schema.

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-briefy-table.js package.json
git commit -m "feat: add idempotent Briefy Airtable table setup script"
```

---

### Task 2.2: `src/briefy/syncFromIcpMatch.js`

Mirrors eligible rows from "ICP Match Final" (existing table, ICP Match's base) into
the new Briefy base — this replaces the need for a new HubSpot→Airtable workflow
entirely. See `architecturefinal.md` → "Data source: seeded from ICP Match Final, no
new HubSpot workflow."

**Files:**
- Create: `src/briefy/syncFromIcpMatch.js`
- Test: `tests/briefy/syncFromIcpMatch.test.js`

**Interfaces:**
- Consumes: `getRecords`, `createRecord`, `createBase` from `../lib/airtable.js`.
- Produces: `syncFromIcpMatch(deps = {})` → `Promise<{checked: number, created: number}>`. `deps` accepts optional overrides (`getRecordsFn`, `createRecordFn`, `createBaseFn`, `briefyBase`) for testing — same dependency-injection pattern as `briefBuilder.js`. `engine.js` (Task 6.2) calls this first on every tick, before polling the Briefy base for pending rows.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/syncFromIcpMatch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncFromIcpMatch } from '../../src/briefy/syncFromIcpMatch.js';

function icpRow(fields) {
  return { id: `rec_icp_${fields['Deal ID']}`, fields };
}

test('creates a new Briefy row for an eligible ICP Match Final row not yet mirrored', async () => {
  const created = [];
  const icpRecord = icpRow({
    'Deal ID': '111',
    'Deal Name': 'Acme - Jane',
    'Company Name': 'Acme Roofing',
    'Company domain': 'acmeroofing.com',
    'IP State': 'Texas',
    'IP Country': 'United States',
    'Meeting Date & Time': 1782830700000,
    'Exa Content': 'scraped site text...',
    'Pages Scraped': 'https://acmeroofing.com\nhttps://acmeroofing.com/about',
    'Trade Category': 'Roofing',
    'Enriched At': '2026-01-01T00:00:00.000Z',
    'Deal Owner': 'Varun Sharma',
    'Deal Stage': 'Demo Scheduled',
    'Deal Link': 'https://app.hubspot.com/contacts/20155995/deal/111',
  });

  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final' ? [icpRecord] : []),
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
  });

  assert.equal(result.checked, 1);
  assert.equal(result.created, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].table, 'Briefy');
  assert.equal(created[0].fields['Deal ID'], '111');
  assert.equal(created[0].fields['Company Domain'], 'acmeroofing.com');
  assert.equal(created[0].fields['Meeting Date & Time'], 1782830700000);
  assert.equal(created[0].fields['ICP Enriched At'], '2026-01-01T00:00:00.000Z');
  assert.equal(created[0].fields['Brief Status'], 'Not Started');
});

test('skips a row whose Deal ID is already mirrored into the Briefy base', async () => {
  const created = [];
  const icpRecord = icpRow({ 'Deal ID': '222', 'Deal Owner': 'Varun Sharma', 'Enriched At': '2026-01-01T00:00:00.000Z' });
  const existingBriefyRow = { id: 'recBriefy1', fields: { 'Deal ID': '222' } };

  const result = await syncFromIcpMatch({
    getRecordsFn: async (table) => (table === 'ICP Match Final' ? [icpRecord] : [existingBriefyRow]),
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
  });

  assert.equal(result.checked, 1);
  assert.equal(result.created, 0);
  assert.equal(created.length, 0);
});

test('queries ICP Match Final filtered on Deal Owner and Enriched At both set', async () => {
  let capturedOptions = null;
  await syncFromIcpMatch({
    getRecordsFn: async (table, options) => {
      if (table === 'ICP Match Final') capturedOptions = options;
      return [];
    },
    createRecordFn: async () => {},
    createBaseFn: () => ({}),
  });

  assert.match(capturedOptions.filterByFormula, /Deal Owner/);
  assert.match(capturedOptions.filterByFormula, /Enriched At/);
});

test('handles zero eligible rows without creating anything', async () => {
  const created = [];
  const result = await syncFromIcpMatch({
    getRecordsFn: async () => [],
    createRecordFn: async (table, fields) => { created.push({ table, fields }); },
    createBaseFn: () => ({}),
  });

  assert.equal(result.checked, 0);
  assert.equal(result.created, 0);
  assert.equal(created.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/syncFromIcpMatch.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/syncFromIcpMatch.js`**

```javascript
import { getRecords, createRecord, createBase } from '../lib/airtable.js';

const ICP_MATCH_TABLE = 'ICP Match Final';
const BRIEFY_TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

function seedFieldsFrom(icpRecord) {
  const f = icpRecord.fields;
  return {
    'Deal ID': f['Deal ID'] || '',
    'Deal Name': f['Deal Name'] || '',
    'Company Name': f['Company Name'] || '',
    'Company Domain': f['Company domain'] || '',
    'IP State': f['IP State'] || '',
    'IP Country': f['IP Country'] || '',
    'Meeting Date & Time': f['Meeting Date & Time'] ?? null,
    'Exa Content': f['Exa Content'] || '',
    'Pages Scraped': f['Pages Scraped'] || '',
    'Trade Category': f['Trade Category'] || '',
    'ICP Enriched At': f['Enriched At'] || null,
    'Deal Owner': f['Deal Owner'] || '',
    'Deal Stage': f['Deal Stage'] || '',
    'Deal Link': f['Deal Link'] || '',
    'Brief Status': 'Not Started',
  };
}

/**
 * Mirror eligible "ICP Match Final" rows (Deal Owner + Enriched At both set) into
 * Briefy's own Airtable base, skipping any deal already mirrored (matched by Deal ID).
 * Replaces the need for a separate HubSpot -> Airtable workflow for Briefy.
 * @param {object} [deps] - optional overrides for testing
 * @returns {Promise<{checked: number, created: number}>}
 */
export async function syncFromIcpMatch(deps = {}) {
  const {
    getRecordsFn = getRecords,
    createRecordFn = createRecord,
    createBaseFn = createBase,
  } = deps;

  const briefyBase = deps.briefyBase || createBaseFn(process.env.BRIEFY_AIRTABLE_BASE_ID);

  const icpRows = await getRecordsFn(ICP_MATCH_TABLE, {
    filterByFormula: `AND({Deal Owner} != '', {Enriched At} != '')`,
  });

  const existingRows = await getRecordsFn(BRIEFY_TABLE, {}, briefyBase);
  const existingDealIds = new Set(existingRows.map(r => r.fields['Deal ID']).filter(Boolean));

  let created = 0;
  for (const icpRow of icpRows) {
    const dealId = icpRow.fields['Deal ID'];
    if (!dealId || existingDealIds.has(dealId)) continue;

    await createRecordFn(BRIEFY_TABLE, seedFieldsFrom(icpRow), briefyBase);
    created += 1;
  }

  return { checked: icpRows.length, created };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all 4 `tests/briefy/syncFromIcpMatch.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/syncFromIcpMatch.js tests/briefy/syncFromIcpMatch.test.js
git commit -m "feat: add syncFromIcpMatch to mirror eligible rows from ICP Match Final into Briefy's base"
```

---

## Milestone 3: Company & contact resolution

The two remaining pieces of resolution logic: normalizing the seeded company domain, and the (still-empty) email→owner mapping config.

> **Note:** earlier drafts of this plan had `resolveCompany.js` doing multi-domain
> tiebreak resolution (a HubSpot deal could in principle carry two associated
> companies, requiring an Exa-scrape probe to disambiguate). That's been removed —
> `Company Domain` is now always a single value seeded directly from "ICP Match
> Final" (Task 2.2), which already works one domain per row and already excludes
> personal-email domains upstream. `resolveCompany.js` is now a small, synchronous
> normalization step. See `architecturefinal.md` → "Company domain normalization".

### Task 3.1: `src/briefy/resolveCompany.js`

**Files:**
- Create: `src/briefy/resolveCompany.js`
- Test: `tests/briefy/resolveCompany.test.js`

**Interfaces:**
- Consumes: nothing (pure function, no dependencies).
- Produces: `resolveCompany(companyDomainCell)` → `{domain: string|null, status: 'resolved' | 'not_found'}` — synchronous, no I/O. `briefBuilder.js` (Milestone 6) calls this first, before any section, and passes the resulting `domain` string directly to every section.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/resolveCompany.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompany } from '../../src/briefy/resolveCompany.js';

test('a clean domain resolves as-is', () => {
  assert.deepEqual(resolveCompany('acme.com'), { domain: 'acme.com', status: 'resolved' });
});

test('trims whitespace and lowercases', () => {
  assert.deepEqual(resolveCompany('  Acme.COM  '), { domain: 'acme.com', status: 'resolved' });
});

test('strips a leading protocol and www', () => {
  assert.deepEqual(resolveCompany('https://www.Acme.com/'), { domain: 'acme.com', status: 'resolved' });
});

test('a blank or missing cell resolves to not_found', () => {
  assert.deepEqual(resolveCompany(''), { domain: null, status: 'not_found' });
  assert.deepEqual(resolveCompany(null), { domain: null, status: 'not_found' });
  assert.deepEqual(resolveCompany(undefined), { domain: null, status: 'not_found' });
});

test('a whitespace-only cell resolves to not_found', () => {
  assert.deepEqual(resolveCompany('   '), { domain: null, status: 'not_found' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/resolveCompany.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/resolveCompany.js`**

```javascript
/**
 * Normalize the "Company Domain" cell seeded from ICP Match Final (Task 2.2).
 * This is always a single, already-resolved domain by the time it reaches Briefy —
 * ICP Match works one domain per row and excludes personal-email domains upstream —
 * so this is pure cleanup, not disambiguation. See architecturefinal.md > "Company
 * domain normalization" for why the earlier multi-domain tiebreak logic was removed.
 * @param {string} companyDomainCell
 * @returns {{domain: string|null, status: 'resolved'|'not_found'}}
 */
export function resolveCompany(companyDomainCell) {
  const domain = (companyDomainCell || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  if (!domain) return { domain: null, status: 'not_found' };
  return { domain, status: 'resolved' };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all 5 `tests/briefy/resolveCompany.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/resolveCompany.js tests/briefy/resolveCompany.test.js
git commit -m "feat: add resolveCompany domain normalization (replaces removed multi-company tiebreak)"
```

---

### Task 3.2: `src/briefy/owner-map.js` placeholder

**Files:**
- Create: `src/briefy/owner-map.js`
- Test: `tests/briefy/owner-map.test.js`

**Interfaces:**
- Produces: `OWNER_MAP` (a plain object, starts empty — the user fills it in), `getOwnerForEmail(email)` → `string | null`. Used by the frontend (a future plan) for the login→Deal Owner gate.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/briefy/owner-map.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOwnerForEmail } from '../../src/briefy/owner-map.js';

test('an unmapped email returns null', () => {
  assert.equal(getOwnerForEmail('nobody@attentive.ai'), null);
});

test('lookup is case-insensitive on the email', () => {
  // relies on whatever is in OWNER_MAP — with an empty map this just confirms no throw
  assert.doesNotThrow(() => getOwnerForEmail('SOMEONE@ATTENTIVE.AI'));
});

test('a null/undefined email returns null instead of throwing', () => {
  assert.equal(getOwnerForEmail(undefined), null);
  assert.equal(getOwnerForEmail(''), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/owner-map.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/owner-map.js`**

```javascript
/**
 * PLACEHOLDER — fill this in with real {email: "Deal Owner name"} pairs before
 * anyone but you can log in. Login fails closed for any email not present here
 * (see architecturefinal.md > Auth flow) — this is required, not optional.
 *
 * The "Deal Owner name" values must match the Airtable "Deal Owner" field exactly
 * (that field holds the HubSpot owner's display name, e.g. "Varun Sharma").
 */
export const OWNER_MAP = {
  // 'varun@attentive.ai': 'Varun Sharma',
};

/**
 * @param {string} email
 * @returns {string | null} the mapped Airtable "Deal Owner" value, or null if unmapped
 */
export function getOwnerForEmail(email) {
  if (!email) return null;
  return OWNER_MAP[email.toLowerCase()] || null;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all 3 `tests/briefy/owner-map.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/owner-map.js tests/briefy/owner-map.test.js
git commit -m "feat: add briefy/owner-map.js placeholder for email-to-Deal-Owner mapping"
```

---

## Milestone 4: Research sections — company website & hiring

The two sections that lean on `lib/scrapers.js` (the company's own site) and SerpAPI.

### Task 4.1: `src/briefy/sections/overview.js`

**Files:**
- Create: `src/briefy/sections/overview.js`
- Test: `tests/briefy/sections/overview.test.js`

**Interfaces:**
- Consumes: `exaScrape`, `firecrawlScrape` from `../../lib/scrapers.js`; `chatCompletion`, `parseJsonResponse` from `../../lib/requesty.js`.
- Produces: `buildOverview(domain, existingExaContent)` → `Promise<{overview: string, portfolio: string, status: 'ready'|'unavailable'|'error'}>`. `existingExaContent` is the `Exa Content` field already copied onto the Briefy row by `syncFromIcpMatch.js` (Task 2.2) — when non-empty, it's reused directly instead of re-scraping (ICP Match already paid the Exa/Firecrawl cost for this domain). `briefBuilder.js` calls this directly with the domain from `resolveCompany.js` and the row's `Exa Content` field.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/sections/overview.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview } from '../../../src/briefy/sections/overview.js';

test('returns unavailable when there is no existing content and scraping finds nothing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const result = await buildOverview('acme.com', '');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.overview, '');
});

test('scrapes fresh and synthesizes when there is no existing content', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('exa.ai')) {
      return new Response(JSON.stringify({ results: [{ url: 'https://acme.com', title: 'Acme', text: 'a'.repeat(200) }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"overview": "Acme builds roofs.", "portfolio": "acme.com/projects/school-roof: reroofed a school"}' } }],
    }), { status: 200 });
  });
  const result = await buildOverview('acme.com', '');
  assert.equal(result.status, 'ready');
  assert.equal(result.overview, 'Acme builds roofs.');
  assert.match(result.portfolio, /school-roof/);
});

test('reuses the already-copied Exa Content instead of re-scraping when non-empty', async (t) => {
  const calledUrls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calledUrls.push(String(url));
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"overview": "From existing content.", "portfolio": ""}' } }],
    }), { status: 200 });
  });
  const result = await buildOverview('acme.com', 'PAGES SCRAPED (2)\n...pre-existing ICP Match content...');
  assert.equal(result.status, 'ready');
  assert.equal(result.overview, 'From existing content.');
  assert.ok(
    calledUrls.every(u => !u.includes('exa.ai') && !u.includes('firecrawl.dev')),
    'should not scrape at all when existing content is already provided',
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/sections/overview.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/sections/overview.js`**

```javascript
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all 3 `tests/briefy/sections/overview.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/sections/overview.js tests/briefy/sections/overview.test.js
git commit -m "feat: add overview + portfolio research section, preferring already-copied Exa Content"
```

---

### Task 4.2: `src/briefy/sections/hiringSignals.js`

**Files:**
- Create: `src/briefy/sections/hiringSignals.js`
- Test: `tests/briefy/sections/hiringSignals.test.js`

**Interfaces:**
- Produces: `buildHiringSignals(domain, companyName)` → `Promise<{openRoles: Array<{title: string, source: string, link: string}>, status: 'ready'|'error'}>`. `companyName` comes from the Briefy row's `Company Name` field (seeded by `syncFromIcpMatch.js`).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/sections/hiringSignals.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHiringSignals } from '../../../src/briefy/sections/hiringSignals.js';

process.env.SERPAPI_KEY = 'test-serp-key';
process.env.FIRECRAWL_API_KEY = 'test-firecrawl-key';

test('combines a careers-page hit and SerpAPI results into one list', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('firecrawl.dev')) {
      return new Response(JSON.stringify({ data: { markdown: 'a'.repeat(150) } }), { status: 200 });
    }
    if (String(url).includes('linkedin.com')) {
      return new Response(JSON.stringify({ organic_results: [{ title: 'Estimator - Acme', link: 'https://linkedin.com/jobs/1' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ organic_results: [{ title: 'Project Manager - Acme', link: 'https://boards.greenhouse.io/acme/1' }] }), { status: 200 });
  });
  const result = await buildHiringSignals('acme.com', 'Acme');
  assert.equal(result.status, 'ready');
  assert.ok(result.openRoles.some(r => r.source === 'careers page'));
  assert.ok(result.openRoles.some(r => r.source === 'Google'));
  assert.ok(result.openRoles.some(r => r.source === 'LinkedIn (via Google)'));
});

test('returns an empty ready list when nothing is found anywhere', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({}), { status: 404 }));
  const result = await buildHiringSignals('acme.com', 'Acme');
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.openRoles, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/sections/hiringSignals.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/sections/hiringSignals.js`**

```javascript
async function careersPageRoles(domain) {
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://${domain}/careers`, formats: ['markdown'], onlyMainContent: true, timeout: 15000 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data.data?.markdown || '';
    if (text.trim().length < 100) return [];
    return [{ title: 'See careers page for open roles', source: 'careers page', link: `https://${domain}/careers` }];
  } catch {
    return [];
  }
}

async function serpOpenRoles(domain, companyName) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  const roles = [];

  try {
    const q = encodeURIComponent(`${companyName || domain} estimator OR "project manager" jobs`);
    const res = await fetch(`https://serpapi.com/search.json?q=${q}&num=5&api_key=${key}`);
    if (res.ok) {
      const data = await res.json();
      for (const r of (data.organic_results || []).slice(0, 5)) {
        roles.push({ title: r.title, source: 'Google', link: r.link });
      }
    }
  } catch { /* SerpAPI failures here are non-fatal — just fewer roles found */ }

  try {
    const q2 = encodeURIComponent(`site:linkedin.com/jobs ${companyName || domain}`);
    const res2 = await fetch(`https://serpapi.com/search.json?q=${q2}&num=5&api_key=${key}`);
    if (res2.ok) {
      const data2 = await res2.json();
      for (const r of (data2.organic_results || []).slice(0, 5)) {
        roles.push({ title: r.title, source: 'LinkedIn (via Google)', link: r.link });
      }
    }
  } catch { /* non-fatal */ }

  return roles;
}

/**
 * @param {string} domain
 * @param {string} [companyName]
 * @returns {Promise<{openRoles: Array<{title: string, source: string, link: string}>, status: 'ready'|'error'}>}
 */
export async function buildHiringSignals(domain, companyName) {
  try {
    const [careers, serp] = await Promise.all([careersPageRoles(domain), serpOpenRoles(domain, companyName)]);
    return { openRoles: [...careers, ...serp], status: 'ready' };
  } catch (err) {
    return { openRoles: [], status: 'error', error: err.message };
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: both `tests/briefy/sections/hiringSignals.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/sections/hiringSignals.js tests/briefy/sections/hiringSignals.test.js
git commit -m "feat: add hiring signals section (careers page + SerpAPI + LinkedIn-via-SerpAPI)"
```

---

## Milestone 5: Research sections — HubSpot, ZoomInfo, Clay

The four sections built on the API clients rather than website scraping.

### Task 5.1: `src/briefy/sections/orgTree.js`

**Files:**
- Create: `src/briefy/sections/orgTree.js`
- Test: `tests/briefy/sections/orgTree.test.js`

**Interfaces:**
- Consumes: `searchContacts` from `../../lib/zoominfo.js`.
- Produces: `buildOrgTree(domain)` → `Promise<{orgTree: {estimators, programManagers, upperManagement}, status: 'ready'|'error'}>`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/sections/orgTree.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgTree } from '../../../src/briefy/sections/orgTree.js';

process.env.ZOOMINFO_CLIENT_ID = 'test-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-secret';

function mockTokenThenContacts(contacts) {
  let call = 0;
  return async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ data: contacts.map(c => ({ attributes: c })) }), { status: 200 });
  };
}

test('buckets contacts into estimators/programManagers/upperManagement by title', async (t) => {
  t.mock.method(globalThis, 'fetch', mockTokenThenContacts([
    { firstName: 'A', lastName: 'One', jobTitle: 'Senior Estimator', email: 'a@acme.com', directPhone: '1' },
    { firstName: 'B', lastName: 'Two', jobTitle: 'Project Manager', email: 'b@acme.com', directPhone: '2' },
    { firstName: 'C', lastName: 'Three', jobTitle: 'CEO', email: 'c@acme.com', directPhone: '3' },
    { firstName: 'D', lastName: 'Four', jobTitle: 'Receptionist', email: 'd@acme.com', directPhone: '4' },
  ]));
  const result = await buildOrgTree('acme.com');
  assert.equal(result.status, 'ready');
  assert.equal(result.orgTree.estimators.length, 1);
  assert.equal(result.orgTree.programManagers.length, 1);
  assert.equal(result.orgTree.upperManagement.length, 1);
  assert.equal(result.orgTree.estimators[0].name, 'A One');
  assert.equal(result.orgTree.estimators[0].source, 'ZoomInfo');
});

test('returns an error status when the ZoomInfo call fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('server error', { status: 500 }));
  const result = await buildOrgTree('acme.com');
  assert.equal(result.status, 'error');
  assert.deepEqual(result.orgTree, { estimators: [], programManagers: [], upperManagement: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/sections/orgTree.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/sections/orgTree.js`**

```javascript
import { searchContacts } from '../../lib/zoominfo.js';

const ESTIMATOR_TITLES = ['estimator', 'estimating', 'preconstruction'];
const PM_TITLES = ['project manager', 'program manager', 'construction manager'];
const UPPER_MGMT_TITLES = ['ceo', 'president', 'owner', 'vice president', 'vp', 'chief', 'director', 'principal'];

function categorize(title) {
  const t = (title || '').toLowerCase();
  if (ESTIMATOR_TITLES.some(k => t.includes(k))) return 'estimators';
  if (PM_TITLES.some(k => t.includes(k))) return 'programManagers';
  if (UPPER_MGMT_TITLES.some(k => t.includes(k))) return 'upperManagement';
  return null;
}

function emptyTree() {
  return { estimators: [], programManagers: [], upperManagement: [] };
}

/**
 * @param {string} domain
 * @returns {Promise<{orgTree: {estimators: Array, programManagers: Array, upperManagement: Array}, status: 'ready'|'error'}>}
 */
export async function buildOrgTree(domain) {
  try {
    const contacts = await searchContacts(domain, [...ESTIMATOR_TITLES, ...PM_TITLES, ...UPPER_MGMT_TITLES]);
    const tree = emptyTree();
    for (const c of contacts) {
      const bucket = categorize(c.title);
      if (bucket) tree[bucket].push({ ...c, source: 'ZoomInfo' });
    }
    return { orgTree: tree, status: 'ready' };
  } catch (err) {
    return { orgTree: emptyTree(), status: 'error', error: err.message };
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: both `tests/briefy/sections/orgTree.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/sections/orgTree.js tests/briefy/sections/orgTree.test.js
git commit -m "feat: add org tree section (ZoomInfo contacts bucketed by role)"
```

---

### Task 5.2: `src/briefy/sections/revenue.js`

**Files:**
- Create: `src/briefy/sections/revenue.js`
- Test: `tests/briefy/sections/revenue.test.js`

**Interfaces:**
- Consumes: `enrichCompanyByDomain` from `../../lib/zoominfo.js`, `triggerEnrichment` from `../../lib/clay.js`.
- Produces: `buildRevenue(domain, dealId)` → `Promise<{zoomInfoRevenue: string, clayRevenue: string, status: 'ready'}>`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/sections/revenue.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRevenue } from '../../../src/briefy/sections/revenue.js';

process.env.ZOOMINFO_CLIENT_ID = 'test-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-secret';

test('reports ZoomInfo revenue and not-configured Clay when Clay is unset', async (t) => {
  delete process.env.CLAY_WEBHOOK_URL;
  delete process.env.CLAY_API_KEY;
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ attributes: { name: 'Acme', revenueRange: '$5M-$10M' } }] }), { status: 200 });
  });
  const result = await buildRevenue('acme.com', '123');
  assert.equal(result.status, 'ready');
  assert.equal(result.zoomInfoRevenue, '$5M-$10M');
  assert.equal(result.clayRevenue, 'not configured');
});

test('reports pending Clay revenue when Clay is configured and triggers cleanly', async (t) => {
  process.env.CLAY_WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/test';
  process.env.CLAY_API_KEY = 'test-key';
  let call = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    call += 1;
    if (String(url).includes('zoominfo') || String(url).includes('okta')) {
      if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ attributes: { revenueRange: '$1M-$5M' } }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  const result = await buildRevenue('acme.com', '123');
  assert.equal(result.clayRevenue, 'pending');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/sections/revenue.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/sections/revenue.js`**

```javascript
import { enrichCompanyByDomain } from '../../lib/zoominfo.js';
import { triggerEnrichment } from '../../lib/clay.js';

/**
 * @param {string} domain
 * @param {string} dealId
 * @returns {Promise<{zoomInfoRevenue: string, clayRevenue: string, status: 'ready'}>}
 */
export async function buildRevenue(domain, dealId) {
  let zoomInfoRevenue = '';
  try {
    const data = await enrichCompanyByDomain(domain);
    zoomInfoRevenue = data?.revenue || '';
  } catch { /* leave blank — the rest of the brief still reports ready */ }

  const clay = await triggerEnrichment({ domain, dealId }).catch(() => ({ status: 'error' }));
  const clayRevenue = clay.status === 'triggered' ? 'pending' : clay.status === 'not_configured' ? 'not configured' : '';

  return { zoomInfoRevenue, clayRevenue, status: 'ready' };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: both `tests/briefy/sections/revenue.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/sections/revenue.js tests/briefy/sections/revenue.test.js
git commit -m "feat: add revenue section (ZoomInfo sync + Clay async trigger)"
```

---

### Task 5.3: `src/briefy/sections/hubspotSignals.js`

**Files:**
- Create: `src/briefy/sections/hubspotSignals.js`
- Test: `tests/briefy/sections/hubspotSignals.test.js`

**Interfaces:**
- Consumes: `getDealContact`, `getDealsForContact`, `getContactAnalytics`, `getOwnerName` from `../../lib/hubspot.js`.
- Produces: `buildHubspotSignals(dealId)` → `Promise<{lastPageVisited: string, lastPageVisitedAt: string|null, priorDeals: Array<{dealName, dealOwner, dealLink, meetingDateTimeSales}>, status: 'ready'|'error'}>`. Note this section takes `dealId` directly, not a `companies` list — per `architecturefinal.md`, prior deals resolve via the deal's contact, not its company.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/sections/hubspotSignals.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUBSPOT_API_KEY = 'pat-test-key';

import { buildHubspotSignals } from '../../../src/briefy/sections/hubspotSignals.js';

test('returns empty-but-ready signals when the deal has no associated contact', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const result = await buildHubspotSignals('123');
  assert.deepEqual(result, { lastPageVisited: '', lastPageVisitedAt: null, priorDeals: [], status: 'ready' });
});

test('returns last page visited and prior deals with resolved owner names and links', async (t) => {
  const responses = [
    { results: [{ id: '999' }] }, // deal associations -> contact
    { properties: { email: 'jane@acme.com', firstname: 'Jane', lastname: 'Doe' } }, // contact details
    { properties: { hs_analytics_last_url: 'https://acme.com/pricing', hs_analytics_last_timestamp: '2026-01-01T00:00:00Z' } }, // analytics
    { results: [{ id: '111', properties: { dealname: 'Old Deal', hubspot_owner_id: '55', meeting_date___time___sales: '2025-01-01T10:00:00Z' } }] }, // prior deals
    { results: [{ id: '55', firstName: 'Sam', lastName: 'Lee' }] }, // owners list for getOwnerName
  ];
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(responses[call++]), { status: 200 }));

  const result = await buildHubspotSignals('222');
  assert.equal(result.status, 'ready');
  assert.equal(result.lastPageVisited, 'https://acme.com/pricing');
  assert.equal(result.priorDeals.length, 1);
  assert.equal(result.priorDeals[0].dealName, 'Old Deal');
  assert.equal(result.priorDeals[0].dealOwner, 'Sam Lee');
  assert.equal(result.priorDeals[0].dealLink, 'https://app.hubspot.com/contacts/20155995/deal/111');
  assert.equal(result.priorDeals[0].meetingDateTimeSales, '2025-01-01T10:00:00Z');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/sections/hubspotSignals.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/sections/hubspotSignals.js`**

```javascript
import { getDealContact, getDealsForContact, getContactAnalytics, getOwnerName } from '../../lib/hubspot.js';

const HUBSPOT_PORTAL_ID = '20155995';

/**
 * @param {string} dealId
 * @returns {Promise<{lastPageVisited: string, lastPageVisitedAt: string|null, priorDeals: Array<{dealName: string, dealOwner: string, dealLink: string, meetingDateTimeSales: string|null}>, status: 'ready'|'error'}>}
 */
export async function buildHubspotSignals(dealId) {
  try {
    const contact = await getDealContact(dealId);
    if (!contact) {
      return { lastPageVisited: '', lastPageVisitedAt: null, priorDeals: [], status: 'ready' };
    }

    const [analytics, priorDealsRaw] = await Promise.all([
      getContactAnalytics(contact.id),
      getDealsForContact(contact.id, dealId),
    ]);

    const priorDeals = await Promise.all(priorDealsRaw.map(async d => ({
      dealName: d.dealName,
      dealOwner: await getOwnerName(d.ownerId),
      dealLink: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${d.id}`,
      meetingDateTimeSales: d.meetingDateTimeSales,
    })));

    return {
      lastPageVisited: analytics.lastUrl || '',
      lastPageVisitedAt: analytics.lastTimestamp || null,
      priorDeals,
      status: 'ready',
    };
  } catch (err) {
    return { lastPageVisited: '', lastPageVisitedAt: null, priorDeals: [], status: 'error', error: err.message };
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: both `tests/briefy/sections/hubspotSignals.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/sections/hubspotSignals.js tests/briefy/sections/hubspotSignals.test.js
git commit -m "feat: add HubSpot signals section (last page visited + prior deals via contact)"
```

---

### Task 5.4: `src/briefy/sections/intent.js`

**Files:**
- Create: `src/briefy/sections/intent.js`
- Test: `tests/briefy/sections/intent.test.js`

**Interfaces:**
- Consumes: `enrichIntent` from `../../lib/zoominfo.js`.
- Produces: `buildIntent(domain)` → `Promise<{intentScore: string, status: 'ready'|'unavailable'|'error'}>`. Reads topic IDs from `ZOOMINFO_INTENT_TOPICS` (comma-separated env var).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/sections/intent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ZOOMINFO_CLIENT_ID = 'test-id';
process.env.ZOOMINFO_CLIENT_SECRET = 'test-secret';

import { buildIntent } from '../../../src/briefy/sections/intent.js';

test('returns unavailable when ZOOMINFO_INTENT_TOPICS is unset', async () => {
  delete process.env.ZOOMINFO_INTENT_TOPICS;
  const result = await buildIntent('acme.com');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.intentScore, '');
});

test('returns the intent score when topics are configured and ZoomInfo responds', async (t) => {
  process.env.ZOOMINFO_INTENT_TOPICS = 'topic-1,topic-2';
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ attributes: { topics: [{ topic: 'Construction Software', score: 91 }] } }] }), { status: 200 });
  });
  const result = await buildIntent('acme.com');
  assert.equal(result.status, 'ready');
  assert.equal(result.intentScore, '91');
});
```

Note: `buildIntent` reads `ZOOMINFO_INTENT_TOPICS` at call time inside `getTopics()`, not at module load time — this is what makes it safe for both tests to share one static import while changing the env var between them (see Step 3's implementation).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/sections/intent.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/sections/intent.js`**

Read `ZOOMINFO_INTENT_TOPICS` at call time (not module load time), so tests that change the env var between imports behave predictably:

```javascript
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: both `tests/briefy/sections/intent.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/sections/intent.js tests/briefy/sections/intent.test.js
git commit -m "feat: add ZoomInfo Intent section"
```

---

## Milestone 6: Orchestration — `briefBuilder.js` + `engine.js`

Wire everything together into the actual polling daemon.

### Task 6.1: `src/briefy/briefBuilder.js`

**Files:**
- Create: `src/briefy/briefBuilder.js`
- Test: `tests/briefy/briefBuilder.test.js`

**Interfaces:**
- Consumes: `createBase`, `updateRecord` from `../lib/airtable.js`; `resolveCompany` from `./resolveCompany.js`; `buildOverview`, `buildOrgTree`, `buildRevenue`, `buildHubspotSignals`, `buildHiringSignals`, `buildIntent` from `./sections/*.js`.
- Produces: `buildBrief(record, deps = {})` → `Promise<void>` (writes to Airtable as a side effect, always targeting Briefy's own base via `createBase(BRIEFY_AIRTABLE_BASE_ID)` — never ICP Match's base). `deps` accepts optional overrides for every dependency above (dependency injection for testability) — `engine.js` calls it with no `deps`, tests call it with fakes. Reads `Company Name` and `Exa Content` off the record (both seeded by `syncFromIcpMatch.js`, Task 2.2) and threads them into `buildHiringSignalsFn`/`buildOverviewFn` respectively.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/briefy/briefBuilder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief } from '../../src/briefy/briefBuilder.js';

test('writes sections and Ready status for a resolved domain', async () => {
  const writes = [];
  const record = { id: 'rec1', fields: { 'Deal ID': '999', 'Company Domain': 'acme.com', 'Company Name': 'Acme', 'Exa Content': 'existing content' } };

  await buildBrief(record, {
    resolveCompanyFn: () => ({ domain: 'acme.com', status: 'resolved' }),
    buildOverviewFn: async () => ({ overview: 'Acme builds things.', portfolio: '', status: 'ready' }),
    buildOrgTreeFn: async () => ({ orgTree: { estimators: [], programManagers: [], upperManagement: [] }, status: 'ready' }),
    buildRevenueFn: async () => ({ zoomInfoRevenue: '$5M-$10M', clayRevenue: 'pending', status: 'ready' }),
    buildHubspotSignalsFn: async () => ({ lastPageVisited: '/pricing', lastPageVisitedAt: '2026-01-01T00:00:00Z', priorDeals: [], status: 'ready' }),
    buildHiringSignalsFn: async () => ({ openRoles: [], status: 'ready' }),
    buildIntentFn: async () => ({ intentScore: '85', status: 'ready' }),
    updateRecordFn: async (table, id, fields) => { writes.push({ table, id, fields }); },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'Briefy');
  assert.equal(writes[0].id, 'rec1');
  assert.equal(writes[0].fields['Brief Status'], 'Ready');
  assert.equal(writes[0].fields['Company Overview'], 'Acme builds things.');
  assert.equal(writes[0].fields['ZoomInfo Revenue'], '$5M-$10M');
  assert.equal(writes[0].fields['ZoomInfo Intent Score'], '85');
  const sectionStatus = JSON.parse(writes[0].fields['Section Status']);
  assert.equal(sectionStatus.revenue, 'ready');
});

test('marks the row Error and skips sections entirely when no domain resolves', async () => {
  const writes = [];
  const record = { id: 'rec2', fields: { 'Deal ID': '1000', 'Company Domain': '' } };

  await buildBrief(record, {
    resolveCompanyFn: () => ({ domain: null, status: 'not_found' }),
    updateRecordFn: async (table, id, fields) => { writes.push({ table, id, fields }); },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].fields['Brief Status'], 'Error');
});

test('passes the seeded Exa Content and Company Name through to the relevant sections', async () => {
  let receivedOverviewArgs, receivedHiringArgs;
  const record = { id: 'rec3', fields: { 'Deal ID': '1001', 'Company Domain': 'acme.com', 'Company Name': 'Acme Roofing', 'Exa Content': 'pre-scraped text' } };

  await buildBrief(record, {
    resolveCompanyFn: () => ({ domain: 'acme.com', status: 'resolved' }),
    buildOverviewFn: async (domain, existingExaContent) => {
      receivedOverviewArgs = { domain, existingExaContent };
      return { overview: '', portfolio: '', status: 'ready' };
    },
    buildOrgTreeFn: async () => ({ orgTree: { estimators: [], programManagers: [], upperManagement: [] }, status: 'ready' }),
    buildRevenueFn: async () => ({ zoomInfoRevenue: '', clayRevenue: '', status: 'ready' }),
    buildHubspotSignalsFn: async () => ({ lastPageVisited: '', lastPageVisitedAt: null, priorDeals: [], status: 'ready' }),
    buildHiringSignalsFn: async (domain, companyName) => {
      receivedHiringArgs = { domain, companyName };
      return { openRoles: [], status: 'ready' };
    },
    buildIntentFn: async () => ({ intentScore: '', status: 'unavailable' }),
    updateRecordFn: async () => {},
  });

  assert.deepEqual(receivedOverviewArgs, { domain: 'acme.com', existingExaContent: 'pre-scraped text' });
  assert.deepEqual(receivedHiringArgs, { domain: 'acme.com', companyName: 'Acme Roofing' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/briefy/briefBuilder.js` does not exist yet.

- [ ] **Step 3: Implement `src/briefy/briefBuilder.js`**

```javascript
import { createBase, updateRecord } from '../lib/airtable.js';
import { resolveCompany } from './resolveCompany.js';
import { buildOverview } from './sections/overview.js';
import { buildOrgTree } from './sections/orgTree.js';
import { buildRevenue } from './sections/revenue.js';
import { buildHubspotSignals } from './sections/hubspotSignals.js';
import { buildHiringSignals } from './sections/hiringSignals.js';
import { buildIntent } from './sections/intent.js';

const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

// Briefy always writes to its OWN Airtable base — never ICP Match's base.
const briefyBase = createBase(process.env.BRIEFY_AIRTABLE_BASE_ID);

function defaultUpdateRecord(tableName, recordId, fields) {
  return updateRecord(tableName, recordId, fields, briefyBase);
}

function emptySectionStatus(value) {
  return JSON.stringify({
    overview: value, portfolio: value, orgTree: value, revenue: value,
    hubspotSignals: value, hiringSignals: value, intent: value,
  });
}

/**
 * Build one Briefy Airtable row's full brief: resolve the domain, fan out
 * all six research sections concurrently, write the results.
 * @param {{id: string, fields: Record<string, any>}} record - an Airtable record
 * @param {object} [deps] - optional overrides for every dependency, for testing
 */
export async function buildBrief(record, deps = {}) {
  const {
    resolveCompanyFn = resolveCompany,
    buildOverviewFn = buildOverview,
    buildOrgTreeFn = buildOrgTree,
    buildRevenueFn = buildRevenue,
    buildHubspotSignalsFn = buildHubspotSignals,
    buildHiringSignalsFn = buildHiringSignals,
    buildIntentFn = buildIntent,
    updateRecordFn = defaultUpdateRecord,
  } = deps;

  const dealId = record.fields['Deal ID'];
  const companyName = record.fields['Company Name'] || '';
  const existingExaContent = record.fields['Exa Content'] || '';
  const companyDomainCell = record.fields['Company Domain'] || '';

  const resolution = await resolveCompanyFn(companyDomainCell);

  if (resolution.status === 'not_found') {
    await updateRecordFn(TABLE, record.id, {
      'Brief Status': 'Error',
      'Section Status': emptySectionStatus('unavailable'),
      'Last Enriched At': new Date().toISOString(),
    });
    return;
  }

  const domain = resolution.domain;

  const [overview, orgTree, revenue, hubspotSignals, hiringSignals, intent] = await Promise.all([
    buildOverviewFn(domain, existingExaContent),
    buildOrgTreeFn(domain),
    buildRevenueFn(domain, dealId),
    buildHubspotSignalsFn(dealId),
    buildHiringSignalsFn(domain, companyName),
    buildIntentFn(domain),
  ]);

  const sectionStatus = JSON.stringify({
    overview: overview.status,
    portfolio: overview.status,
    orgTree: orgTree.status,
    revenue: revenue.status,
    hubspotSignals: hubspotSignals.status,
    hiringSignals: hiringSignals.status,
    intent: intent.status,
  });

  await updateRecordFn(TABLE, record.id, {
    'Company Overview': overview.overview,
    'Portfolio / Projects': overview.portfolio,
    'Org Tree': JSON.stringify(orgTree.orgTree),
    'ZoomInfo Revenue': revenue.zoomInfoRevenue,
    'Clay Revenue': revenue.clayRevenue,
    'Last Page Visited': hubspotSignals.lastPageVisited,
    'Last Page Visited At': hubspotSignals.lastPageVisitedAt,
    'Prior Deals': JSON.stringify(hubspotSignals.priorDeals),
    'Open Roles': JSON.stringify(hiringSignals.openRoles),
    'ZoomInfo Intent Score': intent.intentScore,
    'Brief Status': 'Ready',
    'Section Status': sectionStatus,
    'Last Enriched At': new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: all 3 `tests/briefy/briefBuilder.test.js` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/briefy/briefBuilder.js tests/briefy/briefBuilder.test.js
git commit -m "feat: add briefBuilder orchestrating all six sections against the resolved domain"
```

---

### Task 6.2: `src/briefy/engine.js`

**Files:**
- Create: `src/briefy/engine.js`
- Modify: `package.json`, `.env.example`

**Interfaces:**
- Consumes: `buildBrief` from `./briefBuilder.js`; `syncFromIcpMatch` from `./syncFromIcpMatch.js` (Task 2.2).
- Produces: a long-running CLI daemon (no exports), started via `npm run briefy`. Mirrors `src/watch.js`'s poll-loop shape exactly, with one addition: `syncFromIcpMatch()` runs first each tick, before polling the Briefy base for pending rows.

- [ ] **Step 1: Create `src/briefy/engine.js`**

```javascript
/**
 * Briefy Engine — Airtable Watch Daemon
 *
 * Every N minutes (default 5):
 *   1. syncFromIcpMatch() — mirror any newly-eligible "ICP Match Final" rows
 *      (Deal Owner + Enriched At both set) into the Briefy base
 *   2. Check the Briefy Airtable table for rows with Brief Status in
 *      Not Started / Refreshing / blank
 *   3. For each, build the full brief (briefBuilder.js) and write it back
 *
 * Run manually:
 *   node src/briefy/engine.js
 *
 * Run as a permanent daemon (Railway, same pattern as src/watch.js):
 *   startCommand: node src/briefy/engine.js
 *
 * Env vars:
 *   BRIEFY_AIRTABLE_BASE_ID    — Briefy's OWN Airtable base id (never ICP Match's)
 *   BRIEFY_AIRTABLE_TABLE      — table name within that base (default: "Briefy")
 *   BRIEFY_WATCH_INTERVAL_MIN  — poll interval in minutes (default: 5)
 */
import 'dotenv/config';
import Airtable from 'airtable';
import { buildBrief } from './briefBuilder.js';
import { syncFromIcpMatch } from './syncFromIcpMatch.js';

const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';
const INTERVAL_MIN = parseInt(process.env.BRIEFY_WATCH_INTERVAL_MIN || '5', 10);
const INTERVAL_MS = INTERVAL_MIN * 60_000;

// Briefy's own, separate Airtable base — deliberately not AIRTABLE_BASE_ID (ICP Match's).
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.BRIEFY_AIRTABLE_BASE_ID);

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function getPendingRows() {
  return base(TABLE).select({
    filterByFormula: `OR({Brief Status} = "Not Started", {Brief Status} = "Refreshing", {Brief Status} = "")`,
  }).all();
}

async function tick() {
  const { checked, created } = await syncFromIcpMatch();
  if (created > 0) {
    console.log(`[${ts()}] Synced ${created} new row(s) from ICP Match Final (${checked} checked).`);
  }

  const rows = await getPendingRows();
  if (!rows.length) {
    console.log(`[${ts()}] No pending briefs.`);
    return;
  }

  console.log(`[${ts()}] ${rows.length} pending brief(s) — building...`);
  for (const row of rows) {
    try {
      await base(TABLE).update(row.id, { 'Brief Status': 'Generating' });
      await buildBrief(row);
      console.log(`[${ts()}] Brief built for record ${row.id}`);
    } catch (err) {
      console.error(`[${ts()}] ERROR building brief for ${row.id}: ${err.message}`);
      await base(TABLE).update(row.id, { 'Brief Status': 'Error' }).catch(() => {});
    }
  }
}

async function main() {
  console.log(`[${ts()}] Briefy engine started`);
  console.log(`[${ts()}] Table    : ${TABLE}`);
  console.log(`[${ts()}] Interval : every ${INTERVAL_MIN} min\n`);

  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error(`[${ts()}] Fatal tick error: ${err.message}`);
    }
    console.log(`[${ts()}] Next cycle in ${INTERVAL_MIN} min\n`);
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

main().catch(err => {
  console.error(`[${ts()}] Fatal: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax-check it**

Run: `node --check src/briefy/engine.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Add the npm script**

Modify `package.json`'s `"scripts"` block to add:

```json
    "briefy": "node src/briefy/engine.js",
```

- [ ] **Step 4: Add the new env vars to `.env.example`**

Append this block to `.env.example`:

```env
# ── Briefy ────────────────────────────────────────────────────────────────────
BRIEFY_AIRTABLE_BASE_ID=app...        # a NEW, separate Airtable base — never ICP Match's base
BRIEFY_AIRTABLE_TABLE=Briefy         # table name within that new base
BRIEFY_WATCH_INTERVAL_MIN=5          # Briefy engine poll interval in minutes

# ── Clay (Briefy revenue/org-tree supplement, async webhook) ────────────────
CLAY_API_KEY=...
CLAY_WEBHOOK_URL=...                 # per-table trigger URL from your Clay account

# ── ZoomInfo Intent (Briefy buying-intent score) ─────────────────────────────
ZOOMINFO_INTENT_TOPICS=...           # comma-separated topic IDs
```

- [ ] **Step 5: Manual end-to-end verification once real credentials exist (not automatable here)**

Run: `test -f .env && npm run briefy:setup-table && npm run briefy || echo "No .env present — defer this end-to-end run until real credentials (Airtable, HubSpot, ZoomInfo, Exa, Firecrawl, SerpAPI, Requesty) are available"`
Expected: with real credentials, create a test row in the Briefy table with just a `Company Domain` and `Deal ID` filled in, run `npm run briefy` once, and confirm in the Airtable UI that `Brief Status` moves `Not Started` → `Generating` → `Ready` (or `Error`, with a specific `Section Status` breakdown of what failed) and the research fields populate. Without a `.env` here, this step is explicitly deferred — say so rather than claiming it ran.

- [ ] **Step 6: Commit**

```bash
git add src/briefy/engine.js package.json .env.example
git commit -m "feat: add Briefy engine — Airtable poll loop mirroring watch.js"
```

---

## Self-Review Notes

**Spec coverage check against `architecturefinal.md`:**
- Company domain normalization (replaces the removed multi-company tiebreak — moot now that `Company Domain` is always single-valued, seeded from ICP Match Final) → Task 3.1 (`resolveCompany.js`). ✓
- Prior deals via contact, not company → Task 5.3 (`hubspotSignals.js`), backed by Task 1.3's `getDealContact`/`getDealsForContact`/`getOwnerName`. ✓
- All 6 research sections → Milestones 4 and 5. ✓
- `overview.js` prefers the already-copied `Exa Content` over re-scraping → Task 4.1. ✓
- `src/lib/` reuse (hubspot, zoominfo, scrapers, requesty, clay) → Milestone 1. ✓
- Briefy Airtable schema (seed fields + engine-owned + research output) → Task 2.1. ✓
- Data source: seeded from ICP Match Final, no new HubSpot workflow → Task 2.2 (`syncFromIcpMatch.js`), called first each tick by Task 6.2 (`engine.js`). ✓
- Briefy uses a completely separate Airtable base, never ICP Match's → Task 1.6 (`createBase()` generalization), Task 2.1 (setup script targets `BRIEFY_AIRTABLE_BASE_ID`), Task 2.2 (`syncFromIcpMatch.js` reads ICP Match's default base, writes Briefy's separate base), Task 6.1 (`briefBuilder.js` writes via `briefyBase`), Task 6.2 (`engine.js` reads via `BRIEFY_AIRTABLE_BASE_ID`). ✓
- Engine mirroring `watch.js` → Task 6.2. ✓
- `.env.example` additions → Task 6.2, Step 4 (backend-relevant vars only; Google OAuth/NextAuth vars belong to the frontend plan). ✓
- `briefy/owner-map.js` placeholder → Task 3.2. ✓
- Not covered by this plan (by design, per the plan header): the `web/` Next.js frontend. The three fields you're adding to "ICP Match Final" yourself (`Deal Owner`, `Deal Stage`, `Deal Link`) and verifying the exact live field names for `IP State`/`IP Country`/`Meeting Date & Time` are prerequisites for Task 2.2 to do anything useful, not something this plan builds.

**Type/interface consistency check:** every section function takes a plain `domain` string (not an array) — `buildOverview(domain, existingExaContent)`, `buildOrgTree(domain)`, `buildRevenue(domain, dealId)`, `buildHiringSignals(domain, companyName)`, `buildIntent(domain)` — produced by `resolveCompany`'s `.domain` field, consistent across Tasks 3.1, 4.1, 4.2, 5.1, 5.2, 5.4, and consumed correctly in Task 6.1's `briefBuilder.js`. `buildHubspotSignals(dealId)` is the one deliberate exception (takes a plain `dealId`, not a domain) — called out explicitly in its Interfaces block so a future reader isn't confused by the asymmetry.

**Placeholder scan:** no TBD/TODO markers; every step has complete, real code; no test lacks assertions.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-briefy-backend-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
