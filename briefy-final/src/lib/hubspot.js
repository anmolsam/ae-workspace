/**
 * HubSpot API client for icp-match.
 * Handles deal property updates with automatic rate-limit retry.
 *
 * Requires: HUBSPOT_API_KEY in .env
 *   - Private App token (pat-na1-…): recommended
 *   - Legacy hapikey: also supported
 */
import 'dotenv/config';

const BASE_URL = 'https://api.hubapi.com';

export async function hubspotRequest(method, path, body = null, _retries = 4) {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) throw new Error('HUBSPOT_API_KEY not set in .env');

  const headers = { 'Content-Type': 'application/json' };
  let url = `${BASE_URL}${path}`;

  if (key.startsWith('pat-')) {
    headers['Authorization'] = `Bearer ${key}`;
  } else {
    // Legacy hapikey — append to query string
    url += (path.includes('?') ? '&' : '?') + `hapikey=${key}`;
  }

  const opts = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  if (res.status === 429 && _retries > 0) {
    const after = parseInt(res.headers.get('retry-after') || '0', 10);
    const wait  = after > 0 ? after * 1000 : Math.min(1500 * (5 - _retries), 8000);
    console.warn(`[hubspot] 429 rate limit — retrying in ${wait}ms`);
    await new Promise(r => setTimeout(r, wait));
    return hubspotRequest(method, path, body, _retries - 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HubSpot ${res.status} on ${method} ${path}: ${text.slice(0, 300)}`);
  }

  return res.status === 204 ? null : res.json();
}

/**
 * PATCH a HubSpot deal's properties.
 * @param {string} dealId  - HubSpot numeric deal ID
 * @param {object} properties - key/value map of HubSpot internal property names
 */
export function updateDeal(dealId, properties) {
  return hubspotRequest('PATCH', `/crm/v3/objects/deals/${dealId}`, { properties });
}

/**
 * GET a HubSpot deal by numeric ID.
 * @param {string} dealId
 * @param {string[]} fields - property names to return
 */
export function getDeal(dealId, fields = ['dealname']) {
  return hubspotRequest('GET', `/crm/v3/objects/deals/${dealId}?properties=${fields.join(',')}`);
}

// Personal-email providers — never search by these, would return thousands of unrelated contacts.
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'me.com', 'ymail.com', 'rocketmail.com', 'comcast.net', 'verizon.net',
]);

/**
 * Find a HubSpot deal ID for a given company domain.
 * Strategy: search HubSpot contacts whose email ends in @domain → for each contact,
 * search deals filtered by associations.contact → return the most recently created deal.
 *
 * Used as a fallback when deal-name search fails (typical for deals like " - Shelby"
 * that have no company name in the dealname field).
 *
 * @param {string} domain - company domain (e.g. "paschenconcrete.com")
 * @returns {Promise<string|null>} HubSpot deal ID, or null if no match found
 */
export async function findDealIdByDomain(domain) {
  if (!domain || typeof domain !== 'string') return null;
  const clean = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!clean || GENERIC_EMAIL_DOMAINS.has(clean)) return null;

  // 1. Find contacts whose email is at this domain
  const contactSearch = await hubspotRequest('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: `@${clean}` }] }],
    properties: ['email'],
    limit: 100,
  });
  const contactIds = (contactSearch.results || []).map(c => c.id);
  if (contactIds.length === 0) return null;

  // 2. For each contact (capped at 20 to control API calls), find associated deals
  const deals = new Map(); // dealId -> createdate
  for (const cid of contactIds.slice(0, 20)) {
    try {
      const r = await hubspotRequest('POST', '/crm/v3/objects/deals/search', {
        filterGroups: [{ filters: [{ propertyName: 'associations.contact', operator: 'EQ', value: cid }] }],
        properties: ['dealname', 'createdate'],
        limit: 10,
      });
      for (const d of (r.results || [])) deals.set(d.id, d.properties.createdate || '');
    } catch { /* individual contact lookup failures are non-fatal */ }
  }
  if (deals.size === 0) return null;

  // 3. Return the most recently created deal (best heuristic when there are multiple)
  return [...deals.entries()].sort((a, b) => new Date(b[1]) - new Date(a[1]))[0][0];
}

/**
 * Search HubSpot deals by exact deal name (case-insensitive).
 * Returns the first matching deal's numeric ID, or null if not found.
 * @param {string} name - the dealname value to search for
 */
export async function searchDealByName(name) {
  if (!name || !name.trim()) return null;

  const data = await hubspotRequest('POST', '/crm/v3/objects/deals/search', {
    filterGroups: [{
      filters: [{
        propertyName: 'dealname',
        operator: 'EQ',
        value: name.trim(),
      }],
    }],
    properties: ['dealname'],
    limit: 2, // fetch 2 so we can warn if there are duplicates
  });

  const results = data?.results ?? [];
  if (results.length === 0) return null;
  if (results.length > 1) {
    console.warn(`[hubspot] WARNING: ${results.length} deals found for name "${name}" — using first match (ID ${results[0].id})`);
  }
  return results[0].id;
}

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
