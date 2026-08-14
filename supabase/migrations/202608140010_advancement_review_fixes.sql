-- Advancement review fixes: scoped audit enrichment, strict pagination and stable retries.

create or replace function private_meet.write_advancement_accountable(
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
declare
  result jsonb;
  new_snapshot_id uuid;
  previous_snapshot_id uuid;
  target_organisation_id uuid;
  target_meet_id uuid;
  previous_selections jsonb := '[]'::jsonb;
  current_selections jsonb := '[]'::jsonb;
  action_name text := case when replacing then 'advancement.replaced' else 'advancement.confirmed' end;
begin
  result := private_meet.write_advancement(rule_id, source_result_version, expected_version, selections, reason, request_id, replacing);
  new_snapshot_id := (result->>'snapshot_id')::uuid;

  select snapshot.organisation_id, snapshot.meet_id
  into target_organisation_id, target_meet_id
  from public.advancement_snapshots snapshot
  where snapshot.id = new_snapshot_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceCarId', selection.source_car_id,
    'destinationBracketId', selection.destination_bracket_id,
    'destinationCarId', selection.destination_car_id,
    'rank', selection.rank
  ) order by selection.rank, selection.source_car_id, selection.destination_bracket_id), '[]'::jsonb)
  into current_selections
  from public.advancement_selections selection where selection.snapshot_id = new_snapshot_id;

  if replacing then
    select snapshot.id into previous_snapshot_id
    from public.advancement_snapshots snapshot where snapshot.replaced_by_snapshot_id = new_snapshot_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'sourceCarId', selection.source_car_id,
      'destinationBracketId', selection.destination_bracket_id,
      'destinationCarId', selection.destination_car_id,
      'rank', selection.rank
    ) order by selection.rank, selection.source_car_id, selection.destination_bracket_id), '[]'::jsonb)
    into previous_selections
    from public.advancement_selections selection where selection.snapshot_id = previous_snapshot_id;
  end if;

  update public.audit_events event set
    before_state = event.before_state || jsonb_build_object('selections', previous_selections),
    after_state = event.after_state || jsonb_build_object('selections', current_selections)
  where event.request_id = write_advancement_accountable.request_id
    and event.action = action_name
    and event.organisation_id = target_organisation_id and event.entity_id = new_snapshot_id
    and event.meet_id = target_meet_id
    and event.entity_type = 'advancement_snapshot';

  return result || jsonb_build_object('selections', current_selections);
end;
$$;

create or replace function private_meet.existing_heat_result(
  target_heat_id uuid,
  target_request_id uuid,
  correction boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organisation_id uuid;
  prior_result jsonb;
  action_name text := case when correction then 'heat.winner_corrected' else 'heat.winner_confirmed' end;
begin
  select heat.organisation_id into target_organisation_id
  from public.heats heat where heat.id = target_heat_id;
  if not found then return null; end if;
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin', 'organiser', 'marshal']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  select event.after_state into prior_result
  from public.audit_events event
  where event.organisation_id = target_organisation_id
    and event.entity_type = 'heat' and event.entity_id = target_heat_id
    and event.request_id = target_request_id and event.action = action_name;
  return prior_result;
end;
$$;

-- WINNER IDEMPOTENCY BEFORE ACTIVE GUARD
create or replace function public.confirm_heat_winner(
  heat_id uuid, winner_car_id uuid, lane_times jsonb, expected_version integer, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare prior_result jsonb;
begin
  prior_result := private_meet.existing_heat_result(heat_id, request_id, false);
  if prior_result is not null then return prior_result; end if;
  perform private_meet.assert_heat_cars_active(heat_id, winner_car_id);
  return private_meet.write_heat_winner(heat_id, winner_car_id, lane_times, expected_version, null, request_id, false);
end;
$$;

create or replace function public.correct_heat_winner(
  heat_id uuid, winner_car_id uuid, lane_times jsonb, expected_version integer, reason text, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare prior_result jsonb;
begin
  prior_result := private_meet.existing_heat_result(heat_id, request_id, true);
  if prior_result is not null then return prior_result; end if;
  perform private_meet.assert_heat_cars_active(heat_id, winner_car_id);
  return private_meet.write_heat_winner(heat_id, winner_car_id, lane_times, expected_version, reason, request_id, true);
end;
$$;

create or replace function public.confirm_heat_winner_ms(
  heat_id uuid, winner_car_id uuid, lane_times_ms jsonb, expected_version integer, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare prior_result jsonb;
begin
  prior_result := private_meet.existing_heat_result(heat_id, request_id, false);
  if prior_result is not null then return prior_result; end if;
  perform private_meet.assert_heat_cars_active(heat_id, winner_car_id);
  return private_meet.write_heat_winner(heat_id, winner_car_id,
    private_meet.lane_times_from_milliseconds(lane_times_ms), expected_version, null, request_id, false);
end;
$$;

create or replace function public.correct_heat_winner_ms(
  heat_id uuid, winner_car_id uuid, lane_times_ms jsonb, expected_version integer, reason text, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare prior_result jsonb;
begin
  prior_result := private_meet.existing_heat_result(heat_id, request_id, true);
  if prior_result is not null then return prior_result; end if;
  perform private_meet.assert_heat_cars_active(heat_id, winner_car_id);
  return private_meet.write_heat_winner(heat_id, winner_car_id,
    private_meet.lane_times_from_milliseconds(lane_times_ms), expected_version, reason, request_id, true);
end;
$$;

create or replace function public.list_security_events(
  target_organisation_id uuid,
  page_size integer default 50,
  before_occurred_at timestamptz default null,
  before_id uuid default null
)
returns table (
  id uuid, organisation_id uuid, actor_id uuid, subject_user_id uuid,
  event_type text, metadata jsonb, occurred_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if page_size is null or page_size not between 1 and 100
     or ((before_occurred_at is null) <> (before_id is null)) then
    raise exception using message = 'MEET_INVALID_PAGE';
  end if;
  return query
  select event.id, event.organisation_id, event.actor_id, event.subject_user_id,
    event.event_type, event.metadata, event.occurred_at
  from public.security_events event
  where event.organisation_id = target_organisation_id
    and (before_occurred_at is null or (event.occurred_at, event.id) < (before_occurred_at, before_id))
  order by event.occurred_at desc, event.id desc
  limit page_size;
end;
$$;

create or replace function public.get_admin_overview(target_organisation_id uuid, recent_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if recent_limit is null or recent_limit not between 1 and 50 then
    raise exception using message = 'MEET_INVALID_PAGE';
  end if;
  select jsonb_build_object(
    'active_meet_count', (select count(*) from public.meets meet where meet.organisation_id = target_organisation_id and meet.status <> 'completed'),
    'running_meet_count', (select count(*) from public.meets meet where meet.organisation_id = target_organisation_id and meet.status = 'running'),
    'stale_advancement_count', (select count(*) from public.advancement_snapshots snapshot where snapshot.organisation_id = target_organisation_id and snapshot.stale and snapshot.replaced_by_snapshot_id is null),
    'unresolved_tie_count', (
      select count(*) from public.advancement_rules rule
      where rule.organisation_id = target_organisation_id and rule.status = 'active'
        and exists (
          select 1 from private_meet.advancement_ranking(rule.source_bracket_id) ranking
          where ranking.competitive_rank <= rule.top_n
            and ranking.competitive_rank + ranking.group_size - 1 > rule.top_n
        )
    ),
    'recent_activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', activity.id, 'meet_id', activity.meet_id, 'action', activity.action,
        'actor_id', activity.actor_id, 'occurred_at', activity.occurred_at
      ) order by activity.occurred_at desc, activity.id desc)
      from (
        select event.id, event.meet_id, event.action, event.actor_id, event.occurred_at
        from public.audit_events event where event.organisation_id = target_organisation_id
        order by event.occurred_at desc, event.id desc limit recent_limit
      ) activity
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

alter function public.save_registration_batch(uuid, integer, jsonb, uuid)
  rename to save_registration_batch_v8;
revoke execute on function public.save_registration_batch_v8(uuid, integer, jsonb, uuid) from public, anon, authenticated;

-- REGISTRATION STATUS REASON REQUIRED
create or replace function public.save_registration_batch(
  target_bracket_id uuid,
  expected_version integer,
  rows jsonb,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organisation_id uuid;
  target_meet_id uuid;
  prior_result jsonb;
  clean_rows jsonb;
  status_changes jsonb := '{}'::jsonb;
  result jsonb;
  change record;
begin
  select bracket.organisation_id, bracket.meet_id
  into target_organisation_id, target_meet_id
  from public.brackets bracket where bracket.id = target_bracket_id
  for update;
  if not found then raise exception using message = 'MEET_BRACKET_NOT_FOUND'; end if;
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin', 'organiser']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;

  select event.after_state into prior_result
  from public.audit_events event
  where event.organisation_id = target_organisation_id
    and event.entity_id = target_bracket_id
    and event.request_id = save_registration_batch.request_id
    and event.action = 'registration.batch_saved';
  if prior_result is not null then return prior_result; end if;

  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception using message = 'MEET_INVALID_REGISTRATION_BATCH';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows) row_value
    where row_value ? 'reason' and (
      jsonb_typeof(row_value->'reason') <> 'string'
      or char_length(btrim(row_value->>'reason')) not between 1 and 500
    )
  ) then raise exception using message = 'MEET_REASON_REQUIRED'; end if;
  if exists (
    select 1 from jsonb_array_elements(rows) row_value
    join public.cars existing_car on existing_car.id = case
      when coalesce(row_value->>'carId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (row_value->>'carId')::uuid else null end
    where existing_car.organisation_id = target_organisation_id
      and existing_car.bracket_id = target_bracket_id
      and case when jsonb_typeof(row_value->'active') = 'boolean'
        then existing_car.active is distinct from (row_value->>'active')::boolean else false end
      and not (row_value ? 'reason')
  ) then raise exception using message = 'MEET_REASON_REQUIRED'; end if;

  select coalesce(jsonb_object_agg(existing_car.id::text, jsonb_build_object(
    'before_active', existing_car.active,
    'after_active', (row_value->>'active')::boolean,
    'reason', btrim(row_value->>'reason')
  )), '{}'::jsonb)
  into status_changes
  from jsonb_array_elements(rows) row_value
  join public.cars existing_car on existing_car.id = case
    when coalesce(row_value->>'carId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (row_value->>'carId')::uuid else null end
  where existing_car.organisation_id = target_organisation_id
    and existing_car.bracket_id = target_bracket_id
    and jsonb_typeof(row_value->'active') = 'boolean'
    and existing_car.active is distinct from (row_value->>'active')::boolean;

  select jsonb_agg(row_value - 'reason' order by ordinal)
  into clean_rows
  from jsonb_array_elements(rows) with ordinality source(row_value, ordinal);

  result := public.save_registration_batch_v8(target_bracket_id, expected_version, clean_rows, request_id);

  for change in select key as car_id, value from jsonb_each(status_changes)
  loop
    update public.audit_events event set
      reason = change.value->>'reason',
      before_state = event.before_state || jsonb_build_object('status_change', jsonb_build_object('active', (change.value->>'before_active')::boolean)),
      after_state = event.after_state || jsonb_build_object('status_change', jsonb_build_object('active', (change.value->>'after_active')::boolean, 'reason', change.value->>'reason'))
    where event.organisation_id = target_organisation_id
      and event.meet_id = target_meet_id and event.bracket_id = target_bracket_id
      and event.entity_type = 'car' and event.entity_id = change.car_id::uuid
      and event.request_id = save_registration_batch.request_id
      and event.action = 'registration.row_saved.' || change.car_id;
  end loop;
  return result;
end;
$$;

revoke execute on function private_meet.existing_heat_result(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.save_registration_batch(uuid, integer, jsonb, uuid) from public, anon;
grant execute on function public.save_registration_batch(uuid, integer, jsonb, uuid) to authenticated;

comment on function public.save_registration_batch(uuid, integer, jsonb, uuid) is
  'Atomically upserts bracket registration; optional row reason is mandatory and audited when an existing car active state changes.';
