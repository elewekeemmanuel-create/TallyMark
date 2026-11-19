-- Tallymark Phase 4: First-Party Privacy-Safe Analytics Events
-- Stores only anonymous event name, clean route path, and timestamp.
-- Strictly zero personal data (no IP address, no user-agent, no emails, no user IDs).

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (
    char_length(event_name) between 2 and 64
    and event_name ~ '^[a-z0-9_]+$'
  ),
  path text not null default '/' check (
    char_length(path) between 1 and 120
    and path like '/%'
  ),
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_created_at
  on public.analytics_events (created_at desc);

alter table public.analytics_events enable row level security;

-- Allow the landing site or logged-in app to log anonymous events; keep reads restricted to service_role.
drop policy if exists "Allow anonymous non-PII analytics inserts" on public.analytics_events;
create policy "Allow anonymous non-PII analytics inserts"
  on public.analytics_events
  for insert
  to anon, authenticated
  with check (
    char_length(event_name) between 2 and 64
    and path like '/%'
  );
