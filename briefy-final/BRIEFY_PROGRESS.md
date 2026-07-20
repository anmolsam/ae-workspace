# Briefy Backend — Build Progress

Tracks the plan in `docs/superpowers/plans/2026-07-16-briefy-backend-implementation.md`.
Executed subagent-driven, in an isolated worktree (`worktree-briefy-backend`), one task
at a time with implementer + reviewer subagents. Milestones are checked off here as
they complete, each with a plain-English summary underneath.

## Milestones

- [x] **Milestone 1: Shared library foundation (`src/lib/`)** — extract scraping/LLM
      logic, extend HubSpot/ZoomInfo clients, add Clay stub, generalize Airtable for a
      separate Briefy base
  - [x] Task 1.1: Extract Exa/Firecrawl/SerpAPI scraping into `src/lib/scrapers.js`
  - [x] Task 1.2: Extract the Requesty LLM call into `src/lib/requesty.js`
  - [x] Task 1.3: Extend `src/lib/hubspot.js` (contact/prior-deals/owner lookups)
  - [x] Task 1.4: Extend `src/lib/zoominfo.js` (contact search + Intent)
  - [x] Task 1.5: Create `src/lib/clay.js`
  - [x] Task 1.6: Generalize `src/lib/airtable.js` for a separate Briefy base
  - [x] Task 1.7: Verify ICP Match is unaffected by this milestone

- [x] **Milestone 2: Briefy Airtable table** — idempotent setup script for the new,
      separate Airtable base, plus the sync step that seeds it from ICP Match Final
      (no new HubSpot workflow needed)
  - [x] Task 2.1: Write the idempotent table-setup script
  - [x] Task 2.2: `src/briefy/syncFromIcpMatch.js` (mirrors eligible rows from ICP
        Match Final into the Briefy base)

- [x] **Milestone 3: Company & contact resolution**
  - [x] Task 3.1: `src/briefy/resolveCompany.js` (domain normalization)
  - [x] Task 3.2: `src/briefy/owner-map.js` placeholder

- [x] **Milestone 4: Research sections — company website & hiring**
  - [x] Task 4.1: `src/briefy/sections/overview.js`
  - [x] Task 4.2: `src/briefy/sections/hiringSignals.js`

- [x] **Milestone 5: Research sections — HubSpot, ZoomInfo, Clay**
  - [x] Task 5.1: `src/briefy/sections/orgTree.js`
  - [x] Task 5.2: `src/briefy/sections/revenue.js`
  - [x] Task 5.3: `src/briefy/sections/hubspotSignals.js`
  - [x] Task 5.4: `src/briefy/sections/intent.js`

- [x] **Milestone 6: Orchestration — `briefBuilder.js` + `engine.js`**
  - [x] Task 6.1: `src/briefy/briefBuilder.js`
  - [x] Task 6.2: `src/briefy/engine.js`

- [ ] **Final whole-branch review** — code-reviewer pass over the full diff before merge

## Milestone summaries

### Milestone 1: Shared library foundation — complete

This milestone took the reusable pieces of ICP Match's pipeline and made them
available to Briefy without changing how ICP Match itself behaves. Concretely:

- Pulled the web-scraping logic (Exa, Firecrawl, SerpAPI) and the LLM-gateway call
  (Requesty) out of `icp-final.js` — ICP Match's main file — into two new shared
  files, `src/lib/scrapers.js` and `src/lib/requesty.js`. `icp-final.js` now just
  imports them instead of having its own copies; nothing about how it classifies
  companies changed.
- Added four new capabilities to the existing HubSpot client (`src/lib/hubspot.js`):
  finding the contact on a deal, finding that contact's other deals, reading their
  website analytics, and resolving an owner ID to a name. These are what Briefy's
  "prior deals" and "last page visited" features will run on later.
- Added two new capabilities to the existing ZoomInfo client: searching contacts by
  title (for org charts) and pulling an Intent score.
- Built a small new Clay client that fires an enrichment request and cleanly no-ops
  if Clay isn't configured yet.
- The trickiest piece: made the Airtable client able to talk to **two separate
  Airtable bases** — ICP Match's existing one and, later, a brand-new one just for
  Briefy — without changing a single line of code in any of the files that already
  use it.
- Finished with a dedicated verification pass: full test suite green (25/25),
  every touched file syntax-checked clean, no leftover dead code, and confirmation
  that ICP Match's actual behavior is untouched.

Along the way, two real issues got caught and fixed before they could cause trouble
later: a test-runner command that would have silently stopped discovering new test
files as more got added (fixed by switching to Node's real recursive test discovery),
and a couple of small dead-code leftovers from the extraction. Everything is reviewed,
approved, and committed — nothing is pending from this milestone.

**Next up:** Milestone 2 — the script that creates Briefy's own Airtable table.

### Milestone 2: Briefy Airtable table — complete

Partway through this milestone, the plan changed for the better: instead of building
a brand-new HubSpot→Airtable workflow just for Briefy, we reuse the one that already
feeds ICP Match. Concretely, this milestone built:

- A script that creates Briefy's own Airtable table (27 fields — trigger/seed data,
  engine status, and the six research sections) inside its own separate Airtable
  base. It's safe to run more than once — it checks whether the table already exists
  before creating anything.
- `syncFromIcpMatch.js` — the piece that makes "no new HubSpot workflow" actually
  work. It watches the existing "ICP Match Final" table for rows where a deal has an
  owner assigned *and* ICP Match's own research has already finished, and copies each
  one over into Briefy's table (company info, the already-scraped website content,
  trade classification, etc.), skipping any deal it's already copied before. This
  saves Briefy from re-scraping websites ICP Match already scraped, and means nobody
  has to build or maintain a second HubSpot integration.

Both pieces went through review, including a genuinely thorough check on the second
one — the reviewer didn't just read the code, it deliberately broke a copy of it (a
missing field, a swapped `AND`/`OR`) to prove the tests would actually catch those
exact mistakes if they ever crept back in. Everything's approved and committed.

**Note for you:** this only starts working once you've added the `Deal Owner`,
`Deal Stage`, and `Deal Link` fields to "ICP Match Final" yourself, and confirmed the
exact live field names for `IP State`, `IP Country`, and `Meeting Date & Time` match
what this code expects (see `architecturefinal.md`'s field-name caveat).

**Next up:** Milestone 3 — normalizing the seeded company domain, and the AE→owner
mapping placeholder.

### Milestone 3: Company & contact resolution — complete

This milestone got noticeably smaller partway through, for a good reason: you pointed
out that since the company domain now always comes pre-resolved from ICP Match Final
(one company per row, personal-email domains already filtered out upstream), the
originally-planned "which of two companies do we research" logic could never actually
trigger. So it was removed — along with the "list of companies" complexity it forced
onto every other piece of Briefy (each research section was going to accept an array
and merge results across companies; now they each just take one plain domain string).
This milestone built what's left:

- `resolveCompany.js` — a small, simple cleanup step: trims, lowercases, and strips
  the protocol/`www.` off whatever's in the Company Domain cell. No network calls, no
  async, nothing clever — just normalization.
- `owner-map.js` — the placeholder file where you'll map each AE's Google login email
  to their exact Airtable "Deal Owner" name. It ships empty; the frontend (a later
  phase) uses it to gate access so an AE only ever sees their own deals.

Both approved with no real issues — one trivial doc-comment typo fixed directly along
the way.

**Next up:** Milestone 4 — the first two research sections (company overview/
portfolio, and hiring signals), the first real "write actual brief content" pieces.

### Milestone 4: Research sections — company website & hiring — complete

The first two sections that actually produce brief content an AE will read:

- **Overview + Portfolio** — a plain-English summary of what the company does, plus
  any project/portfolio links found on their own site (never invented, never pulled
  from Google). Smartly reuses the website content ICP Match already scraped
  (`Exa Content`, copied over in Milestone 2) instead of re-scraping from scratch —
  only falls back to a fresh scrape if that's empty.
- **Hiring Signals** — open roles pulled from the company's own careers page, a
  general Google search, and a LinkedIn-jobs-via-Google search, combined into one
  list so the AE can see if they're hiring estimators or project managers.

Both approved cleanly. The reviewer went a step further on the first one — it wrote
its own test forcing a simulated failure to confirm errors are actually caught
correctly, not just assumed to be from reading the code.

**Next up:** Milestone 5 — the remaining four research sections: org tree, revenue,
HubSpot engagement signals, and buying-intent score.

### Milestone 5: Research sections — HubSpot, ZoomInfo, Clay — complete

The remaining four research sections — with this, all six sections that make up a
brief now exist:

- **Org Tree** — pulls estimators, project/program managers, and upper management
  from ZoomInfo, bucketed by job title. A real bug got caught and fixed here during
  review: titles like "Director of Estimating" or "VP of Preconstruction" were being
  bucketed as plain estimators instead of upper management, because the matching
  logic checked department-name keywords before seniority keywords. Fixed so a
  "Director"/"VP"/"Chief" title always wins that tie, which matters for real
  construction-industry titles.
- **Revenue** — ZoomInfo's revenue estimate (immediate) plus a Clay enrichment
  trigger (fire-and-forget — shows "pending" until Clay's async result lands later).
- **HubSpot Signals** — the last page the person visited before booking the demo,
  plus every other deal that same person is associated with (name, owner, link,
  meeting time) — pulled via the contact on the deal, confirmed using the real
  HubSpot portal ID.
- **Intent** — ZoomInfo's buying-intent score, gated behind the topic IDs you'll
  supply later.

One real correctness bug found and fixed (the org tree title-bucketing order); every
other review came back clean on the first or second pass.

**Next up:** Milestone 6 — wiring all six sections together into one orchestrator,
and the actual polling daemon that runs the whole thing continuously. This is the
last backend milestone.

### Milestone 6: Orchestration — complete (final backend milestone)

The two pieces that turn six independent research sections into an actual running
product:

- **`briefBuilder.js`** — takes one Briefy Airtable row, resolves its company domain,
  and fires all six research sections (overview, hiring signals, org tree, revenue,
  HubSpot signals, intent) at once rather than one after another, so a brief takes
  as long as the slowest single section instead of the sum of all six. If the domain
  can't be resolved, it writes an error status immediately and skips all research —
  no wasted API calls. Writes every result back to Briefy's own Airtable base, never
  ICP Match's.
- **`engine.js`** — the actual daemon that runs forever: every 5 minutes it first
  pulls in any newly-eligible deals from ICP Match Final, then checks Briefy's table
  for anything not yet built or explicitly marked for a refresh, and builds each one.
  If one row fails, it's marked as an error and the daemon moves on to the next one
  rather than stopping. Modeled directly on the existing ICP Match daemon, so it
  starts and runs the same way (`npm run briefy`).

Both were reviewed with extra scrutiny since this is where every earlier task's work
gets wired together — the reviewer independently re-checked, against the real code
(not just the implementer's word for it), that every function call between pieces
uses the right arguments in the right order, and that the engine only ever reads or
writes Briefy's own separate Airtable base. Both came back approved with zero
findings at any severity.

**This completes the entire 19-task Briefy backend plan.**

### Final whole-branch review — complete

A senior-level pass across the entire diff (all 19 tasks together, not task-by-task)
found no Critical issues and confirmed every cross-task safety invariant held —
base isolation, the removed multi-company pattern staying fully gone, and every
accepted per-task finding still true. One Important gap: none of the external API
calls (Exa, Firecrawl, SerpAPI, HubSpot, ZoomInfo) had a client-side timeout, and
since `engine.js` processes rows fully sequentially, one hung connection could stall
the whole daemon indefinitely. Fixed across two rounds — the first fix covered all
14 call sites in `src/lib/`, a second round caught 3 more direct-fetch call sites in
`src/briefy/sections/hiringSignals.js` that the first pass missed. Both re-reviewed
clean. Merged into `main` (`1933d6c`), backend plan fully complete and mergeable.

### Testing — dry run complete, live integration in progress

**Dry run (fake data, no real API calls):** confirmed `briefBuilder.js`'s wiring is
correct — the happy path fans out all six sections with the right arguments and maps
every result to the right Airtable field; the not-found path correctly short-circuits
to `Brief Status: Error` without running any section at all.

**Live integration — where we paused (2026-07-17):**
- A real, dedicated Airtable base for Briefy now exists (`appk2esDd7EVf5Irg`). Ran
  `npm run briefy:setup-table` for real — the "Briefy" table was created and
  independently verified via the Airtable Meta API: all 27 fields present with the
  exact types the schema specifies (`Meeting Date & Time` as `number`/epoch-ms,
  `Brief Status` as the 5-choice single select, etc.).
- **Blocking issue found:** the Airtable token provided is scoped to the new Briefy
  base only — confirmed via a live 403 when the same token tried to reach the
  existing ICP Match base. The code uses one shared `AIRTABLE_API_KEY` for both
  bases (`src/lib/airtable.js`), so `syncFromIcpMatch.js` cannot read "ICP Match
  Final" until this is resolved. Two options on the table: widen this token's scope
  in Airtable's Developer Hub to also cover the ICP Match base (no code change), or
  provide a second token and add support for two separate API key env vars (small
  code change). Leaning toward the first.
- `.env` exists locally (gitignored, not pushed) with the Airtable values filled in
  and every other key (`HUBSPOT_API_KEY`, `ZOOMINFO_CLIENT_ID`/`SECRET`,
  `ZOOMINFO_INTENT_TOPICS`, `REQUESTY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`,
  `SERPAPI_KEY`, `CLAY_API_KEY`, `CLAY_WEBHOOK_URL`) still blank pending you gathering
  them.
- `src/briefy/owner-map.js` is still the placeholder — needs real
  `{email: "Deal Owner name"}` pairs before any real AE can be tested.

**Resume point for live testing:** once the base-access question above is resolved
and the remaining keys are gathered, the next concrete step is running
`npm run briefy` for one real tick against at least one eligible "ICP Match Final"
row and confirming in the Airtable UI that `Brief Status` moves
`Not Started` → `Generating` → `Ready`.

## Frontend

**Status: code-complete, merged to main — live end-to-end verification still
pending.** Built from
[`docs/superpowers/specs/2026-07-17-briefy-frontend-design.md`](docs/superpowers/specs/2026-07-17-briefy-frontend-design.md)
via
[`docs/superpowers/plans/2026-07-20-briefy-frontend-implementation.md`](docs/superpowers/plans/2026-07-20-briefy-frontend-implementation.md),
executed subagent-driven, one task at a time with implementer + reviewer
subagents — same pattern as the backend, but each of the plan's 4 milestones
built and reviewed on its own branch (`frontend/auth-gate`,
`frontend/meeting-list`, `frontend/brief-detail`, `frontend/refresh-flow`),
merged into `main` as each completed its own whole-branch review.

- [x] **Milestone 1: Auth / Domain Gate** — Next.js app scaffold at `web/`,
      NextAuth Google-provider auth gated to `@attentive.ai` emails mapped in
      `src/briefy/owner-map.js`, the login page.
- [x] **Milestone 2: Meeting List / Home Page** — server-only Airtable client
      scoped by `Deal Owner`, the per-owner meeting list grouped by day
      (client-side timezone, fixed during review — the first pass grouped/
      rendered on the server's UTC clock instead of the browser's).
- [x] **Milestone 3: Brief Detail Page** — the 4-state (ready/pending/error/
      unavailable) section-state derivation, all 7 section panels, the detail
      page.
- [x] **Milestone 4: Refresh Flow** — the refresh API route (flips `Brief
      Status` only — the already-running `src/briefy/engine.js` daemon is
      still the only thing that ever regenerates a brief), and
      `BriefDetailClient`'s background polling while `Generating`/
      `Refreshing`.
- [ ] **Manual end-to-end verification against real Airtable + Google OAuth
      credentials** — not yet run. Requires: adding your own `@attentive.ai`
      email to `src/briefy/owner-map.js`, filling in `web/.env.local` (copy
      from `web/.env.local.example`), and a Google Cloud OAuth 2.0 Client ID/
      Secret with `http://localhost:3000/api/auth/callback/google` as an
      authorized redirect URI. See Task 4.5 in the implementation plan for the
      full checklist (sign-in → meeting list → brief detail live states →
      refresh flow).

Every task's own review, and each milestone's whole-branch review, caught and
fixed real bugs before merge — most notably: a `safeJsonParse` crash on the
JSON literal `"null"` (Milestone 3), and the meeting-list timezone bug above
(Milestone 2). Full history in `.superpowers/sdd/progress.md`'s Briefy
Frontend ledger (gitignored, local-only).
