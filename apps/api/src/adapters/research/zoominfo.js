import { ResearchProvider, ok, fail } from './base.js';
import { config } from '../../config/index.js';
import { httpJson } from '../../lib/http.js';

/**
 * ZoomInfoProvider — reuses the OAuth2 + enrich pattern from
 * icp-match/src/zoominfo.js (token cached ~55 min).
 */
export class ZoomInfoProvider extends ResearchProvider {
  constructor() { super('zoominfo'); this._token = null; this._tokenAt = 0; }
  get available() { return Boolean(config.research.zoomInfoId && config.research.zoomInfoSecret); }

  async #token() {
    if (this._token && Date.now() - this._tokenAt < 55 * 60 * 1000) return this._token;
    const creds = Buffer.from(`${config.research.zoomInfoId}:${config.research.zoomInfoSecret}`).toString('base64');
    const res = await httpJson('https://okta-login.zoominfo.com/oauth2/default/v1/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=api%3Adata%3Acompany',
    });
    this._token = res.access_token; this._tokenAt = Date.now();
    return this._token;
  }

  async enrichCompany({ domain }) {
    if (!this.available) return fail(this.name, 'company', 'no_credentials');
    if (!domain) return fail(this.name, 'company', 'no_domain');
    try {
      const token = await this.#token();
      const res = await httpJson('https://api.zoominfo.com/gtm/data/v1/companies/enrich', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' },
        body: {
          data: {
            type: 'CompanyEnrich',
            attributes: {
              outputFields: ['name', 'website', 'primaryIndustry', 'employeeCount', 'revenueRange', 'country', 'state'],
              matchCompanyInput: [{ companyWebsite: domain }],
            },
          },
        },
      });
      return ok(this.name, 'company', { company: res.data?.[0]?.attributes || null });
    } catch (e) { return fail(this.name, 'company', e.message); }
  }
}
