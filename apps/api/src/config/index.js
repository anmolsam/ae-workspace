import 'dotenv/config';

/** Fail fast on missing required config in production; warn in dev. */
function required(name) {
  const v = process.env[name];
  if (!v && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v || '';
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  webOrigin: (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),

  supabase: {
    url: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },
  allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN || '',

  hubspot: {
    token: required('HUBSPOT_TOKEN'),
    portalId: process.env.HUBSPOT_PORTAL_ID || '',
    base: 'https://api.hubapi.com',
  },

  roma: {
    baseUrl: process.env.ROMA_BASE_URL || 'http://localhost:8080',
    password: process.env.ROMA_PASSWORD || '',
  },

  cronSecret: process.env.CRON_SECRET || '',

  // TEMPORARY dev-auth bypass (OFF by default). When true, the API skips Google
  // SSO token verification and acts as the AE mapped to DEV_AUTH_EMAIL. Exists
  // only so the app can be demoed before the Google OAuth client is created.
  // MUST be turned off once real SSO is enabled.
  devAuthBypass: process.env.DEV_AUTH_BYPASS === 'true',
  devAuthEmail: (process.env.DEV_AUTH_EMAIL || '').toLowerCase(),

  research: {
    exaKey: process.env.EXA_API_KEY || '',
    firecrawlKey: process.env.FIRECRAWL_API_KEY || '',
    zoomInfoId: process.env.ZOOMINFO_CLIENT_ID || '',
    zoomInfoSecret: process.env.ZOOMINFO_CLIENT_SECRET || '',
    jinaKey: process.env.JINA_API_KEY || '',
    seamlessKey: process.env.SEAMLESS_API_KEY || '',
  },

  calendarEnabled: process.env.GOOGLE_CALENDAR_ENABLED === 'true',

  // Briefy source = the briefy-final Airtable base (shashank's engine writes
  // briefs there). When enabled, the Briefy tab reads real briefs from Airtable
  // instead of Google Calendar. Scoped per-AE by the Airtable "Deal Owner".
  briefyAirtable: {
    enabled: process.env.BRIEFY_SOURCE === 'airtable',
    apiKey: process.env.BRIEFY_AIRTABLE_API_KEY || '',
    baseId: process.env.BRIEFY_AIRTABLE_BASE_ID || '',
    table: process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy',
  },
};
