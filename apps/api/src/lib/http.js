/** Small fetch wrapper with timeout + JSON handling. Node 20+ has global fetch. */
export async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, raw } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'manual',
    });
    if (raw) return res;
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${method} ${url}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

/** Simple in-memory TTL cache — mirrors ROMA's own short-TTL approach so we
 *  don't hammer HubSpot/ROMA. Not a persistent store. */
export class TtlCache {
  constructor(ttlMs) { this.ttlMs = ttlMs; this.map = new Map(); }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) { this.map.delete(key); return undefined; }
    return e.value;
  }
  set(key, value) { this.map.set(key, { value, at: Date.now() }); return value; }
  async wrap(key, fn) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    return this.set(key, await fn());
  }
}
