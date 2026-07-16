import { ResearchProvider, ok, fail } from './base.js';
import { config } from '../../config/index.js';
import { httpJson } from '../../lib/http.js';

/**
 * JinaResearchProvider — NET-NEW (no prior integration existed in the audited
 * repos). Uses Jina Reader (r.jina.ai) to fetch clean page content for a
 * company domain. Fully implemented but gated on JINA_API_KEY; returns a clear
 * "no_api_key" result until configured (never silent mock data — spec §24/§37).
 */
export class JinaResearchProvider extends ResearchProvider {
  constructor() { super('jina'); }
  get available() { return Boolean(config.research.jinaKey); }

  async enrichCompany({ domain }) {
    if (!this.available) return fail(this.name, 'company', 'no_api_key');
    if (!domain) return fail(this.name, 'company', 'no_domain');
    try {
      const md = await httpJson(`https://r.jina.ai/https://${domain}`, {
        headers: { Authorization: `Bearer ${config.research.jinaKey}`, Accept: 'text/plain' },
        raw: true,
      }).then((r) => r.text());
      return ok(this.name, 'company', { markdown: md.slice(0, 8000) });
    } catch (e) { return fail(this.name, 'company', e.message); }
  }
}
