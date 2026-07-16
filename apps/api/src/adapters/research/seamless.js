import { ResearchProvider, fail } from './base.js';
import { config } from '../../config/index.js';

/**
 * SeamlessProvider — NET-NEW (no prior integration existed). Seamless.AI's
 * contact/company enrichment API is contract-gated per account, so this adapter
 * is intentionally a clearly-marked stub: it advertises (un)availability and
 * returns an explicit error until SEAMLESS_API_KEY + the account's endpoint are
 * wired. It NEVER returns fabricated data. Fill in enrichPerson()/enrichCompany()
 * against the real Seamless endpoint when credentials are provisioned.
 */
export class SeamlessProvider extends ResearchProvider {
  constructor() { super('seamless'); }
  get available() { return Boolean(config.research.seamlessKey); }

  async enrichCompany() { return fail(this.name, 'company', this.available ? 'not_implemented' : 'no_api_key'); }
  async enrichPerson() { return fail(this.name, 'person', this.available ? 'not_implemented' : 'no_api_key'); }
}
