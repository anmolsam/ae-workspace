import { createBase, updateRecord } from '../lib/airtable.js';
import { resolveCompany } from './resolveCompany.js';
import { buildOverview } from './sections/overview.js';
import { buildOrgTree } from './sections/orgTree.js';
import { buildRevenue } from './sections/revenue.js';
import { buildHubspotSignals } from './sections/hubspotSignals.js';
import { buildHiringSignals } from './sections/hiringSignals.js';
import { buildIntent } from './sections/intent.js';

const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

// Lazy initialization of Briefy's base — deferred until actually needed
let briefyBase = null;

function getBriefyBase() {
  if (!briefyBase) {
    briefyBase = createBase(process.env.BRIEFY_AIRTABLE_BASE_ID);
  }
  return briefyBase;
}

function defaultUpdateRecord(tableName, recordId, fields) {
  return updateRecord(tableName, recordId, fields, getBriefyBase());
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
    buildOverviewFn(domain, existingExaContent, companyName),
    buildOrgTreeFn(domain, companyName),
    buildRevenueFn(domain, dealId),
    buildHubspotSignalsFn(dealId),
    buildHiringSignalsFn(domain, companyName),
    buildIntentFn(domain, companyName),
  ]);

  // Never blank a previously-populated field when a section flakes (e.g. Jina/
  // ZoomInfo rate-limits mid-build). Prefer the fresh value; if it's empty and
  // the record already had one, keep the old. Track which sections we kept so
  // their status stays 'ready' rather than flipping to unavailable.
  const prior = record.fields || {};
  const orgHasPeople = (t) => t && (t.estimators?.length || t.programManagers?.length || t.upperManagement?.length);
  const priorOrg = (() => { try { return JSON.parse(prior['Org Tree'] || 'null'); } catch { return null; } })();

  const keptIntent = !String(intent.intentScore || '').trim() && String(prior['ZoomInfo Intent Score'] || '').trim();
  const keptOrg = !orgHasPeople(orgTree.orgTree) && orgHasPeople(priorOrg);
  const keptOverview = !String(overview.overview || '').trim() && String(prior['Company Overview'] || '').trim();
  const keptRevenue = !String(revenue.zoomInfoRevenue || '').trim() && String(prior['ZoomInfo Revenue'] || '').trim();
  const keptCompany = !revenue.company && (prior['ZoomInfo Company'] || 'null') !== 'null';

  const sectionStatus = JSON.stringify({
    overview: keptOverview ? 'ready' : overview.status,
    portfolio: overview.status,
    orgTree: keptOrg ? 'ready' : orgTree.status,
    revenue: keptRevenue || keptCompany ? 'ready' : revenue.status,
    hubspotSignals: hubspotSignals.status,
    hiringSignals: hiringSignals.status,
    intent: keptIntent ? 'ready' : intent.status,
  });

  await updateRecordFn(TABLE, record.id, {
    'Company Overview': keptOverview ? prior['Company Overview'] : overview.overview,
    'Portfolio / Projects': !String(overview.portfolio || '').trim() && prior['Portfolio / Projects'] ? prior['Portfolio / Projects'] : overview.portfolio,
    'Org Tree': keptOrg ? prior['Org Tree'] : JSON.stringify(orgTree.orgTree),
    'ZoomInfo Revenue': keptRevenue ? prior['ZoomInfo Revenue'] : revenue.zoomInfoRevenue,
    'ZoomInfo Company': keptCompany ? prior['ZoomInfo Company'] : JSON.stringify(revenue.company || null),
    'Clay Revenue': revenue.clayRevenue,
    'Last Page Visited': hubspotSignals.lastPageVisited,
    'Last Page Visited At': hubspotSignals.lastPageVisitedAt,
    'Prior Deals': JSON.stringify(hubspotSignals.priorDeals),
    'Open Roles': JSON.stringify(hiringSignals.openRoles),
    'ZoomInfo Intent Score': keptIntent ? prior['ZoomInfo Intent Score'] : intent.intentScore,
    'Brief Status': 'Ready',
    'Section Status': sectionStatus,
    'Last Enriched At': new Date().toISOString(),
  });
}
