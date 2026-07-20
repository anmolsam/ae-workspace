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
