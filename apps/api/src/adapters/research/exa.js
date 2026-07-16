import { ResearchProvider, ok, fail } from './base.js';
import { config } from '../../config/index.js';
import { httpJson } from '../../lib/http.js';

/**
 * ExaResearchProvider — reuses the Exa pattern proven in
 * beam-qualification-agent/src/integrations/prospect-research.js:8.
 */
export class ExaResearchProvider extends ResearchProvider {
  constructor() { super('exa'); }
  get available() { return Boolean(config.research.exaKey); }

  async #search(query, numResults = 3) {
    return httpJson('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': config.research.exaKey },
      body: { query, numResults, useAutoprompt: true, type: 'auto', contents: { text: { maxCharacters: 600 } } },
    });
  }

  async enrichCompany({ domain, companyName }) {
    if (!this.available) return fail(this.name, 'company', 'no_api_key');
    try {
      const res = await this.#search(`${companyName || domain} company overview, services, recent news`);
      return ok(this.name, 'company', { results: (res.results || []).map((r) => ({ title: r.title, url: r.url, text: r.text })) });
    } catch (e) { return fail(this.name, 'company', e.message); }
  }

  async enrichPerson({ name, companyName }) {
    if (!this.available) return fail(this.name, 'person', 'no_api_key');
    try {
      const res = await this.#search(`${name} ${companyName || ''} LinkedIn role background`);
      return ok(this.name, 'person', { results: (res.results || []).map((r) => ({ title: r.title, url: r.url, text: r.text })) });
    } catch (e) { return fail(this.name, 'person', e.message); }
  }
}
