create table if not exists public.learning_events (
  server_seq bigint generated always as identity primary key,
  event_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  client_seq bigint not null,
  occurred_at timestamptz not null,
  event_type text not null,
  dataset_id text,
  lesson_id text,
  position_id text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists learning_events_user_cursor_idx
  on public.learning_events (user_id, server_seq);

alter table public.learning_events enable row level security;

drop policy if exists "users read own learning events" on public.learning_events;
create policy "users read own learning events"
  on public.learning_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users insert own learning events" on public.learning_events;
create policy "users insert own learning events"
  on public.learning_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.learning_events to authenticated;
grant usage, select on sequence public.learning_events_server_seq_seq to authenticated;

create table if not exists public.user_learning_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  experience text not null default 'new' check (experience in ('new', 'regular', 'competitive')),
  daily_minutes integer not null default 10 check (daily_minutes between 5 and 60),
  updated_at timestamptz not null default now()
);

alter table public.user_learning_profiles enable row level security;

drop policy if exists "users manage own learning profile" on public.user_learning_profiles;
create policy "users manage own learning profile"
  on public.user_learning_profiles for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_learning_profiles to authenticated;
