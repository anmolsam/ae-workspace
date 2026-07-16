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

  research: {
    exaKey: process.env.EXA_API_KEY || '',
    firecrawlKey: process.env.FIRECRAWL_API_KEY || '',
    zoomInfoId: process.env.ZOOMINFO_CLIENT_ID || '',
    zoomInfoSecret: process.env.ZOOMINFO_CLIENT_SECRET || '',
    jinaKey: process.env.JINA_API_KEY || '',
    seamlessKey: process.env.SEAMLESS_API_KEY || '',
  },

  calendarEnabled: process.env.GOOGLE_CALENDAR_ENABLED === 'true',
};
