# ae-workspace

A personal, per-AE workspace web app. Each Account Executive signs in with their
company Google account and sees only their own work, organized into three
sections in a fixed navigation order:

```
Taskee  |  Briefy  |  Revy
```

- **Taskee** - the AE's live follow-up queue, driven entirely by HubSpot AI-draft fields.
- **Briefy** - pre-call briefs for the AE's upcoming Google Calendar meetings.
- **Revy** - reserved. Route, nav entry, and a "Revy is coming next" empty state only.

## Table of contents

- [Core principle: never rebuild upstream logic](#core-principle-never-rebuild-upstream-logic)
- [Taskee](#taskee)
  - [How AI-draft fields create actionable follow-ups](#how-ai-draft-fields-create-actionable-follow-ups)
  - [HubSpot field mappings](#hubspot-field-mappings)
  - [The 24-hour overdue rule](#the-24-hour-overdue-rule)
  - [Manual checkbox behavior and the follow-up state model](#manual-checkbox-behavior-and-the-follow-up-state-model)
  - [Automatic HubSpot verification](#automatic-hubspot-verification)
  - [The 30-minute reconciliation cron](#the-30-minute-reconciliation-cron)
- [Revy funnel and Fight Score (from ROMA)](#revy-funnel-and-fight-score-from-roma)
- [Briefy](#briefy)
  - [Research provider architecture](#research-provider-architecture)
- [Authentication, identity, and isolation](#authentication-identity-and-isolation)
- [Repository structure](#repository-structure)
- [Tech stack](#tech-stack)
- [Environment variables](#environment-variables)
- [Local development](#local-development)
- [Database setup](#database-setup)
- [Integrations](#integrations)
- [API documentation](#api-documentation)
- [Testing](#testing)
- [Deployment](#deployment)
- [Scheduled jobs](#scheduled-jobs)
- [Future Chrome extension architecture](#future-chrome-extension-architecture)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)

## Core principle: never rebuild upstream logic

This app reads from two authoritative upstream systems and never re-derives what
they already compute.

- **HubSpot is the source of truth for follow-ups and activity.** The AI-draft
  cadence fields, the per-follow-up completion status, and the raw engagement
  activity all live in HubSpot. The upstream cadence/draft engine that writes
  those fields is `anmolsam/beam-fight-score-agent`. This workspace only reads
  those fields; it never writes cadence fields.
- **ROMA is the source of truth for the Fight Score and the AE funnel.** ROMA
  (`PrashantAttentive/Project-ROMA`) is a FastAPI app run locally on port 8080.
  This workspace fetches ROMA's already-computed numbers and scopes them to one
  AE; it never recomputes a score or a funnel stage.

The only state this app owns is app-local task state in Postgres: the AE's
manual-checkbox intent and the reconciliation state layered on top of the
upstream truth. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full
source-of-truth hierarchy and the state machine.

## Taskee

### How AI-draft fields create actionable follow-ups

A follow-up becomes actionable purely because its HubSpot AI-draft field is
populated. There is no separate "create task" step and no local cadence logic. A
HubSpot deal in the Beam AI pipeline has three follow-up tracks, each with a set
of numbered slots:

| Track | Prefix | Label              | Slots      |
| ----- | ------ | ------------------ | ---------- |
| DS    | `ds`   | Demo Scheduled     | 0          |
| DO    | `do`   | Discovery Ongoing  | 1, 2, 3, 4 |
| OI    | `oi`   | Opportunity Identified | 1, 2, 3, 4 |

For each `(track, slot)` there are three HubSpot properties: the draft body, a
generated-at timestamp, and an upstream status. When the draft body is populated
and the upstream status is exactly `none`, that slot is an actionable follow-up
and shows up in Taskee. When the upstream draft is later cleared, the follow-up
no longer exists and the app-local task is deleted.

### HubSpot field mappings

The centralized, single source of truth for every HubSpot property string is
`packages/shared/src/hubspot-fields.js`. Nothing in `apps/api` or `apps/web`
hardcodes a HubSpot property name; everything imports from there.

Pipeline: `676188492` (Beam AI Deals).

Field-name shape per track prefix and slot number `n`:

| Purpose      | Builder                     | Pattern                         |
| ------------ | --------------------------- | ------------------------------- |
| Draft body   | `draftField(prefix, n)`     | `${prefix}_followup_email_${n}` |
| Generated at | `generatedAtField(prefix, n)` | `${prefix}_followup_${n}_generated_at` |
| Status       | `statusField(prefix, n)`    | `${prefix}_followup_${n}_status` |

Resolved to concrete field names:

| Track | Slot | Draft field          | Generated-at field                | Status field                  |
| ----- | ---- | -------------------- | --------------------------------- | ----------------------------- |
| DS    | 0    | `ds_followup_email_0` | `ds_followup_0_generated_at`     | `ds_followup_0_status`        |
| DO    | 1    | `do_followup_email_1` | `do_followup_1_generated_at`     | `do_followup_1_status`        |
| DO    | 2    | `do_followup_email_2` | `do_followup_2_generated_at`     | `do_followup_2_status`        |
| DO    | 3    | `do_followup_email_3` | `do_followup_3_generated_at`     | `do_followup_3_status`        |
| DO    | 4    | `do_followup_email_4` | `do_followup_4_generated_at`     | `do_followup_4_status`        |
| OI    | 1    | `oi_followup_email_1` | `oi_followup_1_generated_at`     | `oi_followup_1_status`        |
| OI    | 2    | `oi_followup_email_2` | `oi_followup_2_generated_at`     | `oi_followup_2_status`        |
| OI    | 3    | `oi_followup_email_3` | `oi_followup_3_generated_at`     | `oi_followup_3_status`        |
| OI    | 4    | `oi_followup_email_4` | `oi_followup_4_generated_at`     | `oi_followup_4_status`        |

Upstream status enum (`FOLLOWUP_STATUS`), written by the cadence engine's
grace-engine and treated as the authoritative completion signal:

| Status value       | Meaning                                                       | Effect in Taskee            |
| ------------------ | ------------------------------------------------------------- | --------------------------- |
| `none`             | Not yet done; actionable (may be overdue)                     | Actionable task             |
| `timely`           | Genuinely completed on time                                   | Verified done               |
| `delayed`          | Genuinely completed, late                                     | Verified done               |
| `skipped_negative` | Prospect said no                                              | Disregarded (hidden)        |
| `paused_ooo`       | Out of office                                                 | Disregarded (hidden)        |
| `paused_meeting`   | Future meeting scheduled                                      | Disregarded (hidden)        |
| `''` / null        | Not yet evaluated                                             | Not actionable until set    |

Other deal properties read (from `DEAL_PROPS`): `dealname`, `dealstage`,
`pipeline`, `amount`, `hubspot_owner_id`, `owner_team`,
`meeting_date___time___sales`, `follow_up_final_status`,
`last_followup_sent_at`, `proshort_detected_at`. Stage-entry timestamps use the
`hs_v2_date_entered_<stageId>` convention.

### The 24-hour overdue rule

Each follow-up's `overdueAt` is computed as `draftGeneratedAt + 24 hours`. A
follow-up whose `overdueAt` is in the past is overdue. Overdue follow-ups are
always pinned to the top of the Taskee list and rendered in a restrained red;
the sort inside `buildTaskeeView` places overdue first (most-overdue first),
then everything else by due time ascending.

Items are grouped into buckets for display:

```
overdue  ->  today  ->  tomorrow  ->  upcoming (next few days)  ->  week (rest)
```

### Manual checkbox behavior and the follow-up state model

A follow-up is not a boolean "done / not done". It is a state, defined in
`packages/shared/src/follow-up-state.js` (`TASK_STATE`):

| State                                        | Meaning                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `ACTIVE`                                     | Draft present, status `none`, not manually checked, within 24h          |
| `OVERDUE`                                    | Draft present, status `none`, past `draftGeneratedAt + 24h`             |
| `MANUALLY_CHECKED_PENDING_VERIFICATION`      | AE ticked the box; UI crosses it out instantly, but it is NOT verified  |
| `COMPLETED_VERIFIED`                         | HubSpot confirmed qualifying activity (status `timely`/`delayed`)       |
| `REOPENED_AFTER_FAILED_VERIFICATION`         | Was manually checked, reconciliation found no activity, respawned       |
| `DISREGARDED`                                | Upstream marked the slot disregarded (`skipped_negative`/`paused_*`)    |

The manual checkbox is instant UI feedback but is NOT authoritative. Ticking the
box moves the task to `MANUALLY_CHECKED_PENDING_VERIFICATION` and crosses it out
immediately, but HubSpot activity is what actually decides whether a follow-up is
done.

Core invariant: a false manual check respawns the task. If the AE checks a
follow-up but HubSpot shows no qualifying activity, reconciliation returns the
task to the list at its correct urgency position (top and red if overdue). A
manual check can never permanently dismiss a genuine follow-up.

### Automatic HubSpot verification

Verified completion is two-tier and reuses the upstream definition rather than
reinventing it (`FollowUpCompletionVerifier`):

1. **Primary signal: the upstream `*_status` field.** Already reconciled by
   ROMA's grace-engine. `timely`/`delayed` means done; `skipped_*`/`paused_*`
   means disregard; `none` means still open.
2. **Secondary freshness check: HubSpot engagement activity.** If the status is
   still `none` but the AE claims done, the verifier reads HubSpot engagement
   activity that occurred after `draftGeneratedAt`, to catch activity the
   upstream tick has not processed yet. Qualifying activity mirrors the upstream
   definition:
   - an outbound email that is not a meeting-confirmation, OR
   - a call with duration `>= 60s`, OR
   - an SMS
   - occurring after the draft's generated-at timestamp.

A failed or errored activity read never marks a task complete.

### The 30-minute reconciliation cron

`FollowUpReconciliationService` reconciles every tracked AE's open tasks against
HubSpot on a schedule. It is triggered by a Railway scheduled job that sends
`POST /internal/cron/reconcile` with the `x-cron-secret` header every 30 minutes.
For local dev or single-instance deploys, an optional in-process scheduler can
run the same job every 30 minutes when `ENABLE_INPROCESS_CRON=true`.

Reconciliation is idempotent. It re-derives each task's state from
`(upstream status + activity + manual intent)` using a pure `reconcile()` reducer
keyed on the natural key `(owner_id, deal_id, track, slot)`, so running it twice
produces the same result and never double-creates rows. The cron is where the
per-deal HubSpot engagement reads happen; page-load refreshes stay status-only to
respect API limits. Taskee also does a lightweight refresh on page load, on
window focus, and on an interval.

HubSpot deal links: every follow-up card carries a direct
`Open Deal in HubSpot` deep link built from the portal id and deal id
(`https://app.hubspot.com/contacts/<portalId>/deal/<dealId>`).

## Revy funnel and Fight Score (from ROMA)

Revy currently ships as a route, a nav entry, and a "Revy is coming next" empty
state. The ROMA-backed funnel and Fight Score endpoints are already implemented
in the API.

**Funnel reuse (`RomaFunnelService`).** ROMA returns per-owner arrays split by
source (Marketing, SDR Inbound, SDR Outbound) per month. The service sums those
counts and computes the same conversion ratios ROMA's own UI shows. It never
re-derives stage membership. Stages surfaced:

```
Total Demos  ->  DCC  ->  QDD  ->  Pilots  ->  Closed Won
```

with a conversion percentage on each stage (DCC as a % of Total Demos; QDD,
Pilots, and Closed Won each as a % of DCC).

**Fight Score reuse (`RomaFightScoreService`).** The service surfaces ROMA's
Fight Score for one AE exactly as ROMA computed it (score, deals, known, done,
lt80), with no local calculation.

**Known limitation:** ROMA's Fight Score is a pooled all-time number, not a
weekly time-series. ROMA does not expose weekly buckets. The app surfaces the
authoritative all-time score as-is and does not fabricate a weekly series. If a
weekly view is wanted later, ROMA must expose it; the app would not recompute it.

Both adapters authenticate to ROMA by `POST /unlock` with `ROMA_PASSWORD` to
obtain a `roma_session` cookie, then read `GET /fight-score/data` and
`GET /ae-cr/data`, filtering to the AE's owner id.

## Briefy

Briefy lists the AE's upcoming Google Calendar meetings and generates an
expandable pre-call brief for each one.

- Calendar events are read with the `calendar.readonly` scope using the same
  Google OAuth token minted by Supabase SSO. The web app forwards that provider
  token to the API as the `x-google-token` header; the backend never stores it
  long-term.
- If the calendar is disabled or no token is present, the API returns
  `{ calendarConnected: false, meetings: [] }` and the UI shows an honest
  "connect calendar / no meetings" state. No mock data is ever presented as real.

Brief lifecycle (`BriefGenerationService`): `queued -> processing -> completed
-> failed`. Briefs use a dynamic, expandable schema (not finalized): sections are
stored as ordered `brief_sections` rows (`key`, `title`, `order`, `kind`,
`content`) so sections can be added, removed, or reordered without a migration.
The renderer must not assume a fixed section schema.

Entities: `Meeting`, `PreCallBrief`, `BriefSection`, `BriefGenerationJob`
(status), `ResearchSource`.

### Research provider architecture

Briefs are assembled from a research fan-out. Every source implements the same
`ResearchProvider` interface (`apps/api/src/adapters/research/base.js`): one file
per source, registered in `apps/api/src/adapters/research/index.js`. Each
provider advertises `available` (whether it has credentials) and returns a
uniform result shape; a provider without credentials returns an explicit
`no_api_key` / `no_credentials` result rather than silent mock data.

| Provider  | Source key | Reused or net-new                                            | Status                                                                 |
| --------- | ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Exa       | `exa`      | Reused (pattern from beam-qualification-agent prospect-research) | Implemented; gated on `EXA_API_KEY`                                    |
| ZoomInfo  | `zoominfo` | Reused (OAuth2 + enrich pattern from icp-match)             | Implemented; gated on `ZOOMINFO_CLIENT_ID` + `ZOOMINFO_CLIENT_SECRET`  |
| Jina      | `jina`     | Net-new                                                     | Implemented (Jina Reader); gated on `JINA_API_KEY`                     |
| Seamless  | `seamless` | Net-new                                                     | Clearly-marked stub; returns `not_implemented` until the account endpoint is wired |

`FIRECRAWL_API_KEY` is present in the environment as a reused key for future
scraping needs.

## Authentication, identity, and isolation

- **Google SSO only, via Supabase.** Users sign in with a company Google account.
  Supabase verifies the Google identity and issues an access token. The browser
  only ever sees the Supabase anon key and URL.
- **Domain restriction.** SSO is restricted to the company domain
  (`ALLOWED_EMAIL_DOMAIN`, default `attentive.ai`), and the backend re-checks the
  domain on every request.
- **Email to owner id.** The backend verifies the token, reads the
  Google-verified email, maps it to a HubSpot owner via `getOwnerByEmail`, and
  caches the mapping (email, owner id, name, role) in the `ae_identities` table.
  ROMA and HubSpot both key on owner id.
- **Backend-enforced per-AE isolation.** Every `/api/v1/me/*` route scopes data
  by `req.ae.ownerId`, which is derived only from the verified token. No endpoint
  accepts another AE's email or id, so a regular AE cannot fetch another AE's
  data by tampering with a request.
- **Roles.** Roles (`AE`, `TEAM_LEAD`, `REVOPS_ADMIN`, `SALES_LEADERSHIP`) are
  architected via `requireRole`, but only `AE` is active today.
- **RLS as defense-in-depth.** Row Level Security is enabled on all tables and
  denies all anon/authenticated direct access. The browser never queries these
  tables directly; all access flows through the API using the service-role key.

## Repository structure

```
ae-workspace/
├── package.json                 # npm workspaces root (Node >=20, ESM)
├── .env.example                 # every env var, documented
├── apps/
│   ├── api/                     # Express + Node ESM API (@ae-workspace/api)
│   │   ├── package.json
│   │   ├── railway.toml         # Railway service config
│   │   └── src/
│   │       ├── server.js        # app bootstrap, health, routers, error handler
│   │       ├── config/index.js  # env-backed config, fail-fast in production
│   │       ├── auth/
│   │       │   ├── google-auth.js   # GoogleAuthService: token -> AE identity
│   │       │   └── middleware.js     # requireAuth (isolation seam), requireRole
│   │       ├── adapters/
│   │       │   ├── hubspot.js        # HubSpotAdapter: deals, drafts, activity
│   │       │   ├── roma.js           # RomaAdapter: /unlock, fight-score, ae-cr
│   │       │   ├── calendar.js       # CalendarAdapter: Google Calendar events
│   │       │   └── research/
│   │       │       ├── base.js       # ResearchProvider interface + helpers
│   │       │       ├── index.js      # provider registry + fan-out
│   │       │       ├── exa.js        # reused
│   │       │       ├── zoominfo.js   # reused
│   │       │       ├── jina.js       # net-new
│   │       │       └── seamless.js   # net-new stub
│   │       ├── services/
│   │       │   ├── followup-query.js     # FollowUpQueryService + Taskee view
│   │       │   ├── completion-verifier.js # FollowUpCompletionVerifier
│   │       │   ├── reconciliation.js      # FollowUpReconciliationService
│   │       │   ├── roma-fight-score.js    # RomaFightScoreService
│   │       │   ├── roma-funnel.js         # RomaFunnelService
│   │       │   └── brief-generation.js    # BriefGenerationService
│   │       ├── routes/
│   │       │   ├── me.js          # /api/v1/me/* (auth-scoped)
│   │       │   └── internal.js    # /internal/cron/reconcile (x-cron-secret)
│   │       ├── jobs/
│   │       │   └── reconcile-cron.js  # optional in-process 30-min scheduler
│   │       ├── db/
│   │       │   ├── supabase.js    # service-role client + token verify
│   │       │   └── tasks-repo.js  # follow_up_tasks repository
│   │       └── lib/
│   │           └── http.js        # httpJson wrapper + TtlCache
│   └── web/                     # React + Vite + TypeScript + Tailwind (@ae-workspace/web)
├── packages/
│   └── shared/                  # @ae-workspace/shared (framework-agnostic)
│       └── src/
│           ├── hubspot-fields.js    # centralized HubSpot field config
│           ├── follow-up-state.js   # TASK_STATE + pure reconcile() reducer
│           ├── types.js             # DTO typedefs (FollowUp, Funnel, ...)
│           └── index.js
├── supabase/
│   └── migrations/
│       └── 0001_init.sql        # tables + RLS
└── docs/
    ├── ARCHITECTURE.md
    └── DEPLOYMENT.md
```

## Tech stack

- **Monorepo:** npm workspaces (`packages/*`, `apps/*`), Node.js `>=20`, ESM
  throughout (`import`/`export`, never CommonJS).
- **API (`apps/api`):** Express 4 on Node ESM.
- **Web (`apps/web`):** React 18 + Vite 5 + TypeScript 5 + Tailwind CSS 3, React
  Router 6.
- **Shared (`packages/shared`):** framework-agnostic HubSpot field config, the
  follow-up state model, and DTO typedefs, consumable by both the API and a
  future Chrome extension.
- **Database and auth:** Supabase (Postgres + Google SSO + RLS).
- **Deploy:** Railway.
- **Scheduled jobs:** a Railway scheduled job hitting the protected reconcile
  endpoint every 30 minutes.

## Environment variables

Copy `.env.example` to `.env` (never commit it). The API reads all of these; the
web app reads only the `VITE_*` variables at build time.

| Variable                     | Used by | Required          | Description                                                              |
| ---------------------------- | ------- | ----------------- | ------------------------------------------------------------------------ |
| `PORT`                       | API     | No (default 4000) | API listen port.                                                         |
| `NODE_ENV`                   | API     | No                | `development` or `production`. Production fails fast on missing required vars. |
| `WEB_ORIGIN`                 | API     | No                | Comma-separated CORS origins allowed to call the API.                    |
| `SUPABASE_URL`               | API     | Yes               | Supabase project URL.                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`  | API     | Yes               | Service-role key. Server-only; never ship to the browser.               |
| `VITE_SUPABASE_URL`          | Web     | Yes               | Supabase URL for the browser client.                                     |
| `VITE_SUPABASE_ANON_KEY`     | Web     | Yes               | Supabase anon key for the browser client.                                |
| `ALLOWED_EMAIL_DOMAIN`       | API     | No                | Restrict SSO to a company domain (backend re-checks). Default in file: `attentive.ai`. |
| `HUBSPOT_TOKEN`              | API     | Yes               | HubSpot private-app token (deals read, schemas read, owners read, engagements read). |
| `HUBSPOT_PORTAL_ID`          | API     | No                | Portal id, used only to build deal deep links.                           |
| `ROMA_BASE_URL`              | API     | No (default 8080) | ROMA base URL. Local default `http://localhost:8080`.                    |
| `ROMA_PASSWORD`              | API     | No                | ROMA unlock password. If ROMA has no password, leave blank.              |
| `CRON_SECRET`                | API     | Yes (prod)        | Shared secret required on `POST /internal/cron/reconcile`.               |
| `VITE_TASKEE_REFETCH_MS`     | Web     | No                | Client refetch interval hint (ms). Default in file: `120000`.            |
| `EXA_API_KEY`                | API     | No                | Reused. Enables the Exa research provider.                               |
| `FIRECRAWL_API_KEY`          | API     | No                | Reused. Reserved for future scraping.                                    |
| `ZOOMINFO_CLIENT_ID`         | API     | No                | Reused. Enables the ZoomInfo provider (with the secret).                 |
| `ZOOMINFO_CLIENT_SECRET`     | API     | No                | Reused. Enables the ZoomInfo provider (with the id).                     |
| `JINA_API_KEY`               | API     | No                | Net-new. Enables the Jina provider.                                      |
| `SEAMLESS_API_KEY`           | API     | No                | Net-new. Enables the Seamless provider (stub until endpoint wired).      |
| `GOOGLE_CALENDAR_ENABLED`    | API     | No                | `true` to enable Briefy calendar reads. Default `false`.                 |
| `ENABLE_INPROCESS_CRON`      | API     | No                | `true` to run the in-process 30-min reconciler (dev / single instance).  |

## Local development

Prerequisites: Node.js `>=20`, npm, a Supabase project, a HubSpot private-app
token, and a local ROMA instance.

1. **Install dependencies (workspace root):**

   ```bash
   npm install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   # fill in Supabase, HubSpot, ROMA, and (optionally) research/calendar values
   ```

3. **Run ROMA locally** (in the `Project-ROMA` checkout):

   ```bash
   uvicorn app:app --port 8080
   ```

   Set `ROMA_BASE_URL=http://localhost:8080` and `ROMA_PASSWORD` to match ROMA's
   unlock password (leave blank if ROMA is running without a password).

4. **Set up Supabase and apply the migration** (see
   [Database setup](#database-setup)).

5. **Start the API:**

   ```bash
   npm run dev:api      # node --watch src/server.js on PORT (default 4000)
   ```

   To exercise reconciliation locally without a platform cron, set
   `ENABLE_INPROCESS_CRON=true` in `.env` before starting.

6. **Start the web app:**

   ```bash
   npm run dev:web      # Vite dev server on http://localhost:5173
   ```

   Or run both together from the root: `npm run dev`.

7. **Verify the API is up:**

   ```bash
   curl http://localhost:4000/api/health
   ```

## Database setup

The schema lives in `supabase/migrations/0001_init.sql`. Apply it to your
Supabase project with either the Supabase SQL editor (paste and run) or the
Supabase CLI:

```bash
supabase db push
# or, applying the file directly against your database
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

Tables created:

- `ae_identities` - Google-SSO email to HubSpot owner id mapping, plus AE name
  and role.
- `follow_up_tasks` - app-local follow-up state layered over HubSpot/ROMA, keyed
  on the natural key `(owner_id, deal_id, track, slot)` for idempotent upserts.
- `pre_call_briefs` - one brief per `(owner_id, meeting_id)` with a job status.
- `brief_sections` - dynamic, ordered brief sections (cascade-deleted with the
  brief).
- `research_sources` - which providers contributed to a brief.

RLS is enabled on every table with no permissive policies, so anon and
authenticated clients get zero rows. All access flows through the API using the
service-role key.

Enable Google as an auth provider in the Supabase dashboard (Authentication ->
Providers -> Google) and request the `calendar.readonly` scope if Briefy calendar
reads are needed.

## Integrations

- **HubSpot** (source of truth for follow-ups and activity). A single adapter
  (`HubSpotAdapter`) reads pipeline deals for an owner, the follow-up drafts and
  upstream status, resolves owners by email, and reads engagement activity for
  completion verification. It never writes cadence fields. Required scopes:
  `crm.objects.deals.read`, `crm.schemas.deals.read`, `crm.objects.owners.read`,
  and engagements read.
- **ROMA** (source of truth for Fight Score and funnel). Local FastAPI app on
  port 8080. Authenticated via `POST /unlock` with `ROMA_PASSWORD`; data read
  from `GET /fight-score/data` and `GET /ae-cr/data`.
- **Google Calendar** (Briefy). Read with the `calendar.readonly` scope using the
  Supabase Google-SSO provider token, forwarded from the web app as
  `x-google-token`. Gated behind `GOOGLE_CALENDAR_ENABLED`.
- **Exa** - reused research provider (pattern from beam-qualification-agent).
- **ZoomInfo** - reused research provider (OAuth2 + enrich pattern from
  icp-match).
- **Jina** - net-new research provider (Jina Reader), implemented.
- **Seamless** - net-new research provider, a clearly-marked stub until the
  account endpoint and key are provisioned.

## API documentation

All routes are prefixed as shown. Every `/api/v1/me/*` route requires an
`Authorization: Bearer <supabase-access-token>` header and is scoped to the
authenticated AE's owner id.

### `GET /api/health`

Unauthenticated liveness probe.

```json
{
  "ok": true,
  "env": "production",
  "roma": "http://localhost:8080",
  "calendar": false,
  "researchProviders": ["exa", "zoominfo", "jina"]
}
```

### `GET /api/v1/me`

Identity for the app shell.

```json
{ "email": "ae@attentive.ai", "aeName": "Alex Example", "role": "AE" }
```

### `GET /api/v1/me/follow-ups`

Taskee list plus a summary. Overdue items are sorted to the top.

```json
{
  "followUps": [
    {
      "id": "b2c3...",
      "dealId": "1234567890",
      "companyName": "Acme Construction",
      "dealName": "Acme - Takeoff Pilot",
      "stageLabel": "DISCOVERY ONGOING",
      "track": "DO",
      "slot": 2,
      "followUpLabel": "Follow-Up 2 · Discovery Ongoing",
      "draft": "Hi Sam, following up on...",
      "draftGeneratedAt": "2026-07-15T09:00:00.000Z",
      "overdueAt": "2026-07-16T09:00:00.000Z",
      "state": "OVERDUE",
      "checked": false,
      "overdue": true,
      "verifiedCompletedAt": null,
      "hubspotDealUrl": "https://app.hubspot.com/contacts/PORTAL/deal/1234567890",
      "bucket": "overdue"
    }
  ],
  "summary": { "dueToday": 1, "overdue": 1, "thisWeek": 4 }
}
```

### `POST /api/v1/me/follow-ups/:id/check`

Optimistic manual check (instant UI, not authoritative). Moves the task to
`MANUALLY_CHECKED_PENDING_VERIFICATION`. A task already `COMPLETED_VERIFIED` is
returned unchanged. Returns the saved task row.

```json
{ "id": "b2c3...", "state": "MANUALLY_CHECKED_PENDING_VERIFICATION", "manual_checked_at": "2026-07-16T10:00:00.000Z" }
```

### `POST /api/v1/me/follow-ups/:id/uncheck`

Reverts a manual check, returning the task to `ACTIVE` or `OVERDUE` by the 24h
rule. Cannot un-verify a `COMPLETED_VERIFIED` task. Returns the saved task row.

### `GET /api/v1/me/funnel`

ROMA-derived funnel for the AE. `404` with `{ "error": "no_funnel_data" }` when
ROMA has no data for the AE.

```json
{
  "aeName": "Alex Example",
  "team": "ACE",
  "stages": [
    { "key": "demos", "label": "Total Demos", "count": 40, "pct": 100, "basisLabel": "" },
    { "key": "dcc", "label": "DCC", "count": 28, "pct": 70, "basisLabel": "of Total Demos" },
    { "key": "qdd", "label": "QDD", "count": 14, "pct": 50, "basisLabel": "of DCC" },
    { "key": "pilots", "label": "Pilots", "count": 7, "pct": 25, "basisLabel": "of DCC" },
    { "key": "cw", "label": "Closed Won", "count": 4, "pct": 14.3, "basisLabel": "of DCC" }
  ],
  "generatedAt": "2026-07-16T08:00:00.000Z",
  "source": "roma"
}
```

### `GET /api/v1/me/fight-score`

ROMA-derived Fight Score for the AE (pooled all-time, not weekly). `404` with
`{ "error": "no_fight_score" }` when ROMA has no data for the AE.

```json
{
  "aeName": "Alex Example",
  "team": "ACE",
  "score": 82,
  "deals": 25,
  "known": 20,
  "done": 16,
  "lt80": 3,
  "generatedAt": "2026-07-16T08:00:00.000Z",
  "source": "roma"
}
```

### `GET /api/v1/me/meetings`

Upcoming Google Calendar meetings for the AE, each annotated with a brief status.
Requires the `x-google-token` header (the Supabase Google provider token).

```json
{
  "calendarConnected": true,
  "meetings": [
    {
      "id": "evt_abc123",
      "title": "Acme discovery call",
      "company": "acme",
      "startsAt": "2026-07-16T15:00:00.000Z",
      "attendees": ["ae@attentive.ai", "buyer@acme.com"],
      "timeRemainingMs": 5400000,
      "briefStatus": "needs_generation",
      "briefId": null
    }
  ]
}
```

`briefStatus` is one of `ready`, `generating`, `needs_generation`, `needs_data`,
`completed`. When the calendar is off or no token is present:
`{ "calendarConnected": false, "meetings": [] }`.

### `POST /api/v1/me/meetings/:id/generate-brief`

Kicks off (or refreshes) brief generation for a meeting. Fire-and-forget; returns
`202` immediately. Requires the `x-google-token` header.

```json
{ "status": "queued", "meetingId": "evt_abc123" }
```

### `GET /api/v1/me/briefs/:briefId`

Fetch a brief and its dynamic sections (owner-scoped). `404` when not found.

```json
{
  "id": "brief_1",
  "meetingId": "evt_abc123",
  "jobStatus": "completed",
  "generatedAt": "2026-07-16T14:30:00.000Z",
  "sections": [
    { "key": "overview", "title": "Company Overview", "order": 0, "kind": "keyvalue", "content": { "Industry": "Construction" } },
    { "key": "news", "title": "Relevant News & Web", "order": 1, "kind": "list", "content": [ { "title": "...", "url": "...", "text": "..." } ] }
  ],
  "sources": [ { "provider": "zoominfo", "kind": "company", "fetched_at": "2026-07-16T14:29:00.000Z" } ]
}
```

### `POST /internal/cron/reconcile`

Internal, not user-facing. Requires the `x-cron-secret` header (or `?secret=`
query) matching `CRON_SECRET`. Runs `reconcileAll()` and returns a report.

```bash
curl -X POST https://<api-host>/internal/cron/reconcile \
  -H "x-cron-secret: $CRON_SECRET"
```

```json
{
  "ok": true,
  "started": "2026-07-16T10:00:00.000Z",
  "finished": "2026-07-16T10:00:04.000Z",
  "owners": 3,
  "results": [ { "ownerId": "12345", "tasks": 6, "ok": true } ]
}
```

## Testing

The API workspace is wired for the Node built-in test runner:

```bash
npm test                 # from root: runs apps/api tests (node --test test/)
```

`packages/shared/src/follow-up-state.js` exposes a pure, deterministic
`reconcile()` reducer, which is the natural unit under test for the state machine
(each of reconciliation Cases A through D). Because reconciliation is idempotent
and keyed on the natural key, the reducer can be tested in isolation without
HubSpot or Supabase. When adding tests, place them under `apps/api/test/`.

## Deployment

Deployed on Railway. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full,
step-by-step instructions covering the API service (`apps/api/railway.toml`), the
web build, the required environment variables, and the reconciliation cron.

In short:

- The API service uses `apps/api/railway.toml`: Nixpacks build, start command
  `node src/server.js`, health check `/api/health`, restart on failure.
- The web app is a static Vite build (`npm run build` in `apps/web`) served as a
  static site.
- The reconciliation cron is a Railway scheduled job on `*/30 * * * *` that sends
  `POST /internal/cron/reconcile` with the `x-cron-secret` header.

## Scheduled jobs

- **Reconciliation, every 30 minutes.** The canonical trigger is the Railway
  scheduled job hitting `POST /internal/cron/reconcile` with `x-cron-secret`.
- **Optional in-process scheduler.** For local dev or a single-instance deploy,
  set `ENABLE_INPROCESS_CRON=true` to run the same reconciliation loop in-process
  every 30 minutes. Do not enable it alongside the platform cron in production, or
  reconciliation would run twice.

Both paths call the same idempotent `reconcileAll()`, so double-runs are safe but
wasteful.

## Future Chrome extension architecture

The Chrome extension is not built. No manifests, popups, or content scripts exist
yet, and none should be created now. The architecture is deliberately shaped so
that a future extension can reuse everything without a rewrite:

- All business logic lives in the backend and in `packages/shared`, not in UI
  components. The web app consumes typed data hooks; components carry no logic.
- Entity ids are stable (app-local task ids, deal ids, meeting ids, brief ids).
- The `/api/v1/me/*` APIs are reusable by any client.
- Supabase Google SSO is reusable auth: an extension would obtain the same
  Supabase session and call the same endpoints with the same `Authorization`
  header (and `x-google-token` for calendar).

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the extension will reuse the
backend.

## Known limitations

- **ROMA Fight Score is all-time, not weekly.** ROMA does not expose weekly
  buckets. The app surfaces the pooled all-time score as-is and does not
  fabricate a weekly series.
- **Seamless provider is a stub.** It advertises availability and returns an
  explicit `not_implemented` (or `no_api_key`) result until the account endpoint
  and key are wired. It never returns fabricated data.
- **Brief schema is not finalized.** Sections are intentionally dynamic; the
  renderer must not assume a fixed schema.
- **Revy is not implemented.** Route, nav entry, and empty state only.
- **Manual checks are optimistic only.** They are never authoritative and are
  always reconciled against HubSpot; a false check respawns the task.

## Roadmap

- Build out Revy on top of the already-implemented ROMA funnel and Fight Score
  endpoints.
- Finalize the Briefy brief schema and complete the Seamless provider.
- Ship the Chrome extension reusing the existing backend, shared package, and
  Supabase auth.
- Activate the additional roles (`TEAM_LEAD`, `REVOPS_ADMIN`,
  `SALES_LEADERSHIP`) behind `requireRole` when wider scopes are needed.
