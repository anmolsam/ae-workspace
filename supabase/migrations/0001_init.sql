-- ae-workspace initial schema.
-- The API (service role) is the trusted layer and enforces per-AE scoping via
-- owner_id on every query. RLS is enabled and DENIES all anon/authenticated
-- direct access as defense-in-depth: even a leaked anon key cannot read another
-- AE's rows, because the browser never queries these tables directly.

-- ── AE identity: Google-SSO email ↔ HubSpot owner id ─────────────────────────
create table if not exists ae_identities (
  id               uuid primary key default gen_random_uuid(),
  supabase_user_id uuid,
  email            text unique not null,
  owner_id         text not null,            -- HubSpot owner id (ROMA + HubSpot key)
  ae_name          text,
  role             text not null default 'AE', -- AE | TEAM_LEAD | REVOPS_ADMIN | SALES_LEADERSHIP
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ae_identities_owner_idx on ae_identities(owner_id);

-- ── Follow-up tasks: app-local state layered over HubSpot/ROMA ────────────────
create table if not exists follow_up_tasks (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 text not null,     -- HubSpot owner id (isolation key)
  deal_id                  text not null,
  company_name             text,
  deal_name                text,
  stage_label              text,
  track                    text not null,     -- DS | DO | OI
  slot                     int  not null,     -- 0..4
  follow_up_label          text,
  draft                    text,
  draft_generated_at       timestamptz,
  overdue_at               timestamptz,       -- draft_generated_at + 24h
  hubspot_deal_url         text,
  state                    text not null default 'ACTIVE',
  manual_checked_at        timestamptz,
  verified_completed_at    timestamptz,
  completion_activity_type text,
  last_verified_at         timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (owner_id, deal_id, track, slot)     -- natural key => idempotent upserts
);
create index if not exists fut_owner_state_idx on follow_up_tasks(owner_id, state);

-- ── Briefy: meetings' pre-call briefs (dynamic sections) ─────────────────────
create table if not exists pre_call_briefs (
  id           uuid primary key default gen_random_uuid(),
  owner_id     text not null,
  meeting_id   text not null,                 -- Google Calendar event id
  job_status   text not null default 'queued',-- queued | processing | completed | failed
  error        text,
  generated_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (owner_id, meeting_id)
);

create table if not exists brief_sections (
  id       uuid primary key default gen_random_uuid(),
  brief_id uuid not null references pre_call_briefs(id) on delete cascade,
  key      text not null,
  title    text not null,
  "order"  int  not null default 0,
  kind     text not null default 'markdown',  -- markdown | list | keyvalue
  content  jsonb
);
create index if not exists brief_sections_brief_idx on brief_sections(brief_id);

create table if not exists research_sources (
  id         uuid primary key default gen_random_uuid(),
  brief_id   uuid not null references pre_call_briefs(id) on delete cascade,
  provider   text not null,                   -- jina | exa | zoominfo | seamless
  kind       text not null,                   -- company | person
  fetched_at timestamptz
);

-- ── RLS: deny direct client access; service role bypasses RLS ────────────────
alter table ae_identities   enable row level security;
alter table follow_up_tasks enable row level security;
alter table pre_call_briefs enable row level security;
alter table brief_sections  enable row level security;
alter table research_sources enable row level security;
-- No permissive policies are created => anon/authenticated clients get zero rows.
-- All access flows through the API using the service-role key.
