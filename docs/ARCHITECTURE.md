# ae-workspace architecture

This document describes the layered architecture, the source-of-truth hierarchy,
the follow-up state machine, the adapter/service seams, the primary data flows,
and how a future Chrome extension will reuse the backend.

The governing rule: this app never rebuilds upstream logic. It reads HubSpot
(follow-ups and activity) and ROMA (Fight Score and funnel), and owns only a thin
app-local layer of task state in Postgres.

## End-to-end journey (final outcome)

What an AE actually experiences, start to finish - the outcome this architecture
produces:

```
1. SIGN IN
   AE opens the web app -> "Sign in with Google" -> Supabase Google SSO
   (calendar.readonly scope). Google-verified Workspace email returned.
        |
        v
2. BECOME AN AE
   Backend verifies the token, enforces the @attentive.ai domain, maps the
   email -> HubSpot owner id, caches identity in ae_identities. From here every
   request is scoped to THIS owner id only - no AE can see another's data.
        |
        v
3. TASKEE  (the outcome: "what needs my attention right now?")
   - Reads the AE's HubSpot deals; every populated AI-draft field becomes one
     follow-up task. overdueAt = draftGeneratedAt + 24h.
   - Reconciles each against HubSpot truth, renders grouped + sorted:
        OVERDUE (pinned top, restrained red) -> TODAY -> TOMORROW -> THIS WEEK
   - Summary chips: [ Due Today ] [ Overdue ] [ This Week ].
   - Each card: company, deal, follow-up type, due/overdue, checkbox,
     expandable AI draft, "Open Deal in HubSpot" deep link.
   - Tick a box -> instant strikethrough. If HubSpot later shows no real
     activity, the task RESPAWNS to its correct position (top + red if overdue).
     Genuine HubSpot activity auto-checks it as COMPLETED_VERIFIED.
   - Bottom of page: the AE's FIGHT SCORE and FUNNEL, pulled from ROMA as-is,
     scoped to this AE. Never recomputed.
        |
        v
4. BRIEFY  (the outcome: "what should I know before my next call?")
   - Lists the AE's upcoming Google Calendar meetings with brief status
     (Ready / Generating / Needs Data / Completed).
   - Expands into a pre-call brief with dynamic sections assembled from the
     research providers (Exa / ZoomInfo / Jina). Lifecycle:
     queued -> processing -> completed | failed.
        |
        v
5. REVY   (placeholder: a polished "Revy is coming next" empty state)
        |
        v
6. STAYS TRUE
   A 30-minute reconciliation cron re-verifies every open task against HubSpot,
   idempotently. Taskee is always consistent with reality, whether or not the
   AE remembered to tick a box.
```

The guarantee the architecture enforces end-to-end: the AE gets instant,
optimistic feedback, but can never make a genuine follow-up disappear without
real HubSpot activity - and never sees another AE's data.

## Layered architecture

```
+---------------------------------------------------------------+
|  Clients                                                      |
|    apps/web (React + Vite + TS + Tailwind)                    |
|    future Chrome extension (reuses the same APIs + auth)      |
+----------------------------+----------------------------------+
                             | HTTPS: Bearer token + x-google-token
                             v
+---------------------------------------------------------------+
|  Transport / routes (apps/api/src)                            |
|    routes/me.js        -> requireAuth (per-AE isolation seam)  |
|    routes/internal.js  -> requireCronSecret                   |
|    server.js           -> health, CORS, JSON error handler    |
+----------------------------+----------------------------------+
                             |
                             v
+---------------------------------------------------------------+
|  Services (business logic; no HTTP, no SQL strings here)      |
|    FollowUpQueryService      (services/followup-query.js)     |
|    FollowUpCompletionVerifier(services/completion-verifier.js)|
|    FollowUpReconciliationSvc (services/reconciliation.js)     |
|    RomaFightScoreService     (services/roma-fight-score.js)   |
|    RomaFunnelService         (services/roma-funnel.js)        |
|    BriefGenerationService    (services/brief-generation.js)   |
|    GoogleAuthService         (auth/google-auth.js)            |
+----------------------------+----------------------------------+
                             |
          +------------------+------------------+
          v                                     v
+-------------------------+       +-----------------------------+
|  Adapters (I/O seams)   |       |  Persistence                |
|    HubSpotAdapter       |       |    db/supabase.js (service  |
|    RomaAdapter          |       |      role client)           |
|    CalendarAdapter      |       |    db/tasks-repo.js         |
|    ResearchProvider*    |       |    Postgres (Supabase)      |
+-----------+-------------+       +--------------+--------------+
            |                                    |
            v                                    v
+-------------------------+       +-----------------------------+
|  Upstream systems       |       |  Tables (RLS: deny direct)  |
|    HubSpot API          |       |    ae_identities            |
|    ROMA (:8080)         |       |    follow_up_tasks          |
|    Google Calendar      |       |    pre_call_briefs          |
|    Exa/ZoomInfo/Jina/   |       |    brief_sections           |
|      Seamless           |       |    research_sources         |
+-------------------------+       +-----------------------------+
```

Shared, framework-agnostic contracts live in `packages/shared/src`:
`hubspot-fields.js` (the single source of truth for HubSpot property names),
`follow-up-state.js` (the `TASK_STATE` enum and the pure `reconcile()` reducer),
and `types.js` (DTO typedefs). Both the API and a future extension depend on
these.

## Source-of-truth hierarchy

```
                        Authoritative truth
                                |
      +-------------------------+--------------------------+
      |                         |                          |
   HubSpot                    ROMA                     Google
(follow-ups + activity)  (Fight Score + funnel)      (calendar)
      |                         |                          |
      | drafts / *_status /     | /fight-score/data        | primary calendar
      | engagement activity     | /ae-cr/data              | events
      |                         |                          |
      v                         v                          v
  HubSpotAdapter            RomaAdapter               CalendarAdapter
      |                         |                          |
      +------------ App-local layer (Postgres) ------------+
                                |
             follow_up_tasks: ONLY manual-check intent +
             reconciliation state. Everything else is a
             cached projection of upstream truth.
```

Precedence when they disagree:

1. HubSpot upstream `*_status` (`timely`/`delayed` = done; `skipped_*`/`paused_*`
   = disregard) wins absolutely over any local state.
2. HubSpot engagement activity is the secondary freshness signal when status is
   still `none`.
3. The AE's manual checkbox is optimistic UI only; it never overrides HubSpot and
   respawns if HubSpot shows no activity.

The app never recomputes a Fight Score, a funnel stage, or a cadence decision. It
projects upstream numbers and layers only the manual-intent/reconciliation
dimension.

## Follow-up state machine

States and the pure reducer live in `packages/shared/src/follow-up-state.js`. A
slot becomes a task only because its HubSpot draft field is populated;
`overdueAt = draftGeneratedAt + 24h`.

```
                         draft populated, status `none`
                                     |
                                     v
        (within 24h) ----------> [ ACTIVE ] ----------> past 24h
                                     |                     |
                                     |                     v
                                     |                [ OVERDUE ]  (pinned top, red)
                                     |                     |
                AE ticks box         |    AE ticks box     |
                (optimistic)         v                     v
                    +-----> [ MANUALLY_CHECKED_PENDING_VERIFICATION ]
                    |                    |            |
                    |     reconcile:     |            |  reconcile: no activity,
                    |     HubSpot        |            |  not overdue
                    |     activity       |            v
                    |     confirmed      |   [ REOPENED_AFTER_FAILED_VERIFICATION ]
                    |         |          |            |
                    |         v          |            | (later crosses 24h)
                    |  [ COMPLETED_VERIFIED ]         v
                    |     (strikethrough,        [ OVERDUE ]
                    |      cannot un-verify)
                    |
   AE unticks box --+   (returns to ACTIVE / OVERDUE by the 24h rule)

   Any state + upstream status skipped_negative / paused_ooo / paused_meeting
                                     |
                                     v
                              [ DISREGARDED ]  (hidden)
```

Rendering helpers:

- `OPEN_STATES` (render in Taskee): `ACTIVE`, `OVERDUE`,
  `MANUALLY_CHECKED_PENDING_VERIFICATION`, `REOPENED_AFTER_FAILED_VERIFICATION`.
- `CHECKED_STATES` (strikethrough / checked box): `MANUALLY_CHECKED_PENDING_VERIFICATION`,
  `COMPLETED_VERIFIED`.

### The pure `reconcile()` reducer

```
reconcile(task, hubspot, now):
  if hubspot.isDone        -> COMPLETED_VERIFIED   (reason: hubspot_activity_confirmed)
  if hubspot.isDisregarded -> DISREGARDED          (reason: upstream_disregarded)
  overdue = task.overdueAt <= now
  if task.state == MANUALLY_CHECKED_PENDING_VERIFICATION:
      -> overdue ? OVERDUE : REOPENED_AFTER_FAILED_VERIFICATION  (respawn)
  else:
      -> overdue ? OVERDUE : ACTIVE
```

It is deterministic and idempotent: the same inputs always yield the same output,
so running reconciliation twice is safe.

### Reconciliation Cases A through D

`FollowUpReconciliationService` (via `syncTasksForOwner` with
`checkActivity: true`) resolves every open task into exactly one case:

| Case | Condition                                | Resulting state                        |
| ---- | ---------------------------------------- | -------------------------------------- |
| A    | Qualifying HubSpot activity exists (status done, or freshness activity found) | `COMPLETED_VERIFIED` (with activity/status reference) |
| B    | No activity, not manually checked, within 24h | `ACTIVE`                               |
| C    | No activity, manually checked            | `REOPENED_AFTER_FAILED_VERIFICATION` (respawn), or `OVERDUE` if past 24h |
| D    | No activity, past 24h                    | `OVERDUE` (rendered red, pinned to top) |

A cleared upstream draft removes the task entirely (`deleteTasksByKeys`).

## Adapter and service seams

Each seam has one responsibility, so a future Chrome extension (or any new
client) reuses them without touching upstream systems directly.

- **GoogleAuthService** (`auth/google-auth.js`) - verifies a Supabase Google-SSO
  access token, enforces the allowed email domain, maps the Google-verified email
  to a HubSpot owner id via `HubSpotAdapter.getOwnerByEmail`, and caches the
  identity in `ae_identities`. Output: `{ userId, email, ownerId, aeName, role }`.
  `requireAuth` (`auth/middleware.js`) is the isolation seam: every `/api/v1/me/*`
  route scopes by `req.ae.ownerId` derived only from the token.

- **HubSpotAdapter** (`adapters/hubspot.js`) - the only module that talks to
  HubSpot. `getOwnerByEmail`, `getDealsForOwner` (pipeline + owner filtered,
  normalized into deals with slots), and `getQualifyingActivityAfter` (reads
  emails/calls/communications associations for the freshness check). Never writes
  cadence fields. Uses short-TTL caches (`ownersCache`, `dealsCache`).

- **RomaFightScoreService** (`services/roma-fight-score.js`) and
  **RomaFunnelService** (`services/roma-funnel.js`) - thin projections over the
  **RomaAdapter** (`adapters/roma.js`), which handles `POST /unlock` with
  `ROMA_PASSWORD`, caches the `roma_session` cookie (refresh before 12h), and
  reads `/fight-score/data` and `/ae-cr/data`. The services filter to the AE's
  owner id and compute only the same ratios ROMA's UI already shows. No local
  recomputation. Fight Score is pooled all-time (documented limitation).

- **FollowUpQueryService** (`services/followup-query.js`) - the normalization and
  reconciliation orchestrator. Turns HubSpot deals into app-local tasks (a slot
  is a task only if its draft is populated), calls the verifier, applies the pure
  `reconcile()` reducer, upserts on the natural key, and deletes tasks whose
  draft was cleared. Also builds the sorted/grouped Taskee DTO view
  (`buildTaskeeView`), with overdue pinned to the top.

- **FollowUpCompletionVerifier** (`services/completion-verifier.js`) - decides
  whether a follow-up is genuinely done according to HubSpot, not the checkbox.
  Primary: the upstream `*_status`. Secondary (only when `checkActivity` is true
  and status is `none`): a HubSpot engagement freshness read after
  `draftGeneratedAt`. A failed activity read never marks a task complete.

- **FollowUpReconciliationService** (`services/reconciliation.js`) - the
  half-hourly backstop. Enumerates tracked owners (anyone with a linked identity
  or an existing task) and runs `syncTasksForOwner(..., { checkActivity: true })`
  per owner. Idempotent; logs per-owner failures without corrupting task state.

- **CalendarAdapter** (`adapters/calendar.js`) - reads the AE's primary calendar
  with the forwarded Google provider token (`calendar.readonly`). Returns
  `{ enabled:false, meetings:[] }` when disabled or token-less, so the UI shows an
  honest empty state. Derives the external company/domain from non-domain
  attendees.

- **BriefGenerationService** (`services/brief-generation.js`) - owns the brief
  lifecycle (`queued -> processing -> completed -> failed`) and the dynamic
  section schema stored as `brief_sections` rows. Fans research out over the
  provider registry, assembles ordered sections, records contributing
  `research_sources`, and upserts idempotently per `(owner, meeting)`.

- **ResearchProviderAdapter** (`adapters/research/*`) - the `ResearchProvider`
  interface (`base.js`) with a registry (`index.js`) that fans out
  `enrichCompanyAll` / `enrichPersonAll` across available providers. Exa and
  ZoomInfo are reused; Jina is net-new (implemented); Seamless is a net-new stub.
  Each provider advertises `available` and returns a uniform result; unavailable
  providers return an explicit error, never mock data.

## Data flow: Taskee page load

```
web GET /api/v1/me/follow-ups (Bearer token)
  -> requireAuth: verify token -> resolve identity -> req.ae.ownerId
  -> FollowUpQueryService.syncTasksForOwner(ownerId, { checkActivity: false })
       -> HubSpotAdapter.getDealsForOwner(ownerId)      [pipeline + owner filter]
       -> for each slot with a populated draft:
            -> FollowUpCompletionVerifier.verifyCompletion  [status only]
            -> reconcile(prior, verdict, now)               [pure reducer]
            -> tasks-repo.upsertTask(...)                   [natural key upsert]
       -> delete tasks whose draft was cleared upstream
  -> buildTaskeeView(tasks)   [filter open, map to DTO, sort overdue-first, bucket]
  -> JSON { followUps, summary }
```

## Data flow: manual check then reconciliation (false-check respawn)

```
1. web POST /api/v1/me/follow-ups/:id/check
     -> getTaskById(id, ownerId)                 [owner-scoped isolation]
     -> applyManualCheck -> MANUALLY_CHECKED_PENDING_VERIFICATION
     -> updateTask(...)                           [instant, optimistic UI]

2. Railway cron (every 30 min) POST /internal/cron/reconcile (x-cron-secret)
     -> reconcileAll()
          -> for each tracked owner:
               syncTasksForOwner(ownerId, { checkActivity: true })
                 -> verifyCompletion reads HubSpot engagement activity
                    after draftGeneratedAt
                 -> reconcile(...):
                      activity found  -> COMPLETED_VERIFIED        (Case A)
                      none + overdue  -> OVERDUE (top, red)        (Case C/D)
                      none + within 24h -> REOPENED_AFTER_FAILED_VERIFICATION (Case C)
```

## Data flow: Briefy brief generation

```
web GET /api/v1/me/meetings (Bearer + x-google-token)
  -> CalendarAdapter.listUpcomingEvents(googleToken)
  -> annotate each meeting with brief status from pre_call_briefs

web POST /api/v1/me/meetings/:id/generate-brief (fire-and-forget, 202 queued)
  -> BriefGenerationService.generateBrief:
       upsert pre_call_briefs (processing)
       -> ResearchProviderAdapter fan-out (enrichCompanyAll, enrichPersonAll)
       -> assemble ordered brief_sections (delete + reinsert)
       -> record research_sources
       -> upsert pre_call_briefs (completed | failed)

web GET /api/v1/me/briefs/:briefId
  -> getBrief(briefId, ownerId)   [owner-scoped]
  -> { jobStatus, sections[], sources[] }
```

## Persistence and isolation

- The API uses the Supabase **service-role** client (`db/supabase.js`), which
  bypasses RLS. The API is the trusted layer: it scopes every query by
  `owner_id`, and every `/api/v1/me/*` handler passes `req.ae.ownerId` explicitly
  (for example `getTaskById(id, ownerId)`).
- **RLS** is enabled on all tables with no permissive policies, so a leaked anon
  key reads zero rows. The browser never queries these tables directly; it only
  uses Supabase for auth.
- `follow_up_tasks` uses the natural key `(owner_id, deal_id, track, slot)` for
  idempotent upserts; `pre_call_briefs` uses `(owner_id, meeting_id)`.

## How the Chrome extension will reuse the backend

The extension is not built and must not be scaffolded now (no manifest, popup, or
content scripts). The seams above make it a thin future addition:

- **Same auth.** The extension obtains a Supabase Google-SSO session and sends the
  same `Authorization: Bearer <token>` header (and `x-google-token` for
  calendar). `requireAuth` resolves the same identity and enforces the same
  isolation.
- **Same APIs.** All data comes from the reusable `/api/v1/me/*` endpoints.
  Nothing client-specific lives in the API.
- **Same contracts.** `packages/shared` holds the DTO typedefs, the HubSpot field
  config, and the state model, so the extension consumes identical shapes and
  state semantics as the web app.
- **No logic in clients.** Business logic stays in services and shared code, and
  entity ids are stable, so the extension renders and mutates through the same
  hooks and endpoints without duplicating any upstream logic.
