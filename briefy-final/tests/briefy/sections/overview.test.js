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
  const result = await buildOverview('acme.com', 'PAGES SCRAPED (2)\n...pre-existing ICP Match content...', 'Acme');
  assert.equal(result.status, 'ready');
  assert.equal(result.overview, 'From existing content.');
  // Must not RE-SCRAPE the company site (exa /contents or firecrawl) when
  // existing content is provided. An exa.ai/search NEWS call is allowed — it
  // enriches the summary, it is not a site re-scrape.
  assert.ok(
    calledUrls.every(u => !u.includes('exa.ai/contents') && !u.includes('firecrawl.dev')),
    'should not re-scrape the company site when existing content is already provided',
  );
});
