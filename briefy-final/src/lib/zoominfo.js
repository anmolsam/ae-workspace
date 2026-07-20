import 'dotenv/config';

const OKTA_TOKEN_URL = 'https://okta-login.zoominfo.com/oauth2/default/v1/token';
const API_BASE = 'https://api.zoominfo.com/gtm/data/v1';

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const creds = Buffer.from(
    `${process.env.ZOOMINFO_CLIENT_ID}:${process.env.ZOOMINFO_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(OKTA_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=api%3Adata%3Acompany',
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`ZoomInfo auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + 55 * 60 * 1000;
  return _token;
}

const OUTPUT_FIELDS = [
  'name', 'website', 'primaryIndustry', 'industries',
  'employeeCount', 'revenueRange', 'country', 'state', 'city', 'type',
];

export async function enrichCompanyByDomain(domain) {
  const token = await getToken();

  const res = await fetch(`${API_BASE}/companies/enrich`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'CompanyEnrich',
        attributes: {
          outputFields: OUTPUT_FIELDS,
          matchCompanyInput: [{ companyWebsite: domain }],
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`ZoomInfo enrich failed for ${domain}: ${res.status} ${text}`);

  const json = JSON.parse(text);
  const result = json?.data?.[0]?.attributes;
  if (!result || result.matchStatus === 'No match') return null;

  const industryArr = Array.isArray(result.primaryIndustry) ? result.primaryIndustry : [result.primaryIndustry].filter(Boolean);

  return {
    companyName: result.name,
    industry: industryArr[0] || '',
    industries: industryArr,
    headcount: result.employeeCount,
    revenue: result.revenueRange,
    country: result.country,
    ownershipType: result.type,
  };
}

// Batch enrich up to 25 domains per call
export async function enrichBatch(domains) {
  const results = [];
  const BATCH = 25;

  for (let i = 0; i < domains.length; i += BATCH) {
    const chunk = domains.slice(i, i + BATCH);
    const token = await getToken();

    try {
      const res = await fetch(`${API_BASE}/companies/enrich`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'CompanyEnrich',
            attributes: {
              outputFields: OUTPUT_FIELDS,
              matchCompanyInput: chunk.map(d => ({ companyWebsite: d })),
            },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`Batch enrich failed: ${res.status} ${text}`);

      const json = JSON.parse(text);
      for (let j = 0; j < chunk.length; j++) {
        const r = json?.data?.[j]?.attributes;
        if (!r || r.matchStatus === 'No match') {
          results.push({ domain: chunk[j], error: 'no match' });
        } else {
          const batchIndustryArr = Array.isArray(r.primaryIndustry) ? r.primaryIndustry : [r.primaryIndustry].filter(Boolean);
          results.push({
            domain: chunk[j],
            companyName: r.name,
            industry: batchIndustryArr[0] || '',
            industries: batchIndustryArr,
            headcount: r.employeeCount,
            revenue: r.revenueRange,
            country: r.country,
            ownershipType: r.type,
          });
        }
      }
    } catch (err) {
      chunk.forEach(d => results.push({ domain: d, error: err.message }));
    }

    await new Promise(r => setTimeout(r, 250)); // 4 req/sec safe rate
  }

  return results;
}

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
    signal: AbortSignal.timeout(20_000),
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
    signal: AbortSignal.timeout(20_000),
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

// For testing only — resets the token cache
export function _testReset() {
  _token = null;
  _tokenExpiry = 0;
}
