import { config } from '../config/index.js';
import { httpJson, TtlCache } from '../lib/http.js';

/**
 * RomaAdapter — the ONLY module that talks to ROMA (PrashantAttentive/Project-ROMA,
 * FastAPI, run locally on :8080). We NEVER recompute Fight Score or funnel; we
 * fetch ROMA's already-computed numbers and scope them to one AE by owner id.
 *
 * ROMA gates its data endpoints behind a `roma_session` cookie obtained from
 * POST /unlock. We authenticate server-to-server with ROMA_PASSWORD and reuse
 * the cookie until it expires.
 */
const cache = new TtlCache(30 * 60 * 1000); // match ROMA's 30-min TTL
let sessionCookie = null;
let cookieAt = 0;
const COOKIE_TTL = 11 * 60 * 60 * 1000; // ROMA sets a 12h cookie; refresh at 11h

async function unlock() {
  if (sessionCookie && Date.now() - cookieAt < COOKIE_TTL) return sessionCookie;
  if (!config.roma.password) {
    // ROMA with no password set leaves the gate open; no cookie needed.
    sessionCookie = '';
    cookieAt = Date.now();
    return sessionCookie;
  }
  const res = await httpJson(`${config.roma.baseUrl}/unlock`, {
    method: 'POST', body: { password: config.roma.password }, raw: true,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = /roma_session=([^;]+)/.exec(setCookie);
  if (!m) throw new Error('ROMA unlock failed — no roma_session cookie returned');
  sessionCookie = `roma_session=${m[1]}`;
  cookieAt = Date.now();
  return sessionCookie;
}

async function romaGet(path) {
  const cookie = await unlock();
  // A cold ROMA read triggers a full HubSpot sync that can exceed the default
  // 20s — give it room so the card doesn't error on first load.
  return httpJson(`${config.roma.baseUrl}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 60000,
  });
}

/** Raw ROMA fight-score payload (all AEs). Cached. */
export function fetchFightScore() {
  return cache.wrap('fight', () => romaGet('/fight-score/data'));
}

/** Raw ROMA AE-CR (funnel) payload (all AEs, all sources). Cached. */
export function fetchAeCr() {
  return cache.wrap('aecr', () => romaGet('/ae-cr/data'));
}

/** Force a fresh pull (used by an explicit refresh action, sparingly). */
export function invalidate() {
  cache.map.clear();
}
