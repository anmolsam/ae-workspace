/**
 * Normalize the "Company Domain" cell seeded from ICP Match Final (Task 2.2).
 * This is always a single, already-resolved domain by the time it reaches Briefy —
 * ICP Match works one domain per row and excludes personal-email domains upstream —
 * so this is pure cleanup, not disambiguation. See architecturefinal.md > "Company
 * domain normalization" for why the earlier multi-domain tiebreak logic was removed.
 * @param {string} companyDomainCell
 * @returns {{domain: string|null, status: 'resolved'|'not_found'}}
 */
export function resolveCompany(companyDomainCell) {
  const domain = (companyDomainCell || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  if (!domain) return { domain: null, status: 'not_found' };
  return { domain, status: 'resolved' };
}
