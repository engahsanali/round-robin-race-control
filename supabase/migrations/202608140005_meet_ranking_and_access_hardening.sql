-- REVIEW HARDENING V5

revoke insert on public.cars from authenticated;
grant insert (organisation_id, bracket_id, participant_id, car_number, name)
  on public.cars to authenticated;

alter publication supabase_realtime add table public.organisations;
alter publication supabase_realtime add table public.organisation_memberships;
alter publication supabase_realtime add table public.organisation_invitations;

create or replace function public.create_invitation(
  target_organisation_id uuid,
  invitation_role text,
  invitation_expires_at timestamptz,
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
  raw_code text;
  invitation_id uuid;
  existing public.organisation_invitations%rowtype;
begin
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if invitation_role = 'owner'
     and not private_meet.has_org_role(target_organisation_id, array['owner']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  select invitation.* into existing from public.organisation_invitations invitation
  where invitation.organisation_id = target_organisation_id and invitation.request_id = create_invitation.request_id;
  if found then
    return jsonb_build_object('invitation_id', existing.id, 'code', null, 'expires_at', existing.expires_at);
  end if;
  if invitation_role not in ('owner', 'admin', 'organiser', 'marshal', 'viewer') then
    raise exception using message = 'MEET_INVALID_ROLE';
  end if;
  if invitation_expires_at <= statement_timestamp() or invitation_expires_at > statement_timestamp() + interval '30 days' then
    raise exception using message = 'MEET_INVALID_EXPIRY';
  end if;
  perform private_meet.consume_rate_limit(target_organisation_id, 'create_invitation', 10);
  raw_code := encode(extensions.gen_random_bytes(24), 'hex');
  invitation_id := extensions.gen_random_uuid();
  insert into public.organisation_invitations
    (id, organisation_id, role, code_digest, expires_at, created_by, request_id)
  values (invitation_id, target_organisation_id, invitation_role,
    encode(extensions.digest(raw_code, 'sha256'), 'hex'), invitation_expires_at, actor, request_id);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, after_state, request_id)
  values (target_organisation_id, actor, 'invitation.created', 'organisation_invitation', invitation_id,
    jsonb_build_object('invitation_id', invitation_id, 'role', invitation_role, 'expires_at', invitation_expires_at), request_id);
  insert into public.security_events (organisation_id, actor_id, event_type, request_id, metadata)
  values (target_organisation_id, actor, 'invitation.created', request_id,
    jsonb_build_object('invitation_id', invitation_id, 'role', invitation_role));
  return jsonb_build_object('invitation_id', invitation_id, 'code', raw_code, 'expires_at', invitation_expires_at);
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
  automatic_ids uuid[] := array[]::uuid[];
  cutoff_ids uuid[] := array[]::uuid[];
  selected_ids uuid[];
  cutoff_end integer;
  allocation_counts jsonb := '{}'::jsonb;
begin
  select advancement_rule.*, source.stage as source_stage, source.status as source_status,
    source.version as actual_source_version, meet.status as meet_status
  into rule
  from public.advancement_rules advancement_rule
  join public.brackets source on source.id = advancement_rule.source_bracket_id
    and source.organisation_id = advancement_rule.organisation_id and source.meet_id = advancement_rule.meet_id
  join public.meets meet on meet.id = advancement_rule.meet_id and meet.organisation_id = advancement_rule.organisation_id
  where advancement_rule.id = rule_id
  for update of advancement_rule, source;
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
  if rule.status <> 'active' or rule.meet_status not in ('running', 'completed')
     or rule.source_status not in ('running', 'completed') then
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

  select
    coalesce(array_agg(ranking.source_car_id order by ranking.display_order)
      filter (where ranking.competitive_rank + ranking.group_size - 1 <= rule.top_n), array[]::uuid[]),
    coalesce(array_agg(ranking.source_car_id order by ranking.display_order)
      filter (where ranking.competitive_rank <= rule.top_n
        and ranking.competitive_rank + ranking.group_size - 1 > rule.top_n), array[]::uuid[]),
    max(ranking.competitive_rank + ranking.group_size - 1)
      filter (where ranking.competitive_rank <= rule.top_n
        and ranking.competitive_rank + ranking.group_size - 1 > rule.top_n)
  into automatic_ids, cutoff_ids, cutoff_end
  from private_meet.advancement_ranking(rule.source_bracket_id) ranking;

  if not source_is_complete and (reason is null or char_length(btrim(reason)) not between 1 and 500) then
    raise exception using message = 'MEET_SOURCE_INCOMPLETE';
  end if;
  if source_is_complete then
    if exists (select 1 from unnest(automatic_ids) required_id where not required_id = any(selected_ids))
       or exists (select 1 from unnest(selected_ids) selected_id
          where not selected_id = any(automatic_ids || cutoff_ids)) then
      raise exception using message = 'MEET_INVALID_SELECTION';
    end if;
    if exists (
      select 1 from jsonb_array_elements(selections) item
      join private_meet.advancement_ranking(rule.source_bracket_id) ranking
        on ranking.source_car_id = (item->>'sourceCarId')::uuid
      where ranking.competitive_rank is distinct from (item->>'rank')::integer
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
    allocation_counts := jsonb_set(allocation_counts, array[destination.destination_bracket_id::text],
      to_jsonb(destination.active_occupancy), true);
  end loop;
  for selection in
    select item.value
    from jsonb_array_elements(selections) item
    join private_meet.advancement_ranking(rule.source_bracket_id) ranking
      on ranking.source_car_id = (item.value->>'sourceCarId')::uuid
    order by ranking.competitive_rank, ranking.source_car_id
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
    select item.value
    from jsonb_array_elements(selections) item
    join private_meet.advancement_ranking(rule.source_bracket_id) ranking
      on ranking.source_car_id = (item.value->>'sourceCarId')::uuid
    order by ranking.competitive_rank, ranking.source_car_id
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

create or replace function public.revoke_invitation(invitation_id uuid, request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  invitation public.organisation_invitations%rowtype;
  result jsonb;
begin
  if actor is null then raise exception using message = 'MEET_AUTH_REQUIRED'; end if;
  select event.after_state into result from public.audit_events event
  where event.actor_id = actor and event.request_id = revoke_invitation.request_id
    and event.action = 'invitation.revoked';
  if result is not null then return result; end if;
  select candidate.* into invitation from public.organisation_invitations candidate
  where candidate.id = invitation_id
    and private_meet.has_org_role(candidate.organisation_id, array['owner', 'admin'])
  for update;
  if not found then raise exception using message = 'MEET_INVITATION_NOT_FOUND'; end if;
  if invitation.used_at is not null then raise exception using message = 'MEET_INVITATION_ALREADY_USED'; end if;
  if invitation.revoked_at is null then
    update public.organisation_invitations set revoked_at = statement_timestamp() where id = invitation.id;
  end if;
  result := jsonb_build_object('invitation_id', invitation.id, 'revoked', true);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, before_state, after_state, request_id)
  values (invitation.organisation_id, actor, 'invitation.revoked', 'organisation_invitation', invitation.id,
    jsonb_build_object('revoked_at', invitation.revoked_at, 'used_at', invitation.used_at), result, request_id);
  insert into public.security_events
    (organisation_id, actor_id, event_type, request_id, metadata)
  values (invitation.organisation_id, actor, 'invitation.revoked', request_id,
    jsonb_build_object('invitation_id', invitation.id));
  return result;
end;
$$;

create or replace function public.list_organisation_members(target_organisation_id uuid)
returns table (user_id uuid, role text, display_name text, email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private_meet.is_org_member(target_organisation_id) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  return query
  select membership.user_id, membership.role,
    coalesce(nullif(btrim(identity.raw_user_meta_data->>'display_name'), ''),
      nullif(split_part(identity.email, '@', 1), ''), 'Member') as display_name,
    case when private_meet.has_org_role(target_organisation_id, array['owner', 'admin'])
      then identity.email else null end as email
  from public.organisation_memberships membership
  join auth.users identity on identity.id = membership.user_id
  where membership.organisation_id = target_organisation_id and membership.status = 'active'
  order by membership.role, membership.user_id;
end;
$$;

create or replace function private_meet.advancement_ranking(target_source_bracket_id uuid)
returns table (
  source_car_id uuid,
  competitive_rank integer,
  group_size integer,
  display_order integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  ranking_mode text;
  tie_break_order jsonb;
  tie_break_key text;
  official_results integer;
begin
  select coalesce(bracket.settings->>'rankingMode', 'competition'),
    coalesce(bracket.settings->'tieBreakOrder', '["totalWins"]'::jsonb)
  into ranking_mode, tie_break_order
  from public.brackets bracket where bracket.id = target_source_bracket_id;
  if not found or ranking_mode not in ('competition', 'dense', 'ordinal')
     or jsonb_typeof(tie_break_order) <> 'array' then
    raise exception using message = 'MEET_INVALID_RANKING_CONFIG';
  end if;

  create temporary table if not exists pg_temp.meet_advancement_rank_work (
    car_id uuid primary key,
    group_no integer not null,
    completed_heats integer not null,
    sort_metric numeric
  ) on commit drop;
  truncate table pg_temp.meet_advancement_rank_work;
  insert into pg_temp.meet_advancement_rank_work (car_id, group_no, completed_heats)
  select car.id, 1,
    count(heat.id) filter (where heat.status = 'confirmed'
      and car.id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))::integer
  from public.cars car
  left join public.heats heat on heat.bracket_id = car.bracket_id
  where car.bracket_id = target_source_bracket_id and car.active
  group by car.id;
  select coalesce(sum(work.completed_heats), 0) into official_results from pg_temp.meet_advancement_rank_work work;
  if official_results = 0 then
    return query select work.car_id, null::integer, count(*) over ()::integer,
      row_number() over (order by work.car_id)::integer
    from pg_temp.meet_advancement_rank_work work order by work.car_id;
    return;
  end if;

  for tie_break_key in select value from jsonb_array_elements_text(tie_break_order)
  loop
    if tie_break_key not in ('totalWins', 'headToHead', 'matchesWon', 'averageTime', 'bestTime', 'laneBalance', 'carNumber', 'playoff') then
      raise exception using message = 'MEET_INVALID_RANKING_CONFIG';
    end if;
    with metric as (
      select work.car_id,
        case tie_break_key
          when 'totalWins' then -(select count(*)::numeric from public.heats heat
            where heat.bracket_id = target_source_bracket_id and heat.status = 'confirmed' and heat.winner_car_id = work.car_id)
          when 'headToHead' then -(select coalesce(sum(case when heat.winner_car_id = work.car_id then
              (select count(*)
               from unnest(array[heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id]) as lanes(opponent_id)
               join pg_temp.meet_advancement_rank_work opponent on opponent.car_id = lanes.opponent_id
                 and opponent.group_no = work.group_no
               where lanes.opponent_id is distinct from work.car_id) else 0 end), 0)::numeric
            from public.heats heat where heat.bracket_id = target_source_bracket_id and heat.status = 'confirmed'
              and work.car_id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
          when 'matchesWon' then -(select count(distinct heat.round_number)::numeric from public.heats heat
            where heat.bracket_id = target_source_bracket_id and heat.status = 'confirmed' and heat.winner_car_id = work.car_id)
          when 'averageTime' then (select avg(case when heat.lane_1_car_id = work.car_id then heat.lane_1_time
              when heat.lane_2_car_id = work.car_id then heat.lane_2_time else heat.lane_3_time end)
            from public.heats heat where heat.bracket_id = target_source_bracket_id and heat.status = 'confirmed'
              and work.car_id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
          when 'bestTime' then (select min(case when heat.lane_1_car_id = work.car_id then heat.lane_1_time
              when heat.lane_2_car_id = work.car_id then heat.lane_2_time else heat.lane_3_time end)
            from public.heats heat where heat.bracket_id = target_source_bracket_id and heat.status = 'confirmed'
              and work.car_id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
          when 'laneBalance' then (select greatest(lane_1_count, lane_2_count, lane_3_count)
              - least(lane_1_count, lane_2_count, lane_3_count)
            from (select count(*) filter (where heat.lane_1_car_id = work.car_id)::numeric lane_1_count,
              count(*) filter (where heat.lane_2_car_id = work.car_id)::numeric lane_2_count,
              count(*) filter (where heat.lane_3_car_id = work.car_id)::numeric lane_3_count
              from public.heats heat where heat.bracket_id = target_source_bracket_id and heat.status = 'confirmed') lane_counts)
          when 'carNumber' then (select car.car_number::numeric from public.cars car where car.id = work.car_id)
          else null::numeric
        end as sort_metric
      from pg_temp.meet_advancement_rank_work work
    )
    update pg_temp.meet_advancement_rank_work work set sort_metric = metric.sort_metric
    from metric where metric.car_id = work.car_id;
    with next_group as (
      select work.car_id,
        dense_rank() over (order by work.group_no, work.sort_metric nulls last)::integer as group_no
      from pg_temp.meet_advancement_rank_work work
    )
    update pg_temp.meet_advancement_rank_work work set group_no = next_group.group_no
    from next_group where next_group.car_id = work.car_id;
  end loop;

  if ranking_mode = 'ordinal' and exists (
    select 1 from pg_temp.meet_advancement_rank_work work group by work.group_no having count(*) > 1
  ) then raise exception using message = 'MEET_ORDINAL_TIE_UNRESOLVED'; end if;

  return query
  with ordered as (
    select work.car_id, work.group_no,
      count(*) over (partition by work.group_no)::integer as tied_count,
      row_number() over (order by work.group_no, work.car_id)::integer as position
    from pg_temp.meet_advancement_rank_work work
  )
  select ordered.car_id,
    case ranking_mode when 'dense' then dense_rank() over (order by ordered.group_no)::integer
      when 'ordinal' then ordered.position
      else min(ordered.position) over (partition by ordered.group_no)::integer end,
    ordered.tied_count, ordered.position
  from ordered order by ordered.group_no, ordered.car_id;
end;
$$;

revoke execute on function private_meet.advancement_ranking(uuid) from public, anon, authenticated;
revoke execute on function private_meet.write_advancement(uuid, integer, integer, jsonb, text, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.revoke_invitation(uuid, uuid) from public, anon;
revoke execute on function public.list_organisation_members(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid, uuid) to authenticated;
grant execute on function public.list_organisation_members(uuid) to authenticated;

comment on function private_meet.advancement_ranking(uuid) is
  'Server-authoritative equivalent of Meet domain competition, dense and ordinal ranking with configured tie breaks.';
comment on function public.revoke_invitation(uuid, uuid) is
  'Role-scoped, row-locked, audited and idempotent invitation revocation without raw code disclosure.';
comment on function public.list_organisation_members(uuid) is
  'Lists active same-organisation identities; email is returned only to owners and admins.';
