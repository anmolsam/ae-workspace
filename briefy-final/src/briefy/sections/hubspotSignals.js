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
