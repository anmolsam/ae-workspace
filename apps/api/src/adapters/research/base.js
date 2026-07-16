/**
 * ResearchProvider interface (spec §23). Every source implements the same
 * shape so BriefGenerationService can fan out without knowing the provider.
 * Providers are modular — one file per source, never one giant service.
 *
 * @typedef {Object} CompanyResearchInput  { domain, companyName }
 * @typedef {Object} PersonResearchInput   { name, email, companyName }
 * @typedef {Object} ResearchResult
 *   { provider, kind:'company'|'person', ok:boolean, data?:object, error?:string, fetchedAt }
 */
export class ResearchProvider {
  /** @param {string} name  provider key: 'exa'|'zoominfo'|'jina'|'seamless'|'firecrawl' */
  constructor(name) { this.name = name; }
  /** @returns {boolean} whether the provider has credentials configured. */
  get available() { return false; }
  /** @param {CompanyResearchInput} _input @returns {Promise<ResearchResult>} */
  async enrichCompany(_input) { return this.#unsupported('company'); }
  /** @param {PersonResearchInput} _input @returns {Promise<ResearchResult>} */
  async enrichPerson(_input) { return this.#unsupported('person'); }
  #unsupported(kind) {
    return { provider: this.name, kind, ok: false, error: 'not_supported', fetchedAt: new Date().toISOString() };
  }
}

export const ok = (provider, kind, data) => ({ provider, kind, ok: true, data, fetchedAt: new Date().toISOString() });
export const fail = (provider, kind, error) => ({ provider, kind, ok: false, error: String(error), fetchedAt: new Date().toISOString() });
