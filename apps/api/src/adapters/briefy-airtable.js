import { config } from '../config/index.js';
import { httpJson, TtlCache } from '../lib/http.js';

/**
 * BriefyAirtableAdapter — reads the briefy-final Airtable base (the base
 * shashank's Briefy engine writes pre-call briefs into). Uses the Airtable REST
 * API directly (no extra dependency). Read-only except for a re-queue helper.
 *
 * Per-AE isolation: callers pass the set of "Deal Owner" values that belong to
 * the logged-in AE; only matching rows are returned.
 */
const AT = 'https://api.airtable.com/v0';
const cache = new TtlCache(60 * 1000);
const auth = () => ({ Authorization: `Bearer ${config.briefyAirtable.apiKey}` });
const tbl = () => encodeURIComponent(config.briefyAirtable.table);

/** Escape a value for an Airtable filterByFormula string literal. */
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** All brief rows whose "Deal Owner" is one of `owners`. */
export async function listBriefsForOwners(owners) {
  const clean = [...new Set(owners.filter(Boolean))];
  if (!clean.length) return [];
  const key = `list:${clean.join('|')}`;
  return cache.wrap(key, async () => {
    const formula = `OR(${clean.map((o) => `{Deal Owner}="${esc(o)}"`).join(',')})`;
    const url = `${AT}/${config.briefyAirtable.baseId}/${tbl()}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
    const rows = [];
    let offset;
    do {
      const page = await httpJson(offset ? `${url}&offset=${offset}` : url, { headers: auth() });
      rows.push(...(page.records || []));
      offset = page.offset;
    } while (offset);
    return rows;
  });
}

/** One brief row by Airtable record id. */
export async function getBriefRow(recordId) {
  return httpJson(`${AT}/${config.briefyAirtable.baseId}/${tbl()}/${recordId}`, { headers: auth() });
}

/** Re-queue a row for the Briefy engine to rebuild (used by "generate/refresh"). */
export async function requeueBrief(recordId) {
  cache.map.clear();
  return httpJson(`${AT}/${config.briefyAirtable.baseId}/${tbl()}/${recordId}`, {
    method: 'PATCH', headers: auth(),
    body: { fields: { 'Brief Status': 'Not Started' } },
  });
}

/** Look up a row in the read-only ICP Match base by Deal ID (to seed a brief). */
export async function getIcpRowByDealId(dealId) {
  const t = encodeURIComponent(config.briefyAirtable.icpTable);
  const formula = encodeURIComponent(`{Deal ID}="${esc(dealId)}"`);
  const url = `${AT}/${config.briefyAirtable.icpBaseId}/${t}?filterByFormula=${formula}&maxRecords=1`;
  const d = await httpJson(url, { headers: auth() });
  return d.records?.[0] || null;
}

/** Create a new Briefy row (used to lazily mirror a freshly-scheduled demo). */
export async function createBriefRow(fields) {
  cache.map.clear();
  const d = await httpJson(`${AT}/${config.briefyAirtable.baseId}/${tbl()}`, {
    method: 'POST', headers: auth(), body: { fields },
  });
  return d;
}
