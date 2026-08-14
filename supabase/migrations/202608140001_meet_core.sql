create extension if not exists pgcrypto with schema extensions;

create schema if not exists private_meet;
revoke all on schema private_meet from public, anon, authenticated;

create table public.organisations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, created_by)
);

create table public.organisation_memberships (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'organiser', 'marshal', 'viewer')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (organisation_id, user_id),
  unique (organisation_id, user_id, role)
);

create index organisation_memberships_user_active_idx
  on public.organisation_memberships (user_id, organisation_id)
  where status = 'active';

create table public.organisation_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'organiser', 'marshal', 'viewer')),
  code_digest text not null unique check (code_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at),
  check ((used_at is null) = (used_by is null)),
  check (used_at is null or revoked_at is null),
  unique (organisation_id, request_id)
);

create index organisation_invitations_active_digest_idx
  on public.organisation_invitations (code_digest, expires_at)
  where used_at is null and revoked_at is null;

create table public.meets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  venue text not null default '' check (char_length(venue) <= 200),
  meet_date date not null,
  status text not null default 'setup' check (status in ('setup', 'running', 'completed')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 65536),
  created_by uuid not null references auth.users(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (organisation_id, id)
);

create index meets_organisation_date_idx on public.meets (organisation_id, meet_date desc, id);

create table public.brackets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  meet_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  stage text not null check (stage in ('qualifier', 'semifinal', 'final')),
  display_order integer not null check (display_order between 1 and 1000),
  status text not null default 'setup' check (status in ('setup', 'running', 'completed')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 65536),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, meet_id) references public.meets(organisation_id, id) on delete cascade,
  unique (organisation_id, id),
  unique (meet_id, display_order)
);

create index brackets_meet_stage_idx on public.brackets (meet_id, stage, display_order);

create table public.participants (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  bracket_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  email text not null default '' check (char_length(email) <= 320),
  phone text not null default '' check (char_length(phone) <= 50),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, bracket_id) references public.brackets(organisation_id, id) on delete cascade,
  unique (organisation_id, bracket_id, id)
);

create index participants_bracket_name_idx on public.participants (bracket_id, name, id);

create table public.cars (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  bracket_id uuid not null,
  participant_id uuid not null,
  car_number integer not null check (car_number between 1 and 999999),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  active boolean not null default true,
  source_bracket_id uuid,
  source_car_id uuid,
  rule_id uuid,
  snapshot_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, bracket_id, participant_id)
    references public.participants(organisation_id, bracket_id, id) on delete cascade,
  unique (organisation_id, bracket_id, id),
  unique (bracket_id, car_number),
  unique (snapshot_id, rule_id, source_car_id),
  check (num_nonnulls(source_bracket_id, source_car_id, rule_id, snapshot_id) in (0, 4))
);

create index cars_bracket_active_idx on public.cars (bracket_id, active, car_number, id);

create table public.heats (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  bracket_id uuid not null,
  round_number integer not null check (round_number between 1 and 10000),
  heat_number integer not null check (heat_number between 1 and 100000),
  phase text not null default 'preliminary' check (phase in ('preliminary', 'final')),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  lane_1_car_id uuid not null,
  lane_2_car_id uuid,
  lane_3_car_id uuid,
  winner_car_id uuid,
  lane_1_time numeric(12, 3) check (lane_1_time > 0),
  lane_2_time numeric(12, 3) check (lane_2_time > 0),
  lane_3_time numeric(12, 3) check (lane_3_time > 0),
  version integer not null default 1 check (version > 0),
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, bracket_id) references public.brackets(organisation_id, id) on delete cascade,
  foreign key (organisation_id, bracket_id, lane_1_car_id) references public.cars(organisation_id, bracket_id, id) on delete restrict,
  foreign key (organisation_id, bracket_id, lane_2_car_id) references public.cars(organisation_id, bracket_id, id) on delete restrict,
  foreign key (organisation_id, bracket_id, lane_3_car_id) references public.cars(organisation_id, bracket_id, id) on delete restrict,
  foreign key (organisation_id, bracket_id, winner_car_id) references public.cars(organisation_id, bracket_id, id) on delete restrict,
  unique (bracket_id, round_number, heat_number),
  check (lane_2_car_id is null or lane_2_car_id <> lane_1_car_id),
  check (lane_3_car_id is null or (lane_3_car_id <> lane_1_car_id and lane_3_car_id is distinct from lane_2_car_id)),
  check (winner_car_id is null or winner_car_id in (lane_1_car_id, lane_2_car_id, lane_3_car_id)),
  check ((status = 'pending' and winner_car_id is null) or (status = 'confirmed' and winner_car_id is not null)),
  check ((confirmed_at is null) = (confirmed_by is null))
);

create index heats_bracket_schedule_idx on public.heats (bracket_id, round_number, heat_number);

create table public.advancement_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  meet_id uuid not null,
  source_bracket_id uuid not null,
  top_n integer not null check (top_n between 1 and 10000),
  destination_capacity integer not null check (destination_capacity between 1 and 10000),
  status text not null default 'active' check (status in ('active', 'disabled')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, meet_id) references public.meets(organisation_id, id) on delete cascade,
  foreign key (organisation_id, source_bracket_id) references public.brackets(organisation_id, id) on delete cascade,
  unique (organisation_id, id)
);

create index advancement_rules_source_idx on public.advancement_rules (source_bracket_id, status, id);

create table public.advancement_rule_destinations (
  organisation_id uuid not null,
  rule_id uuid not null,
  destination_bracket_id uuid not null,
  destination_order integer not null check (destination_order between 1 and 100),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, rule_id) references public.advancement_rules(organisation_id, id) on delete cascade,
  foreign key (organisation_id, destination_bracket_id) references public.brackets(organisation_id, id) on delete restrict,
  primary key (rule_id, destination_bracket_id),
  unique (rule_id, destination_order)
);

create table public.advancement_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  meet_id uuid not null,
  rule_id uuid not null,
  source_bracket_id uuid not null,
  source_result_version integer not null check (source_result_version > 0),
  stale boolean not null default false,
  replaced_by_snapshot_id uuid,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 500),
  request_id uuid not null,
  confirmed_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, meet_id) references public.meets(organisation_id, id) on delete cascade,
  foreign key (organisation_id, rule_id) references public.advancement_rules(organisation_id, id) on delete restrict,
  foreign key (organisation_id, source_bracket_id) references public.brackets(organisation_id, id) on delete restrict,
  unique (organisation_id, id),
  unique (organisation_id, id, rule_id, source_bracket_id),
  unique (organisation_id, request_id)
);

alter table public.advancement_snapshots
  add constraint advancement_snapshots_replaced_by_fk
  foreign key (organisation_id, replaced_by_snapshot_id)
  references public.advancement_snapshots(organisation_id, id) on delete restrict
  deferrable initially deferred;

create unique index advancement_snapshots_one_current_rule_idx
  on public.advancement_snapshots (rule_id)
  where replaced_by_snapshot_id is null;

create index advancement_snapshots_source_version_idx
  on public.advancement_snapshots (source_bracket_id, source_result_version, stale);

create table public.advancement_selections (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  snapshot_id uuid not null,
  rule_id uuid not null,
  source_bracket_id uuid not null,
  source_car_id uuid not null,
  destination_bracket_id uuid not null,
  destination_car_id uuid,
  rank integer not null check (rank between 1 and 10000),
  selected_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, snapshot_id, rule_id, source_bracket_id)
    references public.advancement_snapshots(organisation_id, id, rule_id, source_bracket_id) on delete restrict,
  foreign key (organisation_id, source_bracket_id, source_car_id)
    references public.cars(organisation_id, bracket_id, id) on delete restrict,
  foreign key (organisation_id, destination_bracket_id)
    references public.brackets(organisation_id, id) on delete restrict,
  foreign key (destination_car_id)
    references public.cars(id) on delete set null,
  unique (snapshot_id, rule_id, source_car_id),
  unique (snapshot_id, destination_car_id)
);

alter table public.cars
  add constraint cars_source_lineage_fk
  foreign key (organisation_id, source_bracket_id, source_car_id)
  references public.cars(organisation_id, bracket_id, id) on delete restrict;

alter table public.cars
  add constraint cars_snapshot_lineage_fk
  foreign key (organisation_id, snapshot_id, rule_id, source_bracket_id)
  references public.advancement_snapshots(organisation_id, id, rule_id, source_bracket_id) on delete restrict;

create table public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  meet_id uuid,
  bracket_id uuid,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(btrim(action)) between 1 and 128),
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 128),
  entity_id uuid not null,
  before_state jsonb not null default '{}'::jsonb check (pg_column_size(before_state) <= 65536),
  after_state jsonb not null default '{}'::jsonb check (pg_column_size(after_state) <= 65536),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 500),
  request_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  foreign key (organisation_id, meet_id) references public.meets(organisation_id, id) on delete cascade,
  foreign key (organisation_id, bracket_id) references public.brackets(organisation_id, id) on delete cascade,
  unique (organisation_id, request_id, action)
);

create index audit_events_org_time_idx on public.audit_events (organisation_id, occurred_at desc, id);
create index audit_events_meet_time_idx on public.audit_events (meet_id, occurred_at desc, id);

create table public.security_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (char_length(btrim(event_type)) between 1 and 128),
  subject_user_id uuid references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 16384),
  occurred_at timestamptz not null default statement_timestamp()
);

create index security_events_org_time_idx on public.security_events (organisation_id, occurred_at desc, id);

create table public.mutation_rate_limits (
  organisation_id uuid references public.organisations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(btrim(action)) between 1 and 128),
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count between 1 and 100000),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (actor_id, action, window_started_at)
);

create or replace function private_meet.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger organisations_set_updated_at before update on public.organisations
for each row execute function private_meet.set_updated_at();
create trigger memberships_set_updated_at before update on public.organisation_memberships
for each row execute function private_meet.set_updated_at();
create trigger meets_set_updated_at before update on public.meets
for each row execute function private_meet.set_updated_at();
create trigger brackets_set_updated_at before update on public.brackets
for each row execute function private_meet.set_updated_at();
create trigger participants_set_updated_at before update on public.participants
for each row execute function private_meet.set_updated_at();
create trigger cars_set_updated_at before update on public.cars
for each row execute function private_meet.set_updated_at();
create trigger heats_set_updated_at before update on public.heats
for each row execute function private_meet.set_updated_at();
create trigger advancement_rules_set_updated_at before update on public.advancement_rules
for each row execute function private_meet.set_updated_at();

comment on table public.organisation_invitations is 'Stores invitation SHA-256 digests only; raw codes are returned once and never persisted.';
comment on table public.advancement_snapshots is 'Immutable advancement decision; replacement links the old snapshot to a new snapshot.';
comment on table public.audit_events is 'Append-only, same-transaction audit records for important Meet mutations.';
