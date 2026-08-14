-- REVIEW HARDENING V4

alter table public.brackets
  add constraint brackets_organisation_meet_id_key unique (organisation_id, meet_id, id);

alter table public.advancement_rules
  add constraint advancement_rules_organisation_meet_id_key unique (organisation_id, meet_id, id);
alter table public.advancement_rules
  add constraint advancement_rules_source_same_meet_fk
  foreign key (organisation_id, meet_id, source_bracket_id)
  references public.brackets(organisation_id, meet_id, id) on delete cascade;

alter table public.advancement_rule_destinations add column meet_id uuid;
update public.advancement_rule_destinations destination
set meet_id = rule.meet_id
from public.advancement_rules rule
where rule.id = destination.rule_id and rule.organisation_id = destination.organisation_id;
alter table public.advancement_rule_destinations alter column meet_id set not null;
alter table public.advancement_rule_destinations
  add constraint advancement_rule_destinations_rule_same_meet_fk
  foreign key (organisation_id, meet_id, rule_id)
  references public.advancement_rules(organisation_id, meet_id, id) on delete cascade;
alter table public.advancement_rule_destinations
  add constraint advancement_rule_destinations_same_meet_fk
  foreign key (organisation_id, meet_id, destination_bracket_id)
  references public.brackets(organisation_id, meet_id, id) on delete restrict;

alter table public.advancement_snapshots
  add constraint advancement_snapshots_organisation_meet_lineage_key
  unique (organisation_id, meet_id, id, rule_id, source_bracket_id);
alter table public.advancement_snapshots
  add constraint advancement_snapshots_rule_same_meet_fk
  foreign key (organisation_id, meet_id, rule_id)
  references public.advancement_rules(organisation_id, meet_id, id) on delete restrict;
alter table public.advancement_snapshots
  add constraint advancement_snapshots_source_same_meet_fk
  foreign key (organisation_id, meet_id, source_bracket_id)
  references public.brackets(organisation_id, meet_id, id) on delete restrict;

alter table public.advancement_selections add column meet_id uuid;
update public.advancement_selections selection
set meet_id = snapshot.meet_id
from public.advancement_snapshots snapshot
where snapshot.id = selection.snapshot_id and snapshot.organisation_id = selection.organisation_id;
alter table public.advancement_selections alter column meet_id set not null;
alter table public.advancement_selections
  add constraint advancement_selections_snapshot_same_meet_fk
  foreign key (organisation_id, meet_id, snapshot_id, rule_id, source_bracket_id)
  references public.advancement_snapshots(organisation_id, meet_id, id, rule_id, source_bracket_id) on delete restrict;
alter table public.advancement_selections
  add constraint advancement_selections_source_same_meet_fk
  foreign key (organisation_id, meet_id, source_bracket_id)
  references public.brackets(organisation_id, meet_id, id) on delete restrict;
alter table public.advancement_selections
  add constraint advancement_selections_destination_same_meet_fk
  foreign key (organisation_id, meet_id, destination_bracket_id)
  references public.brackets(organisation_id, meet_id, id) on delete restrict;

create unique index cars_one_active_source_lineage
  on public.cars (source_bracket_id, source_car_id)
  where source_car_id is not null and active;

alter table public.heats
  add constraint heats_lane_2_time_requires_car check (lane_2_car_id is not null or lane_2_time is null),
  add constraint heats_lane_3_time_requires_car check (lane_3_car_id is not null or lane_3_time is null);

alter table public.security_events add column request_id uuid;
update public.security_events set request_id = extensions.gen_random_uuid() where request_id is null;
alter table public.security_events alter column request_id set not null;
alter table public.security_events alter column request_id set default extensions.gen_random_uuid();
alter table public.security_events
  add constraint security_events_request_key unique (organisation_id, request_id, event_type);

revoke insert on public.heats from authenticated;
grant insert (organisation_id, bracket_id, round_number, heat_number, phase, lane_1_car_id, lane_2_car_id, lane_3_car_id)
  on public.heats to authenticated;
revoke delete on public.meets, public.brackets, public.participants, public.cars, public.heats,
  public.advancement_rules, public.advancement_rule_destinations from authenticated;

create or replace function private_meet.bump_direct_row_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create or replace function private_meet.audit_direct_meet_mutation(
  table_name text,
  operation text,
  before_state jsonb,
  after_state jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  row_state jsonb := coalesce(after_state, before_state);
  organisation_id uuid := (row_state->>'organisation_id')::uuid;
  meet_id uuid;
  bracket_id uuid;
  entity_id uuid;
  action_name text;
begin
  if pg_trigger_depth() = 0 or actor is null then
    raise exception using message = 'MEET_TRIGGER_CONTEXT_REQUIRED';
  end if;
  if table_name = 'organisations' then
    organisation_id := (row_state->>'id')::uuid;
    entity_id := organisation_id;
  elsif table_name = 'meets' then
    meet_id := (row_state->>'id')::uuid;
    entity_id := meet_id;
  elsif table_name = 'brackets' then
    meet_id := (row_state->>'meet_id')::uuid;
    bracket_id := (row_state->>'id')::uuid;
    entity_id := bracket_id;
    update public.meets set version = version + 1 where id = meet_id;
  elsif table_name in ('participants', 'cars', 'heats') then
    bracket_id := (row_state->>'bracket_id')::uuid;
    entity_id := (row_state->>'id')::uuid;
    select bracket.meet_id into meet_id from public.brackets bracket where bracket.id = bracket_id;
    update public.brackets set version = version + 1 where id = bracket_id;
    update public.meets set version = version + 1 where id = meet_id;
  elsif table_name = 'advancement_rules' then
    meet_id := (row_state->>'meet_id')::uuid;
    bracket_id := (row_state->>'source_bracket_id')::uuid;
    entity_id := (row_state->>'id')::uuid;
    update public.brackets set version = version + 1 where id = bracket_id;
    update public.meets set version = version + 1 where id = meet_id;
  elsif table_name = 'advancement_rule_destinations' then
    meet_id := (row_state->>'meet_id')::uuid;
    entity_id := (row_state->>'rule_id')::uuid;
    select rule.source_bracket_id into bracket_id
    from public.advancement_rules rule where rule.id = entity_id;
    update public.brackets set version = version + 1 where id = bracket_id;
    update public.meets set version = version + 1 where id = meet_id;
  else
    raise exception using message = 'MEET_UNSUPPORTED_DIRECT_MUTATION';
  end if;
  action_name := case table_name || ':' || operation
    when 'organisations:INSERT' then 'organisation.inserted' when 'organisations:UPDATE' then 'organisation.updated'
    when 'meets:INSERT' then 'meet.inserted' when 'meets:UPDATE' then 'meet.updated'
    when 'brackets:INSERT' then 'bracket.inserted' when 'brackets:UPDATE' then 'bracket.updated'
    when 'participants:INSERT' then 'participant.inserted' when 'participants:UPDATE' then 'participant.updated'
    when 'cars:INSERT' then 'car.inserted' when 'cars:UPDATE' then 'car.updated'
    when 'heats:INSERT' then 'heat.schedule_inserted' when 'heats:UPDATE' then 'heat.schedule_updated'
    when 'advancement_rules:INSERT' then 'advancement_rule.inserted' when 'advancement_rules:UPDATE' then 'advancement_rule.updated'
    when 'advancement_rule_destinations:INSERT' then 'advancement_destination.inserted'
    else 'advancement_destination.updated'
  end;
  insert into public.audit_events
    (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
     before_state, after_state, request_id)
  values (organisation_id, meet_id, bracket_id, actor, action_name, table_name, entity_id,
    coalesce(before_state, '{}'::jsonb), coalesce(after_state, '{}'::jsonb), extensions.gen_random_uuid());
end;
$$;

create or replace function private_meet.capture_direct_meet_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    perform private_meet.audit_direct_meet_mutation(
      tg_table_name, tg_op,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      case when tg_op = 'DELETE' then null else to_jsonb(new) end
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organisations_direct_version before update on public.organisations
for each row execute function private_meet.bump_direct_row_version();
create trigger meets_direct_version before update on public.meets
for each row execute function private_meet.bump_direct_row_version();
create trigger brackets_direct_version before update on public.brackets
for each row execute function private_meet.bump_direct_row_version();
create trigger heats_direct_version before update on public.heats
for each row execute function private_meet.bump_direct_row_version();
create trigger advancement_rules_direct_version before update on public.advancement_rules
for each row execute function private_meet.bump_direct_row_version();

create trigger organisations_direct_audit after insert or update on public.organisations
for each row execute function private_meet.capture_direct_meet_mutation();
create trigger meets_direct_audit after insert or update on public.meets
for each row execute function private_meet.capture_direct_meet_mutation();
create trigger brackets_direct_audit after insert or update on public.brackets
for each row execute function private_meet.capture_direct_meet_mutation();
create trigger participants_direct_audit after insert or update on public.participants
for each row execute function private_meet.capture_direct_meet_mutation();
create trigger cars_direct_audit after insert or update on public.cars
for each row execute function private_meet.capture_direct_meet_mutation();
create trigger heats_direct_audit after insert or update on public.heats
for each row execute function private_meet.capture_direct_meet_mutation();
create trigger advancement_rules_direct_audit after insert or update on public.advancement_rules
for each row execute function private_meet.capture_direct_meet_mutation();
create trigger advancement_destinations_direct_audit after insert or update on public.advancement_rule_destinations
for each row execute function private_meet.capture_direct_meet_mutation();

grant execute on function private_meet.audit_direct_meet_mutation(text, text, jsonb, jsonb) to authenticated;
revoke execute on function private_meet.bump_direct_row_version() from public, anon, authenticated;
revoke execute on function private_meet.capture_direct_meet_mutation() from public, anon, authenticated;

alter publication supabase_realtime add table public.meets;
alter publication supabase_realtime add table public.brackets;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.cars;
alter publication supabase_realtime add table public.heats;
alter publication supabase_realtime add table public.advancement_rules;
alter publication supabase_realtime add table public.advancement_rule_destinations;
alter publication supabase_realtime add table public.advancement_snapshots;
alter publication supabase_realtime add table public.advancement_selections;
alter publication supabase_realtime add table public.audit_events;
alter publication supabase_realtime add table public.security_events;

create or replace function private_meet.consume_rate_limit_result(
  target_organisation_id uuid,
  rate_action text,
  maximum_attempts integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  current_window timestamptz := date_trunc('minute', statement_timestamp());
  attempts integer;
begin
  if actor is null then return false; end if;
  insert into public.mutation_rate_limits
    (organisation_id, actor_id, action, window_started_at, attempt_count)
  values (target_organisation_id, actor, rate_action, current_window, 1)
  on conflict (actor_id, action, window_started_at)
  do update set attempt_count = public.mutation_rate_limits.attempt_count + 1,
                updated_at = statement_timestamp()
  returning attempt_count into attempts;
  return attempts <= maximum_attempts;
end;
$$;

create or replace function public.redeem_invitation(invitation_code text, request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  invitation public.organisation_invitations%rowtype;
  existing jsonb;
  invitation_failure_result jsonb := jsonb_build_object('ok', false, 'code', 'MEET_INVITATION_UNAVAILABLE');
  rate_limit_result jsonb := jsonb_build_object('ok', false, 'code', 'MEET_RATE_LIMITED');
begin
  if actor is null then raise exception using message = 'MEET_AUTH_REQUIRED'; end if;
  select event.after_state into existing from public.audit_events event
  where event.actor_id = actor and event.request_id = redeem_invitation.request_id
    and event.action = 'invitation.redeemed';
  if existing is not null then return existing; end if;
  if not private_meet.consume_rate_limit_result(null, 'redeem_invitation', 10) then
    return rate_limit_result;
  end if;
  select candidate.* into invitation
  from public.organisation_invitations candidate
  where candidate.code_digest = encode(extensions.digest(invitation_code, 'sha256'), 'hex')
  for update;
  if not found or invitation.used_at is not null or invitation.revoked_at is not null
     or invitation.expires_at <= statement_timestamp() then
    return invitation_failure_result;
  end if;
  insert into public.organisation_memberships (organisation_id, user_id, role)
  values (invitation.organisation_id, actor, invitation.role)
  on conflict (organisation_id, user_id) do nothing;
  update public.organisation_invitations
  set used_at = statement_timestamp(), used_by = actor
  where id = invitation.id;
  existing := jsonb_build_object('ok', true, 'organisation_id', invitation.organisation_id, 'role', invitation.role);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, after_state, request_id)
  values (invitation.organisation_id, actor, 'invitation.redeemed', 'organisation_invitation', invitation.id, existing, request_id);
  insert into public.security_events (organisation_id, actor_id, event_type, subject_user_id, request_id, metadata)
  values (invitation.organisation_id, actor, 'invitation.redeemed', actor, request_id, jsonb_build_object('invitation_id', invitation.id));
  return existing;
end;
$$;

create or replace function public.remove_membership(
  target_organisation_id uuid,
  target_user_id uuid,
  reason text,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  membership public.organisation_memberships%rowtype;
  result jsonb;
  owner_count integer;
begin
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  select event.after_state into result from public.audit_events event
  where event.organisation_id = target_organisation_id and event.request_id = remove_membership.request_id
    and event.action = 'membership.removed';
  if result is not null then return result; end if;
  if reason is null or char_length(btrim(reason)) not between 1 and 500 then
    raise exception using message = 'MEET_REASON_REQUIRED';
  end if;
  lock table public.organisations in row exclusive mode;
  perform organisation.id from public.organisations organisation
  where organisation.id = target_organisation_id for update;
  perform 1 from public.organisation_memberships membership
  where membership.organisation_id = target_organisation_id and membership.role = 'owner' and membership.status = 'active'
  order by membership.user_id for update;
  select candidate.* into membership from public.organisation_memberships candidate
  where candidate.organisation_id = target_organisation_id and candidate.user_id = target_user_id for update;
  if not found then raise exception using message = 'MEET_MEMBERSHIP_NOT_FOUND'; end if;
  if membership.role = 'owner' and not private_meet.has_org_role(target_organisation_id, array['owner']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  select count(*) into owner_count from public.organisation_memberships owner_membership
  where owner_membership.organisation_id = target_organisation_id
    and owner_membership.role = 'owner' and owner_membership.status = 'active';
  if membership.role = 'owner' and membership.status = 'active' and owner_count <= 1 then
    raise exception using message = 'MEET_LAST_OWNER';
  end if;
  delete from public.organisation_memberships
  where organisation_id = target_organisation_id and user_id = target_user_id;
  result := jsonb_build_object('organisation_id', target_organisation_id, 'user_id', target_user_id, 'removed', true);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, request_id)
  values (target_organisation_id, actor, 'membership.removed', 'organisation_membership', target_user_id,
    to_jsonb(membership), result, btrim(reason), request_id);
  insert into public.security_events (organisation_id, actor_id, event_type, subject_user_id, request_id, metadata)
  values (target_organisation_id, actor, 'membership.removed', target_user_id, request_id, jsonb_build_object('reason', btrim(reason)));
  return result;
end;
$$;

create or replace function public.record_security_event(
  target_organisation_id uuid,
  event_name text,
  subject_user_id uuid,
  event_metadata jsonb,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  existing public.security_events%rowtype;
  result jsonb;
begin
  if actor is null or not private_meet.is_org_member(target_organisation_id) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if event_name not in ('account.sign_in', 'account.password_changed', 'account.recovery_completed', 'account.email_confirmed') then
    raise exception using message = 'MEET_SECURITY_EVENT_NOT_ALLOWED';
  end if;
  if subject_user_id is not null and subject_user_id <> actor then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if event_metadata is null or jsonb_typeof(event_metadata) <> 'object' or pg_column_size(event_metadata) > 16384 then
    raise exception using message = 'MEET_INVALID_SECURITY_METADATA';
  end if;
  select event.* into existing from public.security_events event
  where event.organisation_id = target_organisation_id and event.request_id = record_security_event.request_id
    and event.event_type = event_name;
  if found then
    return jsonb_build_object('ok', true, 'security_event_id', existing.id, 'event_type', existing.event_type);
  end if;
  if not private_meet.consume_rate_limit_result(target_organisation_id, 'record_security_event', 20) then
    return jsonb_build_object('ok', false, 'code', 'MEET_RATE_LIMITED');
  end if;
  insert into public.security_events
    (organisation_id, actor_id, event_type, subject_user_id, request_id, metadata)
  values (target_organisation_id, actor, event_name, coalesce(subject_user_id, actor), request_id, event_metadata)
  returning * into existing;
  result := jsonb_build_object('ok', true, 'security_event_id', existing.id, 'event_type', existing.event_type);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, after_state, request_id)
  values (target_organisation_id, actor, 'security_event.recorded', 'security_event', existing.id, result, request_id);
  return result;
end;
$$;

create or replace function private_meet.write_heat_winner(
  heat_id uuid,
  winner_id uuid,
  lane_times jsonb,
  expected_version integer,
  reason text,
  request_id uuid,
  correction boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  heat record;
  result jsonb;
  action_name text := case when correction then 'heat.winner_corrected' else 'heat.winner_confirmed' end;
  before_value jsonb;
begin
  select h.*, b.status as bracket_status, b.meet_id, m.status as meet_status
  into heat
  from public.heats h
  join public.brackets b on b.id = h.bracket_id and b.organisation_id = h.organisation_id
  join public.meets m on m.id = b.meet_id and m.organisation_id = b.organisation_id
  where h.id = heat_id
  for update of h, b;
  if not found then raise exception using message = 'MEET_HEAT_NOT_FOUND'; end if;
  if not private_meet.has_org_role(heat.organisation_id, array['owner', 'admin', 'organiser', 'marshal']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  select event.after_state into result from public.audit_events event
  where event.organisation_id = heat.organisation_id and event.request_id = write_heat_winner.request_id
    and event.action = action_name;
  if result is not null then return result; end if;
  if heat.version <> expected_version then raise exception using message = 'MEET_VERSION_CONFLICT'; end if;
  if heat.meet_status not in ('running', 'completed') or heat.bracket_status not in ('running', 'completed') then
    raise exception using message = 'MEET_STATUS_CONFLICT';
  end if;
  if (not correction and heat.status <> 'pending') or (correction and heat.status <> 'confirmed') then
    raise exception using message = 'MEET_RESULT_STATE_CONFLICT';
  end if;
  if winner_id is distinct from heat.lane_1_car_id and winner_id is distinct from heat.lane_2_car_id
     and winner_id is distinct from heat.lane_3_car_id then
    raise exception using message = 'MEET_WINNER_NOT_ASSIGNED';
  end if;
  if correction and (reason is null or char_length(btrim(reason)) not between 1 and 500) then
    raise exception using message = 'MEET_REASON_REQUIRED';
  end if;
  if lane_times is not null and (
    jsonb_typeof(lane_times) <> 'object'
    or exists (select 1 from jsonb_object_keys(lane_times) key where key not in ('lane1', 'lane2', 'lane3'))
    or exists (select 1 from jsonb_each_text(lane_times) item
      where item.value is not null and (item.value !~ '^[0-9]+(?:\.[0-9]{1,3})?$' or item.value::numeric <= 0 or item.value::numeric > 86400))
    or (heat.lane_2_car_id is null and lane_times ? 'lane2' and lane_times->'lane2' <> 'null'::jsonb)
    or (heat.lane_3_car_id is null and lane_times ? 'lane3' and lane_times->'lane3' <> 'null'::jsonb)
  ) then raise exception using message = 'MEET_INVALID_LANE_TIMES'; end if;
  before_value := jsonb_build_object('winner_car_id', heat.winner_car_id, 'version', heat.version,
    'lane1', heat.lane_1_time, 'lane2', heat.lane_2_time, 'lane3', heat.lane_3_time);
  update public.heats set
    status = 'confirmed', winner_car_id = winner_id,
    lane_1_time = case when lane_times ? 'lane1' then (lane_times->>'lane1')::numeric else lane_1_time end,
    lane_2_time = case when lane_times ? 'lane2' then (lane_times->>'lane2')::numeric else lane_2_time end,
    lane_3_time = case when lane_times ? 'lane3' then (lane_times->>'lane3')::numeric else lane_3_time end,
    version = version + 1, confirmed_by = actor, confirmed_at = statement_timestamp()
  where id = heat_id;
  update public.brackets set version = version + 1 where id = heat.bracket_id;
  update public.meets set version = version + 1 where id = heat.meet_id;
  with recursive stale_chain(id) as (
    select snapshot.id from public.advancement_snapshots snapshot
    where snapshot.source_bracket_id = heat.bracket_id and snapshot.replaced_by_snapshot_id is null
    union
    select snapshot.id from public.advancement_snapshots snapshot
    join public.cars source_car on source_car.bracket_id = snapshot.source_bracket_id and source_car.active
    join stale_chain upstream on upstream.id = source_car.snapshot_id
    where snapshot.replaced_by_snapshot_id is null
  )
  update public.advancement_snapshots set stale = true where id in (select id from stale_chain);
  result := jsonb_build_object('heat_id', heat_id, 'winner_car_id', winner_id, 'version', heat.version + 1);
  insert into public.audit_events
    (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, request_id)
  values (heat.organisation_id, heat.meet_id, heat.bracket_id, actor, action_name, 'heat', heat_id,
    before_value, result, case when correction then btrim(reason) else null end, request_id);
  return result;
end;
$$;

create or replace function private_meet.write_advancement(
  rule_id uuid,
  source_result_version integer,
  expected_version integer,
  selections jsonb,
  reason text,
  request_id uuid,
  replacing boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  rule record;
  previous public.advancement_snapshots%rowtype;
  snapshot_id uuid := extensions.gen_random_uuid();
  action_name text := case when replacing then 'advancement.replaced' else 'advancement.confirmed' end;
  result jsonb;
  selection record;
  destination record;
  participant_id uuid;
  destination_car_id uuid;
  expected_destination_id uuid;
  next_number integer;
  source_is_complete boolean;
  automatic_ranking_supported boolean;
  automatic_ids uuid[] := array[]::uuid[];
  cutoff_ids uuid[] := array[]::uuid[];
  selected_ids uuid[];
  cutoff_end integer;
  allocation_counts jsonb := '{}'::jsonb;
begin
  select r.*, source.stage as source_stage, source.status as source_status, source.settings as source_settings,
    source.version as actual_source_version, meet.status as meet_status
  into rule
  from public.advancement_rules r
  join public.brackets source on source.id = r.source_bracket_id and source.organisation_id = r.organisation_id and source.meet_id = r.meet_id
  join public.meets meet on meet.id = r.meet_id and meet.organisation_id = r.organisation_id
  where r.id = rule_id
  for update of r, source;
  if not found then raise exception using message = 'MEET_ADVANCEMENT_RULE_NOT_FOUND'; end if;
  if not private_meet.has_org_role(rule.organisation_id, array['owner', 'admin', 'organiser']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  select event.after_state into result from public.audit_events event
  where event.organisation_id = rule.organisation_id and event.request_id = write_advancement.request_id
    and event.action = action_name;
  if result is not null then return result; end if;
  if rule.version <> expected_version or rule.actual_source_version <> source_result_version then
    raise exception using message = 'MEET_VERSION_CONFLICT';
  end if;
  if rule.status <> 'active' or rule.meet_status not in ('running', 'completed') or rule.source_status not in ('running', 'completed') then
    raise exception using message = 'MEET_STATUS_CONFLICT';
  end if;
  perform 1 from public.advancement_rule_destinations destination
  join public.brackets bracket on bracket.id = destination.destination_bracket_id
    and bracket.organisation_id = destination.organisation_id and bracket.meet_id = destination.meet_id
  where destination.rule_id = write_advancement.rule_id and destination.meet_id = rule.meet_id
  order by destination.destination_order, bracket.id for update of bracket;
  if not found then raise exception using message = 'MEET_ADVANCEMENT_DESTINATION_NOT_FOUND'; end if;
  select snapshot.* into previous from public.advancement_snapshots snapshot
  where snapshot.rule_id = write_advancement.rule_id and snapshot.replaced_by_snapshot_id is null
  order by snapshot.id for update;
  if replacing and not found then raise exception using message = 'MEET_ADVANCEMENT_NOT_FOUND'; end if;
  if not replacing and found then raise exception using message = 'MEET_ADVANCEMENT_EXISTS'; end if;
  if replacing and (reason is null or char_length(btrim(reason)) not between 1 and 500) then
    raise exception using message = 'MEET_REASON_REQUIRED';
  end if;
  if jsonb_typeof(selections) <> 'array' or jsonb_array_length(selections) <> rule.top_n then
    raise exception using message = 'MEET_SELECTION_COUNT';
  end if;
  select array_agg((item->>'sourceCarId')::uuid order by (item->>'sourceCarId')::uuid)
  into selected_ids from jsonb_array_elements(selections) item;
  if cardinality(selected_ids) <> cardinality(array(select distinct unnest(selected_ids))) then
    raise exception using message = 'MEET_DUPLICATE_SELECTION';
  end if;
  if exists (
    select 1 from jsonb_array_elements(selections) item
    left join public.cars source_car on source_car.id = (item->>'sourceCarId')::uuid
      and source_car.organisation_id = rule.organisation_id and source_car.bracket_id = rule.source_bracket_id and source_car.active
    left join public.advancement_rule_destinations destination
      on destination.rule_id = write_advancement.rule_id and destination.meet_id = rule.meet_id
      and destination.destination_bracket_id = (item->>'destinationBracketId')::uuid
    left join public.brackets destination_bracket on destination_bracket.id = destination.destination_bracket_id
      and destination_bracket.meet_id = rule.meet_id and destination_bracket.organisation_id = rule.organisation_id
    where source_car.id is null or destination.rule_id is null
      or case destination_bracket.stage when 'qualifier' then 1 when 'semifinal' then 2 else 3 end
         <= case rule.source_stage when 'qualifier' then 1 when 'semifinal' then 2 else 3 end
      or (item->>'rank')::integer not between 1 and 10000
  ) then raise exception using message = 'MEET_INVALID_SELECTION'; end if;
  if exists (
    select 1 from public.cars source_car
    join public.advancement_snapshots source_snapshot on source_snapshot.id = source_car.snapshot_id
    where source_car.bracket_id = rule.source_bracket_id and source_car.active and source_snapshot.stale
  ) then raise exception using message = 'MEET_STALE_SOURCE'; end if;
  if exists (
    select 1 from jsonb_array_elements(selections) item
    join public.cars prior on prior.source_bracket_id = rule.source_bracket_id
      and prior.source_car_id = (item->>'sourceCarId')::uuid and prior.active
    where not replacing or prior.snapshot_id is distinct from previous.id
  ) then raise exception using message = 'MEET_DUPLICATE_ADVANCEMENT'; end if;

  select exists (select 1 from public.heats heat where heat.bracket_id = rule.source_bracket_id)
    and not exists (select 1 from public.heats heat where heat.bracket_id = rule.source_bracket_id and heat.status <> 'confirmed')
    and not exists (
      select 1 from public.cars source_car
      where source_car.bracket_id = rule.source_bracket_id and source_car.active
        and not exists (select 1 from public.heats heat where heat.bracket_id = rule.source_bracket_id
          and source_car.id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
    )
  into source_is_complete;
  select not exists (
    select 1
    from jsonb_array_elements_text(coalesce(rule.source_settings->'tieBreakOrder', '["totalWins"]'::jsonb)) as tie_break(value)
    where tie_break.value <> 'totalWins'
  ) into automatic_ranking_supported;

  with standings as (
    select source_car.id, source_car.car_number,
      count(heat.id) filter (where heat.winner_car_id = source_car.id) as wins
    from public.cars source_car
    left join public.heats heat on heat.bracket_id = source_car.bracket_id and heat.status = 'confirmed'
    where source_car.bracket_id = rule.source_bracket_id and source_car.active
    group by source_car.id, source_car.car_number
  ), ranked as (
    select id, car_number, wins, rank() over (order by wins desc)::integer as place,
      count(*) over (partition by wins)::integer as tie_size
    from standings
  )
  select
    coalesce(array_agg(id order by car_number, id) filter (where place + tie_size - 1 <= rule.top_n), array[]::uuid[]),
    coalesce(array_agg(id order by car_number, id) filter (where place <= rule.top_n and place + tie_size - 1 > rule.top_n), array[]::uuid[]),
    max(place + tie_size - 1) filter (where place <= rule.top_n and place + tie_size - 1 > rule.top_n)
  into automatic_ids, cutoff_ids, cutoff_end
  from ranked;

  if not source_is_complete and (reason is null or char_length(btrim(reason)) not between 1 and 500) then
    raise exception using message = 'MEET_SOURCE_INCOMPLETE';
  end if;
  if not automatic_ranking_supported and (reason is null or char_length(btrim(reason)) not between 1 and 500) then
    raise exception using message = 'MEET_MANUAL_ADVANCEMENT_REQUIRED';
  end if;
  if source_is_complete then
    if exists (select 1 from unnest(automatic_ids) required_id where not required_id = any(selected_ids))
       or exists (select 1 from unnest(selected_ids) selected_id
          where not selected_id = any(automatic_ids || cutoff_ids)) then
      raise exception using message = 'MEET_INVALID_SELECTION';
    end if;
    if exists (
      with standings as (
        select source_car.id, count(heat.id) filter (where heat.winner_car_id = source_car.id) as wins
        from public.cars source_car left join public.heats heat on heat.bracket_id = source_car.bracket_id and heat.status = 'confirmed'
        where source_car.bracket_id = rule.source_bracket_id and source_car.active group by source_car.id
      ), ranked as (select id, rank() over (order by wins desc)::integer as place from standings)
      select 1 from jsonb_array_elements(selections) item join ranked on ranked.id = (item->>'sourceCarId')::uuid
      where ranked.place <> (item->>'rank')::integer
    ) then raise exception using message = 'MEET_INVALID_SELECTION_RANK'; end if;
  end if;
  if cutoff_end > rule.top_n and (reason is null or char_length(btrim(reason)) not between 1 and 500) then
    raise exception using message = 'MEET_REASON_REQUIRED';
  end if;

  for destination in
    select rule_destination.destination_bracket_id, rule_destination.destination_order,
      count(destination_car.id) filter (where destination_car.active
        and (not replacing or destination_car.snapshot_id is distinct from previous.id))::integer as active_occupancy
    from public.advancement_rule_destinations rule_destination
    left join public.cars destination_car on destination_car.bracket_id = rule_destination.destination_bracket_id
    where rule_destination.rule_id = write_advancement.rule_id
    group by rule_destination.destination_bracket_id, rule_destination.destination_order
    order by rule_destination.destination_order, rule_destination.destination_bracket_id
  loop
    allocation_counts := jsonb_set(allocation_counts, array[destination.destination_bracket_id::text], to_jsonb(destination.active_occupancy), true);
  end loop;
  for selection in
    select item.value, source_car.car_number
    from jsonb_array_elements(selections) with ordinality item(value, ordinality)
    join public.cars source_car on source_car.id = (item.value->>'sourceCarId')::uuid
    order by (item.value->>'rank')::integer, source_car.car_number, source_car.id
  loop
    select rule_destination.destination_bracket_id into expected_destination_id
    from public.advancement_rule_destinations rule_destination
    where rule_destination.rule_id = write_advancement.rule_id
      and coalesce((allocation_counts->>rule_destination.destination_bracket_id::text)::integer, 0) < rule.destination_capacity
    order by coalesce((allocation_counts->>rule_destination.destination_bracket_id::text)::integer, 0),
      rule_destination.destination_order, rule_destination.destination_bracket_id
    limit 1;
    if expected_destination_id is null then raise exception using message = 'MEET_DESTINATION_CAPACITY'; end if;
    if (selection.value->>'destinationBracketId')::uuid <> expected_destination_id then
      raise exception using message = 'MEET_DESTINATION_ALLOCATION';
    end if;
    allocation_counts := jsonb_set(allocation_counts, array[expected_destination_id::text],
      to_jsonb((allocation_counts->>expected_destination_id::text)::integer + 1), true);
  end loop;

  if replacing then
    update public.cars set active = false where snapshot_id = previous.id;
    with recursive stale_descendants(id) as (
      select downstream.id from public.advancement_snapshots downstream
      join public.cars source_car on source_car.bracket_id = downstream.source_bracket_id
      where source_car.snapshot_id = previous.id and downstream.replaced_by_snapshot_id is null
      union
      select downstream.id from public.advancement_snapshots downstream
      join public.cars source_car on source_car.bracket_id = downstream.source_bracket_id
      join stale_descendants upstream on upstream.id = source_car.snapshot_id
      where downstream.replaced_by_snapshot_id is null
    )
    update public.advancement_snapshots set stale = true where id in (select id from stale_descendants);
    update public.advancement_snapshots set replaced_by_snapshot_id = snapshot_id where id = previous.id;
  end if;
  insert into public.advancement_snapshots
    (id, organisation_id, meet_id, rule_id, source_bracket_id, source_result_version, confirmed_by, reason, request_id)
  values (snapshot_id, rule.organisation_id, rule.meet_id, rule.id, rule.source_bracket_id,
    source_result_version, actor, nullif(btrim(reason), ''), request_id);
  for selection in
    select item.value, source_car.car_number, destination.destination_order
    from jsonb_array_elements(selections) with ordinality item(value, ordinality)
    join public.cars source_car on source_car.id = (item.value->>'sourceCarId')::uuid
    join public.advancement_rule_destinations destination on destination.rule_id = write_advancement.rule_id
      and destination.destination_bracket_id = (item.value->>'destinationBracketId')::uuid
    order by (item.value->>'rank')::integer, source_car.car_number, source_car.id
  loop
    participant_id := extensions.gen_random_uuid();
    destination_car_id := extensions.gen_random_uuid();
    select coalesce(max(car_number), 0) + 1 into next_number from public.cars
    where bracket_id = (selection.value->>'destinationBracketId')::uuid;
    insert into public.participants (id, organisation_id, bracket_id, name, email, phone, notes)
    select participant_id, source_participant.organisation_id, (selection.value->>'destinationBracketId')::uuid,
      source_participant.name, source_participant.email, source_participant.phone, source_participant.notes
    from public.cars source_car join public.participants source_participant on source_participant.id = source_car.participant_id
    where source_car.id = (selection.value->>'sourceCarId')::uuid;
    insert into public.cars
      (id, organisation_id, bracket_id, participant_id, car_number, name, active, source_bracket_id, source_car_id, rule_id, snapshot_id)
    select destination_car_id, source_car.organisation_id, (selection.value->>'destinationBracketId')::uuid,
      participant_id, next_number, source_car.name, true, source_car.bracket_id, source_car.id, rule.id, snapshot_id
    from public.cars source_car where source_car.id = (selection.value->>'sourceCarId')::uuid;
    insert into public.advancement_selections
      (organisation_id, meet_id, snapshot_id, rule_id, source_bracket_id, source_car_id, destination_bracket_id, destination_car_id, rank)
    values (rule.organisation_id, rule.meet_id, snapshot_id, rule.id, rule.source_bracket_id,
      (selection.value->>'sourceCarId')::uuid, (selection.value->>'destinationBracketId')::uuid,
      destination_car_id, (selection.value->>'rank')::integer);
  end loop;
  update public.brackets set version = version + 1
  where id in (select destination_bracket_id from public.advancement_rule_destinations where rule_id = write_advancement.rule_id);
  update public.meets set version = version + 1 where id = rule.meet_id;
  update public.advancement_rules set version = version + 1 where id = rule_id;
  result := jsonb_build_object('snapshot_id', snapshot_id, 'rule_id', rule_id, 'version', rule.version + 1,
    'source_result_version', source_result_version, 'selection_count', rule.top_n);
  insert into public.audit_events
    (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, request_id)
  values (rule.organisation_id, rule.meet_id, rule.source_bracket_id, actor, action_name, 'advancement_snapshot', snapshot_id,
    case when replacing then jsonb_build_object('snapshot_id', previous.id) else '{}'::jsonb end,
    result, nullif(btrim(reason), ''), request_id);
  return result;
end;
$$;

revoke execute on function private_meet.consume_rate_limit_result(uuid, text, integer) from public, anon, authenticated;
revoke execute on function private_meet.write_heat_winner(uuid, uuid, jsonb, integer, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function private_meet.write_advancement(uuid, integer, integer, jsonb, text, uuid, boolean) from public, anon, authenticated;
grant execute on function private_meet.is_org_member(uuid) to authenticated;
grant execute on function private_meet.has_org_role(uuid, text[]) to authenticated;

revoke execute on function public.record_security_event(uuid, text, uuid, jsonb, uuid) from public, anon;
grant execute on function public.record_security_event(uuid, text, uuid, jsonb, uuid) to authenticated;

comment on function public.redeem_invitation(text, uuid) is
  'Returns indistinguishable structured failures so unsuccessful invitation attempts commit their rate-limit counter.';
comment on function public.record_security_event(uuid, text, uuid, jsonb, uuid) is
  'Records allow-listed account security events with a derived actor, idempotency and rate limiting.';
comment on function public.confirm_advancement(uuid, integer, integer, jsonb, text, uuid) is
  'Validates server-derived ranking, cutoff membership and balanced destination allocation before advancing.';
