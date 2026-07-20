import { searchContacts } from '../../lib/zoominfo.js';

const ESTIMATOR_TITLES = ['estimator', 'estimating', 'preconstruction'];
const PM_TITLES = ['project manager', 'program manager', 'construction manager'];
const UPPER_MGMT_TITLES = ['ceo', 'president', 'owner', 'vice president', 'vp', 'chief', 'director', 'principal'];

function categorize(title) {
  const t = (title || '').toLowerCase();
  if (UPPER_MGMT_TITLES.some(k => t.includes(k))) return 'upperManagement';
  if (PM_TITLES.some(k => t.includes(k))) return 'programManagers';
  if (ESTIMATOR_TITLES.some(k => t.includes(k))) return 'estimators';
  return null;
}

function emptyTree() {
  return { estimators: [], programManagers: [], upperManagement: [] };
}

/**
 * @param {string} domain
 * @returns {Promise<{orgTree: {estimators: Array, programManagers: Array, upperManagement: Array}, status: 'ready'|'error'}>}
 */
export async function buildOrgTree(domain) {
  try {
    const contacts = await searchContacts(domain, [...ESTIMATOR_TITLES, ...PM_TITLES, ...UPPER_MGMT_TITLES]);
    const tree = emptyTree();
    for (const c of contacts) {
      const bucket = categorize(c.title);
      if (bucket) tree[bucket].push({ ...c, source: 'ZoomInfo' });
    }
    return { orgTree: tree, status: 'ready' };
  } catch (err) {
    return { orgTree: emptyTree(), status: 'error', error: err.message };
  }
}
