import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHiringSignals } from '../../../src/briefy/sections/hiringSignals.js';

process.env.SERPAPI_KEY = 'test-serp-key';
process.env.JINA_API_KEY = 'test-jina-key';

test('combines a careers-page hit and SerpAPI results into one list', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('r.jina.ai')) {
      // Jina Reader returns plain text (the careers page content).
      return new Response('Careers at Acme. '.repeat(20), { status: 200 });
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
