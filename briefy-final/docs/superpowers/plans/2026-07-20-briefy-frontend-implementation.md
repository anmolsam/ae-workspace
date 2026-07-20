# Briefy Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AE-facing Next.js app that reads Briefy's Airtable base and shows each AE a pre-call brief for their own upcoming meetings, per the approved design in `docs/superpowers/specs/2026-07-17-briefy-frontend-design.md`.

**Architecture:** A new, independent Next.js (App Router) project lives at `web/` inside this repo, with its own `package.json` — it is deployed as a third Railway service (`next build && next start`) alongside the existing `watch.js` and `src/briefy/engine.js` services, exactly as `architecturefinal.md` specifies. It never writes any backend field the engine owns except `Brief Status` (only ever to `Refreshing`, on refresh). It imports `getOwnerForEmail` directly from `../src/briefy/owner-map.js` (a plain, dependency-free ESM module) rather than duplicating the owner map.

**Tech Stack:** Next.js 14 (App Router) · NextAuth.js v4 (Google provider, JWT session strategy, no database) · Tailwind CSS · hand-rolled shadcn-style primitives (`cn()` + `Button`/`Card`, no interactive CLI needed) · `airtable` npm client (same package the backend uses) · Vitest + React Testing Library for tests (the backend's `node --test` has no DOM; Vitest is the standard, ESM-native choice for a React app and is scoped entirely to `web/`, it does not touch the backend's test setup).

## Global Constraints

- **Branching:** each Milestone below is one feature branch off `main`: `frontend/auth-gate`, `frontend/meeting-list`, `frontend/brief-detail`, `frontend/refresh-flow`, created in that order (each depends on the previous). Each numbered Task within a Milestone is done on its own sub-branch off that feature branch (e.g. `frontend/auth-gate/1.1-scaffold`), merged back into the feature branch when its own steps/commit are done. The feature branch itself merges into `main` once every task in it is complete and reviewed — do not merge a feature branch into `main` until its Milestone is fully done.
- **Node version:** `>=20` (matches root `package.json`'s `engines` field) — verified locally on v25.9.0, both satisfy `>=20`.
- **No new backend fields:** every Airtable field this plan reads or writes already exists in `scripts/setup-briefy-table.js`'s schema. The only field the frontend ever writes is `Brief Status` → `"Refreshing"`.
- **Data isolation is server-side only:** `AIRTABLE_API_KEY` and any HubSpot/ZoomInfo keys are read only inside `web/lib/*.ts` (server-only modules) and Next.js Route Handlers — never imported by a Client Component, never sent to the browser.
- **`Deal Owner` string equality is the sole access-control mechanism** — every read of a specific brief (list or detail) must filter or check against the signed-in AE's mapped `Deal Owner` value from `owner-map.js`. A record whose `Deal Owner` doesn't match the session is treated as **not found** (404), not "forbidden" — never leak that a record exists for someone else.
- **Section Status parsing:** `Section Status` is a JSON string with exactly these 7 keys: `overview, portfolio, orgTree, revenue, hubspotSignals, hiringSignals, intent`, each `"ready" | "error" | "unavailable"` (the backend never writes a `"pending"` value into this field — see Task 3.2 for the derivation rule that produces the 4th, frontend-only `pending` state).
- **Reference doc for exact visual details** (spacing, colors, copy): `.superpowers/brainstorm/25886-1784264403/content/briefy-prototype.html` (gitignored, local-only — read it directly on disk, don't assume it's in git).

---

## File Structure

```
web/
  package.json
  next.config.mjs
  tailwind.config.ts
  postcss.config.mjs
  tsconfig.json
  vitest.config.ts
  .env.local.example
  README.md
  middleware.ts
  app/
    layout.tsx
    globals.css
    page.tsx                          # redirects to /meetings (or /login)
    login/page.tsx
    meetings/page.tsx
    briefs/[id]/page.tsx
    api/
      auth/[...nextauth]/route.ts
      meetings/route.ts
      briefs/[id]/route.ts
      briefs/[id]/refresh/route.ts
  lib/
    cn.ts
    auth.ts
    airtable.ts
    briefs.ts
    time.ts
  components/
    ui/button.tsx
    ui/card.tsx
    SectionPanel.tsx
    DayGroup.tsx
    MeetingListItem.tsx
    RefreshButton.tsx
    BriefDetailClient.tsx
    sections/OverviewSection.tsx
    sections/PortfolioSection.tsx
    sections/OrgTreeSection.tsx
    sections/RevenueSection.tsx
    sections/HubspotSignalsSection.tsx
    sections/HiringSignalsSection.tsx
    sections/IntentSection.tsx
  types/briefy.ts
  tests/
    lib/time.test.ts
    lib/auth.test.ts
    lib/briefs.test.ts
    components/SectionPanel.test.tsx
    components/RevenueSection.test.tsx
```

- `lib/` = server-safe, framework-agnostic logic (Airtable access, auth rules, data shaping) — the layer with real unit-test coverage.
- `components/` = presentation. `sections/*` are one file per brief panel, each thin (just field rendering), sharing state chrome via `SectionPanel`.
- `types/briefy.ts` is the single source of truth for shapes shared between `lib/briefs.ts`, the API routes, and every component — defined once in Task 3.1, imported everywhere after.

---

## Milestone 1 — Auth / Domain Gate

**Branch:** `frontend/auth-gate` (off `main`)

### Task 1.1: Scaffold the Next.js app

**Files:**
- Create: `web/package.json`
- Create: `web/next.config.mjs`
- Create: `web/tsconfig.json`
- Create: `web/tailwind.config.ts`
- Create: `web/postcss.config.mjs`
- Create: `web/app/globals.css`
- Create: `web/app/layout.tsx`
- Create: `web/app/page.tsx`
- Create: `web/lib/cn.ts`
- Create: `web/vitest.config.ts`
- Create: `web/README.md`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Produces: `cn(...classes: (string | false | null | undefined)[]): string` — used by every component from here on to merge Tailwind classes.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "briefy-web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^14.2.5",
    "next-auth": "^4.24.7",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "airtable": "^0.12.2",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/node": "^20.14.15",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.41",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        status: {
          ready: '#16a34a',
          pending: '#d97706',
          error: '#dc2626',
          unavailable: '#6b7280',
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: Create `web/postcss.config.mjs`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-white text-neutral-900 antialiased;
}
```

- [ ] **Step 7: Create `web/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 8: Create `web/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Briefy',
  description: 'Pre-call briefs for Attentive.ai account executives',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Create `web/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/meetings');
}
```

(`/meetings` itself redirects unauthenticated visitors to `/login` — that redirect is added by the `middleware.ts` in Task 1.3, not here.)

- [ ] **Step 10: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
});
```

- [ ] **Step 11: Create `web/README.md`**

```markdown
# Briefy — Frontend

Next.js (App Router) app for `briefy-web`. Run from inside this directory:

    npm install
    cp .env.local.example .env.local   # fill in real values
    npm run dev

Tests: `npm test` (Vitest). Build: `npm run build`.

Deployed on Railway as a third service in the same project as ICP Match's
`watch.js` and Briefy's `src/briefy/engine.js` — root directory `web/`,
start command `npm run build && npm run start`.
```

- [ ] **Step 12: Add `.next/` to the repo-root `.gitignore`**

Append this line to `.gitignore`:

```
.next/
```

- [ ] **Step 13: Install dependencies and verify the build**

Run: `cd web && npm install && npm run build`
Expected: build succeeds, producing a `.next/` directory, no TypeScript errors (the two placeholder pages are trivial).

- [ ] **Step 14: Commit**

```bash
git add web .gitignore
git commit -m "feat(web): scaffold Next.js app for Briefy frontend"
```

---

### Task 1.2: Auth rules — `lib/auth.ts`

**Files:**
- Create: `web/lib/auth.ts`
- Create: `web/tests/lib/auth.test.ts`
- Modify: `.env.example` (repo root)
- Create: `web/.env.local.example`

**Interfaces:**
- Consumes: `getOwnerForEmail(email: string): string | null` from `../src/briefy/owner-map.js` (already exists, unchanged).
- Produces: `resolveOwner(email: string | null | undefined): { ok: true, dealOwner: string } | { ok: false, reason: 'not_attentive_domain' | 'not_mapped' }` — the pure, testable auth-decision function. `authOptions: NextAuthOptions` — the NextAuth config consumed by Task 1.3's route handler and by every server-side `getServerSession(authOptions)` call in later tasks. The session's `user` object carries `dealOwner: string`.

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/lib/auth.test.ts
import { describe, it, expect } from 'vitest';
import { resolveOwner } from '../../lib/auth';

describe('resolveOwner', () => {
  it('rejects a non-attentive.ai email before even checking the owner map', () => {
    expect(resolveOwner('someone@gmail.com')).toEqual({ ok: false, reason: 'not_attentive_domain' });
  });

  it('rejects a null/undefined email', () => {
    expect(resolveOwner(null)).toEqual({ ok: false, reason: 'not_attentive_domain' });
    expect(resolveOwner(undefined)).toEqual({ ok: false, reason: 'not_attentive_domain' });
  });

  it('rejects an attentive.ai email with no owner-map entry', () => {
    expect(resolveOwner('nobody-real@attentive.ai')).toEqual({ ok: false, reason: 'not_mapped' });
  });

  it('is case-insensitive on domain matching', () => {
    expect(resolveOwner('nobody-real@ATTENTIVE.AI')).toEqual({ ok: false, reason: 'not_mapped' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/lib/auth.test.ts`
Expected: FAIL — `web/lib/auth.ts` does not exist yet.

- [ ] **Step 3: Write `web/lib/auth.ts`**

```ts
import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { getOwnerForEmail } from '../../src/briefy/owner-map.js';

export type OwnerResolution =
  | { ok: true; dealOwner: string }
  | { ok: false; reason: 'not_attentive_domain' | 'not_mapped' };

/**
 * Pure decision function: is this email allowed into Briefy, and if so, which
 * Airtable "Deal Owner" does it map to? No I/O — safe to unit test directly.
 */
export function resolveOwner(email: string | null | undefined): OwnerResolution {
  if (!email || !email.toLowerCase().endsWith('@attentive.ai')) {
    return { ok: false, reason: 'not_attentive_domain' };
  }
  const dealOwner = getOwnerForEmail(email);
  if (!dealOwner) {
    return { ok: false, reason: 'not_mapped' };
  }
  return { ok: true, dealOwner };
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      const resolution = resolveOwner(user.email);
      if (!resolution.ok) {
        // NextAuth maps a thrown/returned-false signIn into a `?error=` query
        // param on the `error` page above; we distinguish the two reasons there.
        return resolution.reason === 'not_mapped' ? '/login?error=NotMapped' : false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const resolution = resolveOwner(user.email);
        if (resolution.ok) token.dealOwner = resolution.dealOwner;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as typeof session.user & { dealOwner?: string }).dealOwner =
          token.dealOwner as string | undefined;
      }
      return session;
    },
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/lib/auth.test.ts`
Expected: PASS (all 4 cases) — note this only exercises `resolveOwner`, which has no network dependency, so it passes even with an empty `OWNER_MAP`.

- [ ] **Step 5: Append the NextAuth env vars to the repo-root `.env.example`**

Append this block to `.env.example`:

```env
# ── Google OAuth (NextAuth, Briefy frontend) ─────────────────────────────────
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...                     # e.g. https://briefy.yourdomain.com
```

- [ ] **Step 6: Create `web/.env.local.example`**

Next.js only auto-loads env files from its own project root (`web/`), not the repo-root `.env` the backend uses — so the frontend needs its own copy of the subset of vars it actually reads:

```env
AIRTABLE_API_KEY=pat...
BRIEFY_AIRTABLE_BASE_ID=app...
BRIEFY_AIRTABLE_TABLE=Briefy

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 7: Commit**

```bash
git add web/lib/auth.ts web/tests/lib/auth.test.ts .env.example web/.env.local.example
git commit -m "feat(web): add auth resolution rules (domain + owner-map gate)"
```

---

### Task 1.3: Wire the NextAuth route + middleware

**Files:**
- Create: `web/app/api/auth/[...nextauth]/route.ts`
- Create: `web/middleware.ts`

**Interfaces:**
- Consumes: `authOptions` from `web/lib/auth.ts` (Task 1.2).
- Produces: every unauthenticated request to any page other than `/login` and `/api/auth/*` is redirected to `/login`.

- [ ] **Step 1: Create `web/app/api/auth/[...nextauth]/route.ts`**

```ts
import NextAuth from 'next-auth';
import { authOptions } from '../../../../lib/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
```

- [ ] **Step 2: Create `web/middleware.ts`**

```ts
import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: { signIn: '/login' },
});

export const config = {
  matcher: ['/meetings/:path*', '/briefs/:path*'],
};
```

- [ ] **Step 3: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds (route handler and middleware both type-check against `next-auth`'s types).

- [ ] **Step 4: Commit**

```bash
git add web/app/api/auth web/middleware.ts
git commit -m "feat(web): wire NextAuth route handler and route-protection middleware"
```

---

### Task 1.4: Login page

**Files:**
- Create: `web/app/login/page.tsx`
- Create: `web/components/ui/button.tsx`

**Interfaces:**
- Consumes: `signIn`, `useSearchParams` from `next-auth/react` / `next/navigation`.
- Produces: `Button` — the shared shadcn-style button used by every later interactive component (`RefreshButton` in Task 4.2 reuses it).

- [ ] **Step 1: Create `web/components/ui/button.tsx`**

```tsx
'use client';

import { cn } from '../../lib/cn';
import type { ButtonHTMLAttributes } from 'react';

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 2: Create `web/app/login/page.tsx`**

```tsx
'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '../../components/ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  NotMapped: "You're not set up in Briefy yet — ask an admin to add you to the owner map.",
  AccessDenied: 'Only @attentive.ai Google accounts can sign in to Briefy.',
};

export default function LoginPage() {
  const params = useSearchParams();
  const error = params.get('error');
  const message = error ? ERROR_MESSAGES[error] ?? 'Sign-in failed — please try again.' : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">Briefy</h1>
        <p className="mt-1 text-sm text-neutral-500">Pre-call briefs for account executives</p>
      </div>
      {message && (
        <p className="max-w-sm text-center text-sm text-red-600" role="alert">
          {message}
        </p>
      )}
      <Button onClick={() => signIn('google', { callbackUrl: '/meetings' })}>
        Sign in with Google
      </Button>
    </main>
  );
}
```

- [ ] **Step 3: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/app/login web/components/ui/button.tsx
git commit -m "feat(web): add login page with domain/owner-map error messages"
```

---

## Milestone 2 — Meeting List / Home Page

**Branch:** `frontend/meeting-list` (off `main`, after `frontend/auth-gate` is merged)

### Task 2.1: Server-only Airtable client — `lib/airtable.ts`

**Files:**
- Create: `web/lib/airtable.ts`

**Interfaces:**
- Produces: `getBriefyTable(): Airtable.Table` and `queryMeetingsForOwner(dealOwner: string): Promise<Airtable.Record[]>` and `getBriefRecordById(id: string): Promise<Airtable.Record | null>` and `setBriefStatusRefreshing(id: string): Promise<void>` — every later server-side data access (Tasks 2.4, 3.5, 4.1) goes through these four functions, never touches the `airtable` package directly.

- [ ] **Step 1: Create `web/lib/airtable.ts`**

```ts
import 'server-only';
import Airtable from 'airtable';

const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

let base: Airtable.Base | null = null;

function getBase(): Airtable.Base {
  if (!base) {
    base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
      process.env.BRIEFY_AIRTABLE_BASE_ID as string
    );
  }
  return base;
}

export function getBriefyTable() {
  return getBase()(TABLE);
}

const MEETING_WINDOW_MS = 8 * 24 * 60 * 60 * 1000; // today through +7 days

/** Every meeting for one AE, today through the next 7 days, soonest first. */
export async function queryMeetingsForOwner(dealOwner: string) {
  const now = Date.now();
  const windowEnd = now - (now % (24 * 60 * 60 * 1000)) + MEETING_WINDOW_MS; // start of today + 8 days
  const startOfToday = now - (now % (24 * 60 * 60 * 1000));

  const records: Airtable.Record<Airtable.FieldSet>[] = [];
  await getBriefyTable()
    .select({
      filterByFormula: `AND(
        {Deal Owner} = "${dealOwner.replace(/"/g, '\\"')}",
        {Meeting Date & Time} >= ${startOfToday},
        {Meeting Date & Time} < ${windowEnd}
      )`,
      sort: [{ field: 'Meeting Date & Time', direction: 'asc' }],
    })
    .eachPage((page, next) => {
      records.push(...page);
      next();
    });
  return records;
}

/** A single brief record, only if it belongs to the given AE — otherwise null (never leak existence). */
export async function getBriefRecordById(id: string, dealOwner: string) {
  const record = await getBriefyTable()
    .find(id)
    .catch(() => null);
  if (!record || record.get('Deal Owner') !== dealOwner) return null;
  return record;
}

export async function setBriefStatusRefreshing(id: string, dealOwner: string) {
  const record = await getBriefRecordById(id, dealOwner);
  if (!record) return false;
  await getBriefyTable().update(id, { 'Brief Status': 'Refreshing' });
  return true;
}
```

- [ ] **Step 2: Add the `server-only` package**

Run: `cd web && npm install server-only`

This guarantees a build-time error if any Client Component ever accidentally imports `lib/airtable.ts` — the same guarantee `architecturefinal.md` requires in prose, enforced by the compiler instead of by convention.

- [ ] **Step 3: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/lib/airtable.ts web/package.json web/package-lock.json
git commit -m "feat(web): add server-only Airtable client scoped to one AE's Deal Owner"
```

---

### Task 2.2: Shared types — `types/briefy.ts`

**Files:**
- Create: `web/types/briefy.ts`

**Interfaces:**
- Produces: `MeetingSummary`, `SectionKey`, `SectionStatusValue`, `BriefDetail` — imported by every task from here on (`lib/briefs.ts`, both API routes, every component).

- [ ] **Step 1: Create `web/types/briefy.ts`**

```ts
export type BriefStatus = 'Not Started' | 'Generating' | 'Ready' | 'Error' | 'Refreshing';

export const SECTION_KEYS = [
  'overview',
  'portfolio',
  'orgTree',
  'revenue',
  'hubspotSignals',
  'hiringSignals',
  'intent',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/** 'pending' is frontend-only — the backend never writes it (see lib/briefs.ts deriveSectionState). */
export type SectionStatusValue = 'ready' | 'pending' | 'error' | 'unavailable';

export type SectionStatusMap = Record<SectionKey, SectionStatusValue>;

export interface MeetingSummary {
  id: string;
  dealName: string;
  companyName: string;
  meetingDateTime: number; // epoch ms
  dealStage: string;
  briefStatus: BriefStatus;
}

export interface PriorDeal {
  dealName: string;
  dealOwner: string;
  dealLink: string;
  meetingDateTimeSales: string | null;
}

export interface OpenRole {
  title: string;
  source: string;
  link: string;
}

export interface OrgTreeContact {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  source: string;
}

export interface OrgTree {
  estimators: OrgTreeContact[];
  programManagers: OrgTreeContact[];
  upperManagement: OrgTreeContact[];
}

export interface BriefDetail {
  id: string;
  dealName: string;
  companyName: string;
  companyDomain: string;
  meetingDateTime: number;
  dealStage: string;
  dealLink: string;
  briefStatus: BriefStatus;
  sectionStatus: SectionStatusMap;
  overview: string;
  portfolio: string;
  orgTree: OrgTree;
  zoomInfoRevenue: string;
  clayRevenue: string;
  lastPageVisited: string;
  lastPageVisitedAt: string | null;
  priorDeals: PriorDeal[];
  openRoles: OpenRole[];
  zoomInfoIntentScore: string;
}
```

- [ ] **Step 2: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds (no consumers yet, but the file must type-check standalone).

- [ ] **Step 3: Commit**

```bash
git add web/types/briefy.ts
git commit -m "feat(web): add shared Briefy types"
```

---

### Task 2.3: Data mapping — `lib/briefs.ts` (meeting summary + day grouping)

**Files:**
- Create: `web/lib/briefs.ts`
- Create: `web/tests/lib/briefs.test.ts`

**Interfaces:**
- Consumes: `MeetingSummary` from `types/briefy.ts`.
- Produces: `recordToMeetingSummary(record): MeetingSummary` and `groupByDay(meetings: MeetingSummary[], now: number): { label: string; meetings: MeetingSummary[] }[]` — both pure functions, no Airtable/network dependency, fully unit-testable. Later tasks (2.4, 2.5) call these; Task 3.2 adds `recordToBriefDetail` to this same file.

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/lib/briefs.test.ts
import { describe, it, expect } from 'vitest';
import { groupByDay } from '../../lib/briefs';
import type { MeetingSummary } from '../../types/briefy';

function meeting(overrides: Partial<MeetingSummary>): MeetingSummary {
  return {
    id: 'rec1',
    dealName: 'Acme — Q3 Renewal',
    companyName: 'Acme',
    meetingDateTime: Date.now(),
    dealStage: 'Demo Scheduled',
    briefStatus: 'Ready',
    ...overrides,
  };
}

describe('groupByDay', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-07-20T12:00:00Z').getTime();
  const startOfToday = now - (now % DAY_MS);

  it('labels today and tomorrow correctly, and groups by calendar day', () => {
    const todayMeeting = meeting({ id: 'a', meetingDateTime: startOfToday + 2 * 60 * 60 * 1000 });
    const tomorrowMeeting = meeting({ id: 'b', meetingDateTime: startOfToday + DAY_MS + 60 * 60 * 1000 });

    const groups = groupByDay([todayMeeting, tomorrowMeeting], now);

    expect(groups[0].label).toBe('Today');
    expect(groups[0].meetings.map(m => m.id)).toEqual(['a']);
    expect(groups[1].label).toBe('Tomorrow');
    expect(groups[1].meetings.map(m => m.id)).toEqual(['b']);
  });

  it('includes an empty day with no meetings rather than hiding it', () => {
    const groups = groupByDay([], now);
    expect(groups).toHaveLength(8); // today + next 7 days
    expect(groups.every(g => g.meetings.length === 0)).toBe(true);
  });

  it('sorts meetings within a day soonest-first', () => {
    const later = meeting({ id: 'later', meetingDateTime: startOfToday + 10 * 60 * 60 * 1000 });
    const earlier = meeting({ id: 'earlier', meetingDateTime: startOfToday + 2 * 60 * 60 * 1000 });

    const groups = groupByDay([later, earlier], now);

    expect(groups[0].meetings.map(m => m.id)).toEqual(['earlier', 'later']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/lib/briefs.test.ts`
Expected: FAIL — `lib/briefs.ts` does not exist yet.

- [ ] **Step 3: Write `web/lib/briefs.ts`**

```ts
import type { MeetingSummary, BriefStatus } from '../types/briefy';
import type Airtable from 'airtable';

const DAY_MS = 24 * 60 * 60 * 1000;

export function recordToMeetingSummary(record: Airtable.Record<Airtable.FieldSet>): MeetingSummary {
  return {
    id: record.id,
    dealName: (record.get('Deal Name') as string) || '',
    companyName: (record.get('Company Name') as string) || '',
    meetingDateTime: (record.get('Meeting Date & Time') as number) || 0,
    dealStage: (record.get('Deal Stage') as string) || '',
    briefStatus: ((record.get('Brief Status') as string) || 'Not Started') as BriefStatus,
  };
}

function dayLabel(dayStart: number, todayStart: number): string {
  const diffDays = Math.round((dayStart - todayStart) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return new Date(dayStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Today through the next 7 days, one group per calendar day — empty days included on purpose. */
export function groupByDay(
  meetings: MeetingSummary[],
  now: number
): { label: string; meetings: MeetingSummary[] }[] {
  const todayStart = now - (now % DAY_MS);
  const groups = Array.from({ length: 8 }, (_, i) => {
    const dayStart = todayStart + i * DAY_MS;
    return { dayStart, label: dayLabel(dayStart, todayStart), meetings: [] as MeetingSummary[] };
  });

  for (const m of meetings) {
    const dayIndex = Math.floor((m.meetingDateTime - todayStart) / DAY_MS);
    if (dayIndex >= 0 && dayIndex < groups.length) {
      groups[dayIndex].meetings.push(m);
    }
  }

  for (const g of groups) {
    g.meetings.sort((a, b) => a.meetingDateTime - b.meetingDateTime);
  }

  return groups.map(({ label, meetings }) => ({ label, meetings }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/lib/briefs.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add web/lib/briefs.ts web/tests/lib/briefs.test.ts
git commit -m "feat(web): add meeting-summary mapping and day-grouping logic"
```

---

### Task 2.4: `GET /api/meetings` route

**Files:**
- Create: `web/app/api/meetings/route.ts`

**Interfaces:**
- Consumes: `getServerSession`, `authOptions` (Task 1.2), `queryMeetingsForOwner` (Task 2.1), `recordToMeetingSummary`, `groupByDay` (Task 2.3).
- Produces: `GET /api/meetings` → `{ groups: { label: string, meetings: MeetingSummary[] }[] }`, `401` if unauthenticated, `403` if the session has no mapped `dealOwner` (shouldn't happen post-signIn-callback, but the route must not trust the client).

- [ ] **Step 1: Create `web/app/api/meetings/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { queryMeetingsForOwner } from '../../../lib/airtable';
import { recordToMeetingSummary, groupByDay } from '../../../lib/briefs';

export async function GET() {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;

  if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!dealOwner) return NextResponse.json({ error: 'No owner mapping' }, { status: 403 });

  const records = await queryMeetingsForOwner(dealOwner);
  const meetings = records.map(recordToMeetingSummary);
  const groups = groupByDay(meetings, Date.now());

  return NextResponse.json({ groups });
}
```

- [ ] **Step 2: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/meetings
git commit -m "feat(web): add GET /api/meetings route, scoped to the signed-in AE"
```

---

### Task 2.5: Meeting list page + components

**Files:**
- Create: `web/components/MeetingListItem.tsx`
- Create: `web/components/DayGroup.tsx`
- Create: `web/app/meetings/page.tsx`

**Interfaces:**
- Consumes: `MeetingSummary` (types), `GET /api/meetings` (Task 2.4).
- Produces: the rendered home page — no further consumers, this is a leaf.

- [ ] **Step 1: Create `web/components/MeetingListItem.tsx`**

```tsx
import Link from 'next/link';
import type { MeetingSummary } from '../types/briefy';

const STATUS_DOT: Record<MeetingSummary['briefStatus'], string> = {
  'Not Started': 'bg-status-unavailable',
  Generating: 'bg-status-pending',
  Refreshing: 'bg-status-pending',
  Ready: 'bg-status-ready',
  Error: 'bg-status-error',
};

export function MeetingListItem({ meeting }: { meeting: MeetingSummary }) {
  const time = new Date(meeting.meetingDateTime).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Link
      href={`/briefs/${meeting.id}`}
      className="flex items-center justify-between rounded-md border border-neutral-200 px-4 py-3 hover:border-neutral-300 hover:bg-neutral-50"
    >
      <div>
        <p className="font-medium text-neutral-900">{meeting.companyName}</p>
        <p className="text-sm text-neutral-500">
          {meeting.dealName} · {meeting.dealStage}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-500">{time}</span>
        <span
          className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[meeting.briefStatus]}`}
          title={meeting.briefStatus}
        />
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create `web/components/DayGroup.tsx`**

```tsx
import type { MeetingSummary } from '../types/briefy';
import { MeetingListItem } from './MeetingListItem';

export function DayGroup({ label, meetings }: { label: string; meetings: MeetingSummary[] }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{label}</h2>
      {meetings.length === 0 ? (
        <p className="text-sm text-neutral-400">No meetings</p>
      ) : (
        <div className="flex flex-col gap-2">
          {meetings.map(m => (
            <MeetingListItem key={m.id} meeting={m} />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Create `web/app/meetings/page.tsx`**

```tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../lib/auth';
import { queryMeetingsForOwner } from '../../lib/airtable';
import { recordToMeetingSummary, groupByDay } from '../../lib/briefs';
import { DayGroup } from '../../components/DayGroup';

export default async function MeetingsPage() {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;
  if (!session || !dealOwner) redirect('/login');

  const records = await queryMeetingsForOwner(dealOwner);
  const meetings = records.map(recordToMeetingSummary);
  const groups = groupByDay(meetings, Date.now());

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Your meetings</h1>
      {groups.map(g => (
        <DayGroup key={g.label + g.meetings[0]?.id} label={g.label} meetings={g.meetings} />
      ))}
    </main>
  );
}
```

- [ ] **Step 4: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/components/MeetingListItem.tsx web/components/DayGroup.tsx web/app/meetings/page.tsx
git commit -m "feat(web): render the per-owner meeting list grouped by day"
```

---

## Milestone 3 — Brief Detail Page

**Branch:** `frontend/brief-detail` (off `main`, after `frontend/meeting-list` is merged)

### Task 3.1: Section-state derivation — extend `lib/briefs.ts`

**Files:**
- Modify: `web/lib/briefs.ts`
- Modify: `web/tests/lib/briefs.test.ts`

**Interfaces:**
- Produces: `deriveSectionState(briefStatus, sectionStatusJson, key): SectionStatusValue` and `recordToBriefDetail(record): BriefDetail` — the exact 4-state fallback rule every panel (Task 3.3/3.4) and both remaining routes (3.5, 4.1) depend on.

- [ ] **Step 1: Write the failing test**

```ts
// append to web/tests/lib/briefs.test.ts
import { deriveSectionState, recordToBriefDetail } from '../../lib/briefs';

describe('deriveSectionState', () => {
  it('is unavailable for every section when the whole brief errored', () => {
    expect(deriveSectionState('Error', null, 'overview')).toBe('unavailable');
  });

  it('is pending for every section while the brief is still generating and has no Section Status yet', () => {
    expect(deriveSectionState('Generating', null, 'overview')).toBe('pending');
    expect(deriveSectionState('Refreshing', null, 'overview')).toBe('pending');
    expect(deriveSectionState('Not Started', null, 'overview')).toBe('pending');
  });

  it('reads the specific key out of a valid Section Status JSON string once the brief is Ready', () => {
    const json = JSON.stringify({
      overview: 'ready', portfolio: 'ready', orgTree: 'error', revenue: 'ready',
      hubspotSignals: 'ready', hiringSignals: 'unavailable', intent: 'unavailable',
    });
    expect(deriveSectionState('Ready', json, 'orgTree')).toBe('error');
    expect(deriveSectionState('Ready', json, 'hiringSignals')).toBe('unavailable');
  });

  it('falls back to pending on malformed Section Status JSON rather than throwing', () => {
    expect(deriveSectionState('Ready', 'not json', 'overview')).toBe('pending');
  });
});

describe('recordToBriefDetail', () => {
  it('safely parses empty/malformed JSON array fields to empty arrays', () => {
    const fakeRecord = {
      id: 'rec1',
      get: (field: string) => {
        const values: Record<string, unknown> = {
          'Deal Name': 'Acme — Q3',
          'Company Name': 'Acme',
          'Company Domain': 'acme.com',
          'Meeting Date & Time': 1234567890,
          'Deal Stage': 'Demo Scheduled',
          'Deal Link': 'https://app.hubspot.com/deal/1',
          'Brief Status': 'Ready',
          'Section Status': null,
          'Org Tree': 'not json',
          'Prior Deals': 'not json',
          'Open Roles': 'not json',
        };
        return values[field];
      },
    } as unknown as Parameters<typeof recordToBriefDetail>[0];

    const detail = recordToBriefDetail(fakeRecord);
    expect(detail.orgTree).toEqual({ estimators: [], programManagers: [], upperManagement: [] });
    expect(detail.priorDeals).toEqual([]);
    expect(detail.openRoles).toEqual([]);
    expect(detail.sectionStatus.overview).toBe('pending');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/lib/briefs.test.ts`
Expected: FAIL — `deriveSectionState` and `recordToBriefDetail` don't exist yet.

- [ ] **Step 3: Extend `web/lib/briefs.ts`**

Add these imports and functions to the existing file (keep `recordToMeetingSummary` and `groupByDay` as they are):

```ts
import type {
  BriefDetail, SectionKey, SectionStatusMap, SectionStatusValue, OrgTree, PriorDeal, OpenRole,
} from '../types/briefy';
import { SECTION_KEYS } from '../types/briefy';

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_ORG_TREE: OrgTree = { estimators: [], programManagers: [], upperManagement: [] };

export function deriveSectionState(
  briefStatus: string,
  sectionStatusJson: string | null | undefined,
  key: SectionKey
): SectionStatusValue {
  if (briefStatus === 'Error') return 'unavailable';
  const parsed = safeJsonParse<Partial<Record<SectionKey, SectionStatusValue>>>(sectionStatusJson, {});
  const value = parsed[key];
  if (value === 'ready' || value === 'error' || value === 'unavailable') return value;
  return 'pending';
}

function deriveAllSectionStates(briefStatus: string, sectionStatusJson: string | null | undefined): SectionStatusMap {
  return Object.fromEntries(
    SECTION_KEYS.map(key => [key, deriveSectionState(briefStatus, sectionStatusJson, key)])
  ) as SectionStatusMap;
}

export function recordToBriefDetail(record: Airtable.Record<Airtable.FieldSet>): BriefDetail {
  const briefStatus = ((record.get('Brief Status') as string) || 'Not Started') as BriefDetail['briefStatus'];
  const sectionStatusJson = record.get('Section Status') as string | null;

  return {
    id: record.id,
    dealName: (record.get('Deal Name') as string) || '',
    companyName: (record.get('Company Name') as string) || '',
    companyDomain: (record.get('Company Domain') as string) || '',
    meetingDateTime: (record.get('Meeting Date & Time') as number) || 0,
    dealStage: (record.get('Deal Stage') as string) || '',
    dealLink: (record.get('Deal Link') as string) || '',
    briefStatus,
    sectionStatus: deriveAllSectionStates(briefStatus, sectionStatusJson),
    overview: (record.get('Company Overview') as string) || '',
    portfolio: (record.get('Portfolio / Projects') as string) || '',
    orgTree: safeJsonParse<OrgTree>(record.get('Org Tree'), EMPTY_ORG_TREE),
    zoomInfoRevenue: (record.get('ZoomInfo Revenue') as string) || '',
    clayRevenue: (record.get('Clay Revenue') as string) || '',
    lastPageVisited: (record.get('Last Page Visited') as string) || '',
    lastPageVisitedAt: (record.get('Last Page Visited At') as string) || null,
    priorDeals: safeJsonParse<PriorDeal[]>(record.get('Prior Deals'), []),
    openRoles: safeJsonParse<OpenRole[]>(record.get('Open Roles'), []),
    zoomInfoIntentScore: (record.get('ZoomInfo Intent Score') as string) || '',
  };
}
```

Also add `import type Airtable from 'airtable';` at the top of the file if it isn't already there from Task 2.3.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/lib/briefs.test.ts`
Expected: PASS (all cases, including the two new `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add web/lib/briefs.ts web/tests/lib/briefs.test.ts
git commit -m "feat(web): derive per-section ready/pending/error/unavailable state"
```

---

### Task 3.2: `SectionPanel` — the shared 4-state wrapper

**Files:**
- Create: `web/components/SectionPanel.tsx`
- Create: `web/components/ui/card.tsx`
- Create: `web/tests/components/SectionPanel.test.tsx`

**Interfaces:**
- Consumes: `SectionStatusValue` (types).
- Produces: `<SectionPanel title status>` — every one of the 7 section components in Task 3.3 wraps its content in this.

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/components/SectionPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionPanel } from '../../components/SectionPanel';

describe('SectionPanel', () => {
  it('renders children when ready', () => {
    render(
      <SectionPanel title="Overview" status="ready">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.getByText('Real content')).toBeTruthy();
  });

  it('renders a shimmer placeholder, not children, when pending', () => {
    render(
      <SectionPanel title="Overview" status="pending">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.queryByText('Real content')).toBeNull();
    expect(screen.getByTestId('section-shimmer')).toBeTruthy();
  });

  it('shows the retry-on-refresh message when errored', () => {
    render(
      <SectionPanel title="Overview" status="error">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.getByText(/will retry on the next refresh/i)).toBeTruthy();
  });

  it('shows "Not available" when unavailable', () => {
    render(
      <SectionPanel title="Overview" status="unavailable">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.getByText('Not available')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/components/SectionPanel.test.tsx`
Expected: FAIL — neither component exists yet.

- [ ] **Step 3: Create `web/components/ui/card.tsx`**

```tsx
import { cn } from '../../lib/cn';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-neutral-200 p-4', className)} {...props} />;
}
```

- [ ] **Step 4: Create `web/components/SectionPanel.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { SectionStatusValue } from '../types/briefy';
import { Card } from './ui/card';

const STATUS_LABEL_COLOR: Record<SectionStatusValue, string> = {
  ready: 'text-status-ready',
  pending: 'text-status-pending',
  error: 'text-status-error',
  unavailable: 'text-status-unavailable',
};

export function SectionPanel({
  title,
  status,
  children,
}: {
  title: string;
  status: SectionStatusValue;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-neutral-900">{title}</h3>
        <span className={`text-xs font-medium uppercase tracking-wide ${STATUS_LABEL_COLOR[status]}`}>
          {status}
        </span>
      </div>
      {status === 'ready' && children}
      {status === 'pending' && (
        <div data-testid="section-shimmer" className="h-16 animate-pulse rounded-md bg-neutral-100" />
      )}
      {status === 'error' && (
        <p className="text-sm text-neutral-500">
          This section failed to load. It will retry on the next refresh.
        </p>
      )}
      {status === 'unavailable' && <p className="text-sm text-neutral-400">Not available</p>}
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run tests/components/SectionPanel.test.tsx`
Expected: PASS (all 4 cases).

- [ ] **Step 6: Commit**

```bash
git add web/components/SectionPanel.tsx web/components/ui/card.tsx web/tests/components/SectionPanel.test.tsx
git commit -m "feat(web): add SectionPanel, the shared 4-state panel wrapper"
```

---

### Task 3.3: The seven section components

**Files:**
- Create: `web/components/sections/OverviewSection.tsx`
- Create: `web/components/sections/PortfolioSection.tsx`
- Create: `web/components/sections/OrgTreeSection.tsx`
- Create: `web/components/sections/RevenueSection.tsx`
- Create: `web/components/sections/HubspotSignalsSection.tsx`
- Create: `web/components/sections/HiringSignalsSection.tsx`
- Create: `web/components/sections/IntentSection.tsx`
- Create: `web/tests/components/RevenueSection.test.tsx`

**Interfaces:**
- Consumes: `BriefDetail`, `SectionPanel` (Task 3.2).
- Produces: all seven, consumed together by `app/briefs/[id]/page.tsx` (Task 3.6).

- [ ] **Step 1: Create `web/components/sections/OverviewSection.tsx`**

```tsx
import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function OverviewSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Overview" status={brief.sectionStatus.overview}>
      <p className="whitespace-pre-line text-sm text-neutral-700">{brief.overview || 'No overview found.'}</p>
    </SectionPanel>
  );
}
```

- [ ] **Step 2: Create `web/components/sections/PortfolioSection.tsx`**

```tsx
import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function PortfolioSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Portfolio / Projects" status={brief.sectionStatus.portfolio}>
      <p className="whitespace-pre-line text-sm text-neutral-700">
        {brief.portfolio || 'No portfolio/project links found on their site.'}
      </p>
    </SectionPanel>
  );
}
```

- [ ] **Step 3: Create `web/components/sections/OrgTreeSection.tsx`**

```tsx
import { SectionPanel } from '../SectionPanel';
import type { BriefDetail, OrgTreeContact } from '../../types/briefy';

function ContactList({ label, contacts }: { label: string; contacts: OrgTreeContact[] }) {
  if (!contacts.length) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <ul className="space-y-1 text-sm text-neutral-700">
        {contacts.map((c, i) => (
          <li key={i}>
            {c.name || 'Unnamed'} — {c.title || 'Unknown title'}
            {c.email ? ` · ${c.email}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrgTreeSection({ brief }: { brief: BriefDetail }) {
  const { estimators, programManagers, upperManagement } = brief.orgTree;
  const isEmpty = !estimators.length && !programManagers.length && !upperManagement.length;

  return (
    <SectionPanel title="Org Tree" status={brief.sectionStatus.orgTree}>
      {isEmpty ? (
        <p className="text-sm text-neutral-400">No contacts found.</p>
      ) : (
        <>
          <ContactList label="Upper Management" contacts={upperManagement} />
          <ContactList label="Program / Project Managers" contacts={programManagers} />
          <ContactList label="Estimators" contacts={estimators} />
        </>
      )}
    </SectionPanel>
  );
}
```

- [ ] **Step 4: Write the failing test for `RevenueSection`**

```tsx
// web/tests/components/RevenueSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevenueSection } from '../../components/sections/RevenueSection';
import type { BriefDetail } from '../../types/briefy';

function brief(overrides: Partial<BriefDetail>): BriefDetail {
  return {
    id: 'rec1', dealName: '', companyName: '', companyDomain: '', meetingDateTime: 0,
    dealStage: '', dealLink: '', briefStatus: 'Ready',
    sectionStatus: {
      overview: 'ready', portfolio: 'ready', orgTree: 'ready', revenue: 'ready',
      hubspotSignals: 'ready', hiringSignals: 'ready', intent: 'ready',
    },
    overview: '', portfolio: '', orgTree: { estimators: [], programManagers: [], upperManagement: [] },
    zoomInfoRevenue: '', clayRevenue: '', lastPageVisited: '', lastPageVisitedAt: null,
    priorDeals: [], openRoles: [], zoomInfoIntentScore: '',
    ...overrides,
  };
}

describe('RevenueSection', () => {
  it('shows a muted "Clay: pending" note distinctly from a real Clay figure, even while the section itself is ready', () => {
    render(<RevenueSection brief={brief({ zoomInfoRevenue: '$5M-$10M', clayRevenue: 'pending' })} />);
    expect(screen.getByText('$5M-$10M')).toBeTruthy();
    expect(screen.getByText(/Clay: pending/i)).toBeTruthy();
  });

  it('shows the real Clay figure once it has landed', () => {
    render(<RevenueSection brief={brief({ zoomInfoRevenue: '$5M-$10M', clayRevenue: '$7.2M' })} />);
    expect(screen.getByText(/Clay: \$7\.2M/)).toBeTruthy();
  });

  it('shows "not configured" as its own muted note, not as an error', () => {
    render(<RevenueSection brief={brief({ clayRevenue: 'not configured' })} />);
    expect(screen.getByText(/Clay: not configured/i)).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd web && npx vitest run tests/components/RevenueSection.test.tsx`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 6: Create `web/components/sections/RevenueSection.tsx`**

```tsx
import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

/** Clay Revenue is a real dollar figure, or one of two literal sentinel strings
 *  the backend writes while the async Clay enrichment is still in flight or unset
 *  (see src/briefy/sections/revenue.js) — never a section-level status by itself. */
function isSentinel(clayRevenue: string) {
  return clayRevenue === 'pending' || clayRevenue === 'not configured';
}

export function RevenueSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Revenue" status={brief.sectionStatus.revenue}>
      <p className="text-sm text-neutral-700">{brief.zoomInfoRevenue || 'Unknown (ZoomInfo)'}</p>
      <p className={`mt-1 text-xs ${isSentinel(brief.clayRevenue) ? 'text-neutral-400' : 'text-neutral-700'}`}>
        Clay: {brief.clayRevenue || 'not configured'}
      </p>
    </SectionPanel>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd web && npx vitest run tests/components/RevenueSection.test.tsx`
Expected: PASS (all 3 cases).

- [ ] **Step 8: Create `web/components/sections/HubspotSignalsSection.tsx`**

```tsx
import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function HubspotSignalsSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="HubSpot Signals" status={brief.sectionStatus.hubspotSignals}>
      <p className="text-sm text-neutral-700">
        Last page visited: {brief.lastPageVisited || 'Unknown'}
        {brief.lastPageVisitedAt ? ` (${new Date(brief.lastPageVisitedAt).toLocaleString()})` : ''}
      </p>
      {brief.priorDeals.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Prior Deals</p>
          <ul className="space-y-1 text-sm text-neutral-700">
            {brief.priorDeals.map((d, i) => (
              <li key={i}>
                <a href={d.dealLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  {d.dealName}
                </a>{' '}
                — {d.dealOwner}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionPanel>
  );
}
```

- [ ] **Step 9: Create `web/components/sections/HiringSignalsSection.tsx`**

```tsx
import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function HiringSignalsSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Hiring Signals" status={brief.sectionStatus.hiringSignals}>
      {brief.openRoles.length === 0 ? (
        <p className="text-sm text-neutral-400">No open roles found.</p>
      ) : (
        <ul className="space-y-1 text-sm text-neutral-700">
          {brief.openRoles.map((r, i) => (
            <li key={i}>
              <a href={r.link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                {r.title}
              </a>{' '}
              <span className="text-xs text-neutral-400">({r.source})</span>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}
```

- [ ] **Step 10: Create `web/components/sections/IntentSection.tsx`**

```tsx
import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function IntentSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Buying Intent" status={brief.sectionStatus.intent}>
      <p className="text-sm text-neutral-700">{brief.zoomInfoIntentScore || 'No score'}</p>
    </SectionPanel>
  );
}
```

- [ ] **Step 11: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 12: Commit**

```bash
git add web/components/sections web/tests/components/RevenueSection.test.tsx
git commit -m "feat(web): add the seven brief section components"
```

---

### Task 3.4: `GET /api/briefs/[id]` route

**Files:**
- Create: `web/app/api/briefs/[id]/route.ts`

**Interfaces:**
- Consumes: `getBriefRecordById` (Task 2.1), `recordToBriefDetail` (Task 3.1).
- Produces: `GET /api/briefs/:id` → `BriefDetail` JSON, `404` if missing or owned by a different AE, `401` unauthenticated. Consumed by Task 4.3's polling client.

- [ ] **Step 1: Create `web/app/api/briefs/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { getBriefRecordById } from '../../../../lib/airtable';
import { recordToBriefDetail } from '../../../../lib/briefs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;

  if (!session || !dealOwner) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const record = await getBriefRecordById(params.id, dealOwner);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(recordToBriefDetail(record));
}
```

- [ ] **Step 2: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/briefs
git commit -m "feat(web): add GET /api/briefs/:id, 404s on cross-owner access"
```

---

### Task 3.5: Brief detail page (server-rendered shell)

**Files:**
- Create: `web/app/briefs/[id]/page.tsx`

**Interfaces:**
- Consumes: `getBriefRecordById`, `recordToBriefDetail`, all seven section components.
- Produces: the route Task 4.4 upgrades with client-side polling — this task alone must already render a correct, complete, non-polling page.

- [ ] **Step 1: Create `web/app/briefs/[id]/page.tsx`**

```tsx
import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { authOptions } from '../../../lib/auth';
import { getBriefRecordById } from '../../../lib/airtable';
import { recordToBriefDetail } from '../../../lib/briefs';
import { OverviewSection } from '../../../components/sections/OverviewSection';
import { PortfolioSection } from '../../../components/sections/PortfolioSection';
import { OrgTreeSection } from '../../../components/sections/OrgTreeSection';
import { RevenueSection } from '../../../components/sections/RevenueSection';
import { HubspotSignalsSection } from '../../../components/sections/HubspotSignalsSection';
import { HiringSignalsSection } from '../../../components/sections/HiringSignalsSection';
import { IntentSection } from '../../../components/sections/IntentSection';

export default async function BriefDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;
  if (!session || !dealOwner) redirect('/login');

  const record = await getBriefRecordById(params.id, dealOwner);
  if (!record) notFound();

  const brief = recordToBriefDetail(record);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">{brief.companyName}</h1>
        <p className="text-sm text-neutral-500">
          {brief.dealName} · {new Date(brief.meetingDateTime).toLocaleString()}
        </p>
      </header>
      <div className="flex flex-col gap-4">
        <OverviewSection brief={brief} />
        <PortfolioSection brief={brief} />
        <OrgTreeSection brief={brief} />
        <RevenueSection brief={brief} />
        <HubspotSignalsSection brief={brief} />
        <HiringSignalsSection brief={brief} />
        <IntentSection brief={brief} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/app/briefs
git commit -m "feat(web): render the brief detail page from server-fetched data"
```

---

## Milestone 4 — Refresh Flow

**Branch:** `frontend/refresh-flow` (off `main`, after `frontend/brief-detail` is merged)

### Task 4.1: `POST /api/briefs/[id]/refresh` route

**Files:**
- Create: `web/app/api/briefs/[id]/refresh/route.ts`

**Interfaces:**
- Consumes: `setBriefStatusRefreshing` (Task 2.1).
- Produces: `POST /api/briefs/:id/refresh` → `200 { ok: true }` or `404`. Consumed by Task 4.2's `RefreshButton`.

- [ ] **Step 1: Create `web/app/api/briefs/[id]/refresh/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth';
import { setBriefStatusRefreshing } from '../../../../../lib/airtable';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;

  if (!session || !dealOwner) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const updated = await setBriefStatusRefreshing(params.id, dealOwner);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
```

Note: this only flips `Brief Status` to `"Refreshing"` — it never calls `src/briefy/engine.js` or `briefBuilder.js` directly. The already-running `engine.js` daemon picks up any row in `Refreshing` on its next poll tick (`getPendingRows()` in `src/briefy/engine.js`), exactly as `docs/superpowers/specs/2026-07-17-briefy-frontend-design.md` requires — "Airtable is the trigger" stays true for refreshes too.

- [ ] **Step 2: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/briefs
git commit -m "feat(web): add POST /api/briefs/:id/refresh, flips Brief Status only"
```

---

### Task 4.2: `RefreshButton`

**Files:**
- Create: `web/components/RefreshButton.tsx`

**Interfaces:**
- Consumes: `Button` (Task 1.4), `POST /api/briefs/:id/refresh` (Task 4.1).
- Produces: `<RefreshButton briefId briefStatus onRefreshed>` — mounted by `BriefDetailClient` (Task 4.3).

- [ ] **Step 1: Create `web/components/RefreshButton.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import type { BriefStatus } from '../types/briefy';

const IN_FLIGHT: BriefStatus[] = ['Generating', 'Refreshing'];

export function RefreshButton({
  briefId,
  briefStatus,
  onRefreshed,
}: {
  briefId: string;
  briefStatus: BriefStatus;
  onRefreshed: () => void;
}) {
  const [pending, setPending] = useState(false);
  const disabled = pending || IN_FLIGHT.includes(briefStatus);

  async function handleClick() {
    setPending(true);
    try {
      const res = await fetch(`/api/briefs/${briefId}/refresh`, { method: 'POST' });
      if (res.ok) onRefreshed();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={disabled}>
      {IN_FLIGHT.includes(briefStatus) ? 'Refreshing…' : 'Refresh brief'}
    </Button>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/components/RefreshButton.tsx
git commit -m "feat(web): add RefreshButton, disabled while a build is already in flight"
```

---

### Task 4.3: `BriefDetailClient` — background auto-polling

**Files:**
- Create: `web/components/BriefDetailClient.tsx`
- Create: `web/tests/components/BriefDetailClient.test.tsx`

**Interfaces:**
- Consumes: `BriefDetail` (types), `GET /api/briefs/:id` (Task 3.4), `RefreshButton` (Task 4.2), all seven section components (Task 3.3).
- Produces: `<BriefDetailClient initialBrief>` — the only thing `app/briefs/[id]/page.tsx` renders after Task 4.4.

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/components/BriefDetailClient.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BriefDetailClient } from '../../components/BriefDetailClient';
import type { BriefDetail } from '../../types/briefy';

function brief(overrides: Partial<BriefDetail>): BriefDetail {
  return {
    id: 'rec1', dealName: 'Acme deal', companyName: 'Acme', companyDomain: 'acme.com',
    meetingDateTime: Date.now(), dealStage: '', dealLink: '', briefStatus: 'Generating',
    sectionStatus: {
      overview: 'pending', portfolio: 'pending', orgTree: 'pending', revenue: 'pending',
      hubspotSignals: 'pending', hiringSignals: 'pending', intent: 'pending',
    },
    overview: '', portfolio: '', orgTree: { estimators: [], programManagers: [], upperManagement: [] },
    zoomInfoRevenue: '', clayRevenue: '', lastPageVisited: '', lastPageVisitedAt: null,
    priorDeals: [], openRoles: [], zoomInfoIntentScore: '',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('BriefDetailClient', () => {
  it('polls GET /api/briefs/:id while Generating and swaps in the ready data', async () => {
    const ready = brief({
      briefStatus: 'Ready',
      overview: 'Acme makes widgets.',
      sectionStatus: {
        overview: 'ready', portfolio: 'ready', orgTree: 'ready', revenue: 'ready',
        hubspotSignals: 'ready', hiringSignals: 'ready', intent: 'ready',
      },
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ready });

    render(<BriefDetailClient initialBrief={brief({})} />);

    expect(screen.getByText('Generating…')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Acme makes widgets.')).toBeTruthy(), { timeout: 3000 });
    expect(global.fetch).toHaveBeenCalledWith('/api/briefs/rec1');
  });

  it('stops polling once the brief reaches Ready', async () => {
    const ready = brief({ briefStatus: 'Ready' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ready });
    global.fetch = fetchMock;

    render(<BriefDetailClient initialBrief={brief({})} />);
    await waitFor(() => expect(screen.queryByText('Generating…')).toBeNull());

    const callsAtReady = fetchMock.mock.calls.length;
    await new Promise(r => setTimeout(r, 200));
    expect(fetchMock.mock.calls.length).toBe(callsAtReady);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/components/BriefDetailClient.test.tsx`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Create `web/components/BriefDetailClient.tsx`**

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import type { BriefDetail } from '../types/briefy';
import { RefreshButton } from './RefreshButton';
import { OverviewSection } from './sections/OverviewSection';
import { PortfolioSection } from './sections/PortfolioSection';
import { OrgTreeSection } from './sections/OrgTreeSection';
import { RevenueSection } from './sections/RevenueSection';
import { HubspotSignalsSection } from './sections/HubspotSignalsSection';
import { HiringSignalsSection } from './sections/HiringSignalsSection';
import { IntentSection } from './sections/IntentSection';

const POLL_MS = 12_000;
const IN_FLIGHT_STATUSES: BriefDetail['briefStatus'][] = ['Generating', 'Refreshing'];

export function BriefDetailClient({ initialBrief }: { initialBrief: BriefDetail }) {
  const [brief, setBrief] = useState(initialBrief);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/briefs/${brief.id}`);
    if (res.ok) setBrief(await res.json());
  }, [brief.id]);

  useEffect(() => {
    if (!IN_FLIGHT_STATUSES.includes(brief.briefStatus)) return;
    const interval = setInterval(refetch, POLL_MS);
    return () => clearInterval(interval);
  }, [brief.briefStatus, refetch]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{brief.companyName}</h1>
          <p className="text-sm text-neutral-500">
            {brief.dealName} · {new Date(brief.meetingDateTime).toLocaleString()}
          </p>
        </div>
        <RefreshButton
          briefId={brief.id}
          briefStatus={brief.briefStatus}
          onRefreshed={() => setBrief(b => ({ ...b, briefStatus: 'Refreshing' }))}
        />
      </header>
      {IN_FLIGHT_STATUSES.includes(brief.briefStatus) && (
        <p className="mb-4 text-sm text-status-pending">
          {brief.briefStatus === 'Refreshing' ? 'Refreshing…' : 'Generating…'}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <OverviewSection brief={brief} />
        <PortfolioSection brief={brief} />
        <OrgTreeSection brief={brief} />
        <RevenueSection brief={brief} />
        <HubspotSignalsSection brief={brief} />
        <HiringSignalsSection brief={brief} />
        <IntentSection brief={brief} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/components/BriefDetailClient.test.tsx`
Expected: PASS (both cases — note the polling interval is real, so the test uses `waitFor`/a real short `setTimeout` rather than fake timers, since `setInterval` + async `fetch` inside React state updates is fragile under `vi.useFakeTimers()`).

- [ ] **Step 5: Commit**

```bash
git add web/components/BriefDetailClient.tsx web/tests/components/BriefDetailClient.test.tsx
git commit -m "feat(web): add BriefDetailClient with background auto-polling during generation"
```

---

### Task 4.4: Wire the client into the detail page

**Files:**
- Modify: `web/app/briefs/[id]/page.tsx`

**Interfaces:**
- Consumes: `BriefDetailClient` (Task 4.3).

- [ ] **Step 1: Replace the body of `web/app/briefs/[id]/page.tsx`**

```tsx
import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { authOptions } from '../../../lib/auth';
import { getBriefRecordById } from '../../../lib/airtable';
import { recordToBriefDetail } from '../../../lib/briefs';
import { BriefDetailClient } from '../../../components/BriefDetailClient';

export default async function BriefDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;
  if (!session || !dealOwner) redirect('/login');

  const record = await getBriefRecordById(params.id, dealOwner);
  if (!record) notFound();

  return <BriefDetailClient initialBrief={recordToBriefDetail(record)} />;
}
```

This removes the direct section-component imports Task 3.5 added to this file — they now live inside `BriefDetailClient` (Task 4.3), which server-renders once with `initialBrief` and then takes over polling client-side.

- [ ] **Step 2: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npm test`
Expected: all tests across every task pass.

- [ ] **Step 4: Commit**

```bash
git add web/app/briefs
git commit -m "feat(web): hand the detail page off to BriefDetailClient for live polling"
```

---

### Task 4.5: Manual end-to-end verification

**Files:** none — this task only exercises the app that already exists.

- [ ] **Step 1: Add yourself to the owner map**

Edit `src/briefy/owner-map.js`, add your own `@attentive.ai` email mapped to your exact Airtable "Deal Owner" name (must match a real value already present on at least one Briefy row).

- [ ] **Step 2: Fill in `web/.env.local`**

Copy `web/.env.local.example` to `web/.env.local` and fill in real values (`AIRTABLE_API_KEY`, `BRIEFY_AIRTABLE_BASE_ID`, and real Google OAuth credentials — create an OAuth 2.0 Client ID in Google Cloud Console with `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI).

- [ ] **Step 3: Run the app locally**

Run: `cd web && npm run dev`
Then open `http://localhost:3000` — expect a redirect to `/login`.

- [ ] **Step 4: Sign in and confirm the meeting list**

Sign in with your mapped `@attentive.ai` account. Confirm you land on `/meetings` and see only meetings whose `Deal Owner` matches your mapped name, grouped by day, with "No meetings" shown for empty days.

- [ ] **Step 5: Confirm the brief detail page's live states**

Open a brief. If its `Brief Status` is `Ready`, confirm all seven sections render real content or their correct empty/error copy. If you can, manually set a row's `Brief Status` to `Not Started` in Airtable, let `npm run briefy` (the existing engine) pick it up, and confirm the detail page auto-polls and each section flips from the pending shimmer to real content without a manual reload.

- [ ] **Step 6: Confirm the refresh flow**

Click "Refresh brief" on a `Ready` brief. Confirm the button disables, `Brief Status` in Airtable flips to `Refreshing`, the page shows "Refreshing…" and auto-polls, and once the engine's next tick completes the brief, the page returns to showing all sections `ready` without a reload.

- [ ] **Step 7: Record the result**

Update `BRIEFY_PROGRESS.md`'s Frontend section with what passed/failed during this manual pass, the same way the backend's live-integration section was recorded.

---

## Self-Review Notes

- **Spec coverage:** every bullet in `docs/superpowers/specs/2026-07-17-briefy-frontend-design.md` maps to a task — auth/domain-gate (1.2–1.4), meeting window/grouping/timezone (2.3, rendered client-locale via `toLocaleTimeString`/`toLocaleDateString`, no manual override per spec), six-panel independent states + the `unavailable`-on-`Error` fallback (3.1–3.3), refresh-flips-Airtable-only + auto-poll (4.1–4.3), Railway hosting as a third service (`web/README.md`, Task 1.1).
- **Known gap between design and backend reality, called out rather than silently patched:** the design doc describes sections swapping to `ready` "independently, the instant its own `Section Status` flips" during a multi-minute wait. In the actual backend (`src/briefy/briefBuilder.js`), all seven `Section Status` keys are written in one atomic Airtable update after `Promise.all` resolves — so in practice, during a single generation/refresh, every section is `pending` together and then flips together (each still with its own independent final `ready`/`error`/`unavailable` outcome). The frontend built here fully supports true independent-timing swaps if the backend ever moves to incremental per-section writes, but don't expect staggered reveals with the backend as it exists today.
- **Type consistency checked:** `SectionKey`/`SectionStatusMap` (2.2) match the 7 keys `briefBuilder.js` actually writes; `BriefDetail` field names (3.1) match `recordToMeetingSummary`'s Airtable field names (2.3) and `scripts/setup-briefy-table.js`'s schema exactly; `deriveSectionState`'s signature is identical everywhere it's called (3.4, 4.1's route doesn't call it directly but shares `recordToBriefDetail`).
- **No placeholders:** every step above has real, complete code — nothing marked TBD/TODO.
