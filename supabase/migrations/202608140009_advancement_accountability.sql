-- Meet advancement accountability, safe replacement cleanup and admin read models.

create or replace function private_meet.assert_heat_cars_active(target_heat_id uuid, target_winner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  heat public.heats%rowtype;
begin
  select candidate.* into heat from public.heats candidate where candidate.id = target_heat_id;
  if not found then return; end if;
  if not private_meet.has_org_role(heat.organisation_id, array['owner', 'admin', 'organiser', 'marshal']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if exists (
    select 1
    from unnest(array[heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id, target_winner_id]) assigned(car_id)
    left join public.cars car on car.id = assigned.car_id
      and car.organisation_id = heat.organisation_id and car.bracket_id = heat.bracket_id and car.active
    where assigned.car_id is not null and car.id is null
  ) then
    raise exception using message = 'MEET_INACTIVE_ASSIGNED_CAR';
  end if;
end;
$$;

create or replace function private_meet.guard_advancement_car_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot public.advancement_snapshots%rowtype;
  retired jsonb;
begin
  if not old.active or new.active or old.snapshot_id is null then return new; end if;
  select candidate.* into snapshot from public.advancement_snapshots candidate where candidate.id = old.snapshot_id;
  if not found then return new; end if;

  if exists (
    select 1 from public.heats heat
    join public.advancement_rule_destinations destination on destination.destination_bracket_id = heat.bracket_id
    where destination.rule_id = old.rule_id and heat.status = 'confirmed'
  ) then
    raise exception using message = 'MEET_DOWNSTREAM_RESULTS_EXIST';
  end if;

  with outgoing as (
    select car.id from public.cars car where car.snapshot_id = old.snapshot_id
  ), deleted as (
    delete from public.heats heat
    where heat.status = 'pending'
      and heat.bracket_id in (
        select destination.destination_bracket_id from public.advancement_rule_destinations destination
        where destination.rule_id = old.rule_id
      )
      and exists (
        select 1 from outgoing
        where outgoing.id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id)
      )
    returning heat.id, heat.bracket_id, heat.round_number, heat.heat_number,
      heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id
  )
  select coalesce(jsonb_agg(to_jsonb(deleted) order by deleted.bracket_id, deleted.round_number, deleted.heat_number, deleted.id), '[]'::jsonb)
  into retired from deleted;

  if jsonb_array_length(retired) > 0 then
    insert into public.audit_events
      (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, reason, request_id)
    values
      (snapshot.organisation_id, snapshot.meet_id, snapshot.source_bracket_id, auth.uid(),
       'advancement.pending_schedule_retired', 'advancement_snapshot', old.snapshot_id,
       jsonb_build_object('pending_heats', retired),
       jsonb_build_object('pending_heats', '[]'::jsonb, 'retired_heat_ids',
         (select coalesce(jsonb_agg(item.value->'id' order by item.value->>'id'), '[]'::jsonb) from jsonb_array_elements(retired) item)),
       'Pending schedule referenced a superseded advancement selection', extensions.gen_random_uuid());
  end if;
  return new;
end;
$$;

drop trigger if exists cars_guard_advancement_deactivation on public.cars;
create trigger cars_guard_advancement_deactivation
before update of active on public.cars
for each row execute function private_meet.guard_advancement_car_deactivation();

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
  previous_selections jsonb := '[]'::jsonb;
  current_selections jsonb := '[]'::jsonb;
  action_name text := case when replacing then 'advancement.replaced' else 'advancement.confirmed' end;
begin
  result := private_meet.write_advancement(rule_id, source_result_version, expected_version, selections, reason, request_id, replacing);
  new_snapshot_id := (result->>'snapshot_id')::uuid;

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
  where event.request_id = write_advancement_accountable.request_id and event.action = action_name;

  return result || jsonb_build_object('selections', current_selections);
end;
$$;

create or replace function public.confirm_advancement(
  rule_id uuid, source_result_version integer, expected_version integer, selections jsonb, reason text, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$ select private_meet.write_advancement_accountable(rule_id, source_result_version, expected_version, selections, reason, request_id, false); $$;

create or replace function public.replace_advancement(
  rule_id uuid, source_result_version integer, expected_version integer, selections jsonb, reason text, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$ select private_meet.write_advancement_accountable(rule_id, source_result_version, expected_version, selections, reason, request_id, true); $$;

create or replace function public.confirm_heat_winner(
  heat_id uuid, winner_car_id uuid, lane_times jsonb, expected_version integer, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private_meet.assert_heat_cars_active(heat_id, winner_car_id);
  return private_meet.write_heat_winner(heat_id, winner_car_id, lane_times, expected_version, null, request_id, false);
end;
$$;

create or replace function public.correct_heat_winner(
  heat_id uuid, winner_car_id uuid, lane_times jsonb, expected_version integer, reason text, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private_meet.assert_heat_cars_active(heat_id, winner_car_id);
  return private_meet.write_heat_winner(heat_id, winner_car_id, lane_times, expected_version, reason, request_id, true);
end;
$$;

create or replace function public.confirm_heat_winner_ms(
  heat_id uuid, winner_car_id uuid, lane_times_ms jsonb, expected_version integer, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
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
begin
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
  if page_size not between 1 and 100
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
declare
  result jsonb;
begin
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if recent_limit not between 1 and 50 then raise exception using message = 'MEET_INVALID_PAGE'; end if;
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

revoke execute on function private_meet.assert_heat_cars_active(uuid, uuid) from public, anon, authenticated;
revoke execute on function private_meet.guard_advancement_car_deactivation() from public, anon, authenticated;
revoke execute on function private_meet.write_advancement_accountable(uuid, integer, integer, jsonb, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.list_security_events(uuid, integer, timestamptz, uuid) from public, anon;
revoke execute on function public.get_admin_overview(uuid, integer) from public, anon;
grant execute on function public.list_security_events(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.get_admin_overview(uuid, integer) to authenticated;

comment on function public.list_security_events(uuid, integer, timestamptz, uuid) is
  'Owner/admin-only stable cursor pagination over organisation security events.';
comment on function public.get_admin_overview(uuid, integer) is
  'Owner/admin-only operational overview for active meets, stale advancement, cutoff ties and recent audited activity.';
