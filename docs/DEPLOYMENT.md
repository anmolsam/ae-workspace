# Deployment (Railway)

ae-workspace deploys to Railway as three pieces:

1. the **API service** (`apps/api`, Express + Node ESM),
2. the **web app** (`apps/web`, static Vite build), and
3. the **reconciliation cron** (a Railway scheduled job hitting the API every 30
   minutes).

Supabase (Postgres + Google SSO + RLS) is provisioned separately and is a
prerequisite. Apply `supabase/migrations/0001_init.sql` before the first deploy
(see the README's Database setup section).

## Prerequisites

- A Supabase project with the migration applied and Google enabled as an auth
  provider (with the `calendar.readonly` scope if Briefy calendar reads are
  needed).
- A HubSpot private-app token with `crm.objects.deals.read`,
  `crm.schemas.deals.read`, `crm.objects.owners.read`, and engagements read.
- A reachable ROMA instance and its unlock password (`ROMA_PASSWORD`), or ROMA
  running with no password.
- A Railway account and the Railway CLI (optional but convenient):
  `npm i -g @railway/cli`.

## 1. Deploy the API service

The API is configured by `apps/api/railway.toml`:

- Build: Nixpacks (auto-detects Node 20+ and the npm workspaces install). Switch
  the builder to `dockerfile` if you later add `apps/api/Dockerfile`.
- Start command: `node src/server.js`.
- Health check path: `/api/health`.
- Restart policy: on failure, up to 10 retries.

Steps:

1. Create a new Railway service from this repository.
2. Set the service **root directory** to `apps/api` so Railway picks up
   `apps/api/railway.toml`. (Node 20+ workspaces resolve `@ae-workspace/shared`
   during install.)
3. Add the environment variables below.
4. Deploy. Railway builds with Nixpacks and runs `node src/server.js`. The health
   check confirms the service is live at `/api/health`.
5. Note the public API URL (for example `https://ae-workspace-api.up.railway.app`).

### Required API environment variables

| Variable                    | Required | Notes                                                       |
| --------------------------- | -------- | ----------------------------------------------------------- |
| `NODE_ENV`                  | Yes      | Set to `production` (config fails fast on missing required vars). |
| `PORT`                      | No       | Railway injects a port; the app reads `PORT` (default 4000). |
| `WEB_ORIGIN`                | Yes      | The deployed web app origin(s), comma-separated (CORS).     |
| `SUPABASE_URL`              | Yes      | Supabase project URL.                                       |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Service-role key. Server-only; never expose to the browser. |
| `ALLOWED_EMAIL_DOMAIN`      | Yes      | e.g. `attentive.ai`. Backend re-checks SSO domain.          |
| `HUBSPOT_TOKEN`             | Yes      | HubSpot private-app token.                                  |
| `HUBSPOT_PORTAL_ID`         | Yes      | For deal deep links.                                        |
| `ROMA_BASE_URL`             | Yes      | Reachable ROMA URL from Railway.                            |
| `ROMA_PASSWORD`             | Cond.    | Required if ROMA is password-gated; blank otherwise.        |
| `CRON_SECRET`               | Yes      | Shared secret for `POST /internal/cron/reconcile`.          |
| `GOOGLE_CALENDAR_ENABLED`   | No       | `true` to enable Briefy calendar reads.                     |
| `EXA_API_KEY`               | No       | Enables the Exa research provider.                          |
| `ZOOMINFO_CLIENT_ID`        | No       | Enables ZoomInfo (with the secret).                         |
| `ZOOMINFO_CLIENT_SECRET`    | No       | Enables ZoomInfo (with the id).                             |
| `JINA_API_KEY`              | No       | Enables the Jina provider.                                  |
| `SEAMLESS_API_KEY`          | No       | Enables the Seamless provider (stub until endpoint wired).  |
| `FIRECRAWL_API_KEY`         | No       | Reserved for future scraping.                               |
| `ENABLE_INPROCESS_CRON`     | No       | Leave unset in production. See the cron section below.      |

Do not set `ENABLE_INPROCESS_CRON=true` on the production API service when you use
the Railway scheduled cron, or reconciliation runs twice. Use exactly one
trigger.

## 2. Deploy the web app

The web app is a static Vite build.

1. Create a second Railway service (or a Railway static site) from the same
   repository with the root directory `apps/web`.
2. Build command: `npm run build` (runs `tsc -b && vite build`). Output: `dist/`.
3. Serve `dist/` as a static site.
4. Set the build-time environment variables (Vite inlines `VITE_*` at build time,
   so they must be present during the build):

| Variable                | Required | Notes                                              |
| ----------------------- | -------- | -------------------------------------------------- |
| `VITE_SUPABASE_URL`     | Yes      | Supabase URL for the browser client.               |
| `VITE_SUPABASE_ANON_KEY`| Yes      | Supabase anon key for the browser client.          |
| `VITE_TASKEE_REFETCH_MS`| No       | Client refetch interval hint (ms). Default 120000. |

Point the web app at the deployed API base URL, and make sure the web origin is
listed in the API's `WEB_ORIGIN`.

## 3. Configure the reconciliation cron

The canonical reconciliation trigger is a Railway **scheduled job** that calls the
protected endpoint every 30 minutes.

- Schedule (cron expression): `*/30 * * * *`
- Action: `POST /internal/cron/reconcile` on the API, with the `x-cron-secret`
  header set to the same value as the API's `CRON_SECRET`.

If you run it as a Railway cron service that executes a command, use:

```bash
curl -fsS -X POST "$API_BASE_URL/internal/cron/reconcile" \
  -H "x-cron-secret: $CRON_SECRET"
```

Provide `API_BASE_URL` and `CRON_SECRET` to that cron service as environment
variables. The endpoint responds `401` if the header is missing or does not match
`CRON_SECRET`, and returns a JSON report on success:

```json
{
  "ok": true,
  "started": "2026-07-16T10:00:00.000Z",
  "finished": "2026-07-16T10:00:04.000Z",
  "owners": 3,
  "results": [ { "ownerId": "12345", "tasks": 6, "ok": true } ]
}
```

### Alternative: in-process scheduler (dev / single instance only)

Instead of the platform cron, you can set `ENABLE_INPROCESS_CRON=true` on the API
service to run the same reconciliation loop in-process every 30 minutes. This is
intended for local development or a single-instance deploy. Never combine it with
the Railway scheduled cron, and never enable it on more than one instance, or
reconciliation will run multiple times.

## 4. Post-deploy verification

1. Health check:

   ```bash
   curl "$API_BASE_URL/api/health"
   ```

   Confirm `ok: true`, the expected `env`, the ROMA URL, and the active research
   providers.

2. Auth-scoped smoke test with a real Supabase access token:

   ```bash
   curl "$API_BASE_URL/api/v1/me" -H "Authorization: Bearer <supabase-access-token>"
   ```

3. Manually trigger a reconcile to confirm the cron path works end to end:

   ```bash
   curl -X POST "$API_BASE_URL/internal/cron/reconcile" -H "x-cron-secret: $CRON_SECRET"
   ```

4. Open the web app, sign in with a company Google account, and confirm Taskee
   lists follow-ups scoped to that AE.
