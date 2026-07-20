async function careersPageRoles(domain) {
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://${domain}/careers`, formats: ['markdown'], onlyMainContent: true, timeout: 15000 }),
      signal: AbortSignal.timeout(20_000),
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
    const res = await fetch(`https://serpapi.com/search.json?q=${q}&num=5&api_key=${key}`, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const data = await res.json();
      for (const r of (data.organic_results || []).slice(0, 5)) {
        roles.push({ title: r.title, source: 'Google', link: r.link });
      }
    }
  } catch { /* SerpAPI failures here are non-fatal — just fewer roles found */ }

  try {
    const q2 = encodeURIComponent(`site:linkedin.com/jobs ${companyName || domain}`);
    const res2 = await fetch(`https://serpapi.com/search.json?q=${q2}&num=5&api_key=${key}`, { signal: AbortSignal.timeout(20_000) });
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
