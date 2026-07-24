import { searchContacts } from '../../lib/zoominfo.js';
import { serpPeople } from '../../lib/scrapers.js';
import { mcpAvailable, orgTreeMcp } from '../../lib/zoominfo-mcp.js';

const ESTIMATOR_TITLES = ['estimator', 'estimating', 'preconstruction'];
const PM_TITLES = ['project manager', 'program manager', 'construction manager'];
const UPPER_MGMT_TITLES = ['ceo', 'president', 'owner', 'vice president', 'vp', 'chief', 'director', 'principal'];

function categorize(title) {
  const t = (title || '').toLowerCase();
  if (UPPER_MGMT_TITLES.some((k) => t.includes(k))) return 'upperManagement';
  if (PM_TITLES.some((k) => t.includes(k))) return 'programManagers';
  if (ESTIMATOR_TITLES.some((k) => t.includes(k))) return 'estimators';
  return null;
}

function emptyTree() {
  return { estimators: [], programManagers: [], upperManagement: [] };
}

function fill(tree, contacts, source) {
  for (const c of contacts) {
    const bucket = categorize(c.title);
    if (bucket) tree[bucket].push({ name: c.name, title: c.title, email: c.email || '', source });
  }
}

function total(tree) {
  return tree.estimators.length + tree.programManagers.length + tree.upperManagement.length;
}

/**
 * Build the org tree. Primary source is ZoomInfo; when it returns nothing (or
 * errors), fall back to SerpAPI LinkedIn people search so the section is filled
 * with real decision-makers rather than showing an error. Output shape is
 * unchanged (estimators / programManagers / upperManagement of {name,title,email,source}).
 *
 * @param {string} domain
 * @param {string} [companyName]
 */
export async function buildOrgTree(domain, companyName) {
  let tree = emptyTree();
  let zoomInfoError = false;

  // Primary: ZoomInfo MCP (search by dept + enrich for email/phone/linkedin).
  if (mcpAvailable()) {
    try {
      const mcpTree = await orgTreeMcp(domain);
      if (mcpTree) tree = { estimators: mcpTree.estimators, programManagers: mcpTree.programManagers, upperManagement: mcpTree.upperManagement };
    } catch {
      zoomInfoError = true;
    }
  } else {
    try {
      const contacts = await searchContacts(domain, [...ESTIMATOR_TITLES, ...PM_TITLES, ...UPPER_MGMT_TITLES]);
      fill(tree, contacts, 'ZoomInfo');
    } catch {
      zoomInfoError = true;
    }
  }

  // Fallback: if ZoomInfo found nobody, search LinkedIn via SerpAPI.
  if (total(tree) === 0) {
    const people = await serpPeople(companyName, domain).catch(() => []);
    fill(tree, people, 'LinkedIn (via Google)');
  }

  if (total(tree) > 0) return { orgTree: tree, status: 'ready' };
  // Nothing anywhere: 'ready' with an empty tree renders "No contacts found."
  // Only report 'error' if ZoomInfo threw and the fallback also found nothing.
  return { orgTree: tree, status: zoomInfoError ? 'error' : 'ready' };
}
