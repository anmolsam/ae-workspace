/**
 * Test setup helpers. Imported FIRST by any test file that pulls in apps/api
 * source, so that config/db clients that read env at import time get safe
 * dummy values. NODE_ENV is left unset (development) so config never throws.
 */
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.HUBSPOT_TOKEN ||= 'test-hubspot-token';
process.env.HUBSPOT_PORTAL_ID ||= '111111';

const DAY = 24 * 60 * 60 * 1000;

/** Fixed reference "now" so bucket/overdue math is deterministic. */
export const NOW = new Date('2026-07-16T12:00:00.000Z');

export const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();
export const hours = (h) => h * 60 * 60 * 1000;
export const days = (d) => d * DAY;
