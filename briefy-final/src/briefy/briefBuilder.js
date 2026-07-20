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
