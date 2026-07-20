# Briefy Frontend — Design

> Companion to `architecturefinal.md`'s "Frontend" section, which sketched the shape
> of this. This doc records the decisions made while brainstorming and validated
> against a fully interactive HTML/CSS/JS prototype (approved by the user
> 2026-07-17) — nothing here has been implemented yet. This is the design to build
> from, not a description of existing code.

## What it is

The AE-facing web app that reads Briefy's Airtable base (built by the already-shipped
backend, `src/briefy/`) and displays a pre-call brief for each upcoming meeting. Each
AE signs in with their `@attentive.ai` Google account and only ever sees briefs for
deals they personally own.

## Validated via prototype

A fully interactive prototype (not static mockups — real clickable HTML/CSS/JS,
fake data) was built and approved. It's preserved on disk at
`.superpowers/brainstorm/25886-1784264403/content/briefy-prototype.html` (gitignored,
local only — copy it somewhere durable if you want it to survive a `git clean`). It
demonstrates every decision below end-to-end: login domain-gate, per-owner filtering,
the meeting list, the brief detail page, and the refresh flow.

## Decisions

**Stack:** Next.js (App Router) + Tailwind + shadcn/ui. Confirmed in
`architecturefinal.md`, not revisited.

**Auth:** NextAuth.js (Auth.js) with Google as the only provider, JWT session
strategy — no database, consistent with the project's no-Postgres/no-Supabase
decision. Sign-in flow:
1. Google OAuth redirect/callback via NextAuth.
2. `signIn` callback rejects any email not ending in `@attentive.ai`.
3. On success, look up the email in `src/briefy/owner-map.js`'s `OWNER_MAP`. If
   unmapped, reject with a distinct "you're not set up in Briefy yet" message (not a
   generic auth failure) — see `architecturefinal.md` > Auth flow.
4. The JWT carries the mapped `Deal Owner` string. Every query against the Briefy
   Airtable base filters `Deal Owner = <that value>` — this is the sole data
   isolation mechanism between AEs.
5. The frontend's server-side code (API routes / server components) is the only
   thing that ever touches `AIRTABLE_API_KEY` or `HUBSPOT_API_KEY` — never sent to
   the client.

**Home page — meeting window:** Today through the next 7 days, grouped by day
(Today / Tomorrow / `Jul 24` etc.), sorted soonest-first within each day. A day with
no meetings shows a plain "No meetings" line rather than being hidden — an AE should
be able to tell at a glance that a day is genuinely empty, not that the page is
broken.

**Timezone:** Auto-detected client-side from the browser (`Intl.DateTimeFormat` /
`Date`) — no settings page, no manual override, no persistence mechanism for v1.
`Meeting Date & Time` is stored as raw epoch-milliseconds (see `architecturefinal.md`
field-name caveat), so this is a pure client-side rendering concern. A manual
override was explicitly considered and cut as unnecessary complexity for v1 — revisit
only if AEs actually report wrong-timezone complaints.

**Brief detail page — sections:** Six independent panels — Overview, Portfolio /
Projects, Org Tree, Revenue, HubSpot Signals, Hiring Signals, Buying Intent — each
rendering its own state independently from the Briefy row's `Section Status` JSON
field:
- `ready` → real content
- `pending` → skeleton loading placeholder (shimmer, not a spinner — matches the
  prototype)
- `error` → "This section failed to load. It will retry on the next refresh."
- `unavailable` → "Not available" (used when the whole brief is in `Error` status —
  domain never resolved, so no section ran at all)

A brief is never all-or-nothing — this was true in the backend design and the
frontend must preserve it visually.

**Refresh flow:**
1. AE clicks "Refresh brief" on the detail page.
2. A Next.js API route (`api/briefs/[id]/refresh`) flips that row's `Brief Status` to
   `Refreshing` — it does **not** talk to `src/briefy/engine.js` directly. This keeps
   "Airtable is the trigger" true for refreshes, exactly as `architecturefinal.md`
   specifies.
3. The engine picks it up on its next poll (every `BRIEFY_WATCH_INTERVAL_MIN`
   minutes, default 5) and reruns all six sections.
4. While `Brief Status` is `Generating` or `Refreshing`, the detail page **auto-polls
   in the background** (every ~10–15s) and re-renders — each section swaps from
   skeleton to real content independently, the instant its own `Section Status`
   flips to `ready`, without the AE reloading or doing anything. This was the single
   most consequential UX decision made during brainstorming: a refresh can take a
   few real-world minutes (the engine only polls every 5 min by default), and the
   page must show real, live progress during that wait rather than a static
   "check back later" message.
5. Once every section reports `ready` (or the whole row reports `Error`), polling
   stops.

**Visual style:** Clean and minimal — generous whitespace, a restrained neutral
palette (near-black text, gray borders, a single blue accent for actions/links),
clear typography, strong hierarchy. Status uses color sparingly and consistently:
green = ready, amber = generating/pending, red = error, gray = not started/
unavailable. No gratuitous color, no clutter — the design has to be scannable in the
two minutes before a call. Matches the prototype exactly; no further exploration
needed.

**Hosting:** Railway, as a third service in the same project as ICP Match's
`watch.js` and Briefy's `src/briefy/engine.js` — `next build && next start`, no
Vercel, no separate hosting account.

## Explicitly out of scope for v1 (don't build unless asked)

- Timezone override / settings page.
- Mobile-optimized layout — not discussed during brainstorming; the prototype and
  this design assume desktop-first (an AE prepping at their desk before a call).
  Revisit if this turns out to matter.
- Any UI for editing owner-map.js, ZoomInfo Intent topics, or Clay config — those
  remain file/env-based admin tasks, not app features.

## Open questions (unresolved, need a decision before or during planning)

- None outstanding from brainstorming. Implementation-level questions (exact NextAuth
  route structure, exact Tailwind/shadcn component choices, testing approach for a
  Next.js app) belong in the implementation plan, not this design doc.

## Status

Design approved 2026-07-17 (validated via interactive prototype, not yet
implemented). Next step: write the implementation plan (`superpowers:writing-plans`)
and execute it subagent-driven, the same way the backend was built.
