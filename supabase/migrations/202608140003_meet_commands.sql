revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create or replace function private_meet.consume_rate_limit(
  target_organisation_id uuid,
  rate_action text,
  maximum_attempts integer
)
returns void
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
  if actor is null then
    raise exception using errcode = 'P0001', message = 'MEET_AUTH_REQUIRED';
  end if;
  insert into public.mutation_rate_limits
    (organisation_id, actor_id, action, window_started_at, attempt_count)
  values (target_organisation_id, actor, rate_action, current_window, 1)
  on conflict (actor_id, action, window_started_at)
  do update set attempt_count = public.mutation_rate_limits.attempt_count + 1,
                updated_at = statement_timestamp()
  returning attempt_count into attempts;
  if attempts > maximum_attempts then
    raise exception using errcode = 'P0001', message = 'MEET_RATE_LIMITED';
  end if;
end;
$$;

create or replace function public.create_organisation(name text, slug text, request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  existing jsonb;
  created public.organisations%rowtype;
begin
  if actor is null then raise exception using message = 'MEET_AUTH_REQUIRED'; end if;
  select event.after_state into existing from public.audit_events event
  where event.actor_id = actor and event.request_id = create_organisation.request_id
    and event.action = 'organisation.created';
  if existing is not null then return existing; end if;
  perform private_meet.consume_rate_limit(null, 'create_organisation', 5);
  insert into public.organisations (name, slug, created_by)
  values (btrim(name), lower(btrim(slug)), actor) returning * into created;
  insert into public.organisation_memberships (organisation_id, user_id, role)
  values (created.id, actor, 'owner');
  existing := jsonb_build_object('organisation_id', created.id, 'version', created.version);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, before_state, after_state, request_id)
  values (created.id, actor, 'organisation.created', 'organisation', created.id, '{}'::jsonb, existing, request_id);
  insert into public.security_events (organisation_id, actor_id, event_type, subject_user_id)
  values (created.id, actor, 'organisation.created', actor);
  return existing;
end;
$$;

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
  values (
    invitation_id, target_organisation_id, invitation_role,
    encode(extensions.digest(raw_code, 'sha256'), 'hex'), invitation_expires_at, actor, request_id
  );
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, after_state, request_id)
  values (
    target_organisation_id, actor, 'invitation.created', 'organisation_invitation', invitation_id,
    jsonb_build_object('invitation_id', invitation_id, 'role', invitation_role, 'expires_at', invitation_expires_at), request_id
  );
  insert into public.security_events (organisation_id, actor_id, event_type, metadata)
  values (target_organisation_id, actor, 'invitation.created', jsonb_build_object('invitation_id', invitation_id, 'role', invitation_role));
  return jsonb_build_object('invitation_id', invitation_id, 'code', raw_code, 'expires_at', invitation_expires_at);
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
begin
  if actor is null then raise exception using message = 'MEET_AUTH_REQUIRED'; end if;
  select event.after_state into existing from public.audit_events event
  where event.actor_id = actor and event.request_id = redeem_invitation.request_id
    and event.action = 'invitation.redeemed';
  if existing is not null then return existing; end if;
  perform private_meet.consume_rate_limit(null, 'redeem_invitation', 10);
  select candidate.* into invitation
  from public.organisation_invitations candidate
  where candidate.code_digest = encode(extensions.digest(invitation_code, 'sha256'), 'hex')
  for update;
  if not found or invitation.used_at is not null or invitation.revoked_at is not null
     or invitation.expires_at <= statement_timestamp() then
    raise exception using message = 'MEET_INVITATION_UNAVAILABLE';
  end if;
  insert into public.organisation_memberships (organisation_id, user_id, role)
  values (invitation.organisation_id, actor, invitation.role)
  on conflict (organisation_id, user_id) do nothing;
  update public.organisation_invitations
  set used_at = statement_timestamp(), used_by = actor
  where id = invitation.id;
  existing := jsonb_build_object('organisation_id', invitation.organisation_id, 'role', invitation.role);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, after_state, request_id)
  values (invitation.organisation_id, actor, 'invitation.redeemed', 'organisation_invitation', invitation.id, existing, request_id);
  insert into public.security_events (organisation_id, actor_id, event_type, subject_user_id, metadata)
  values (invitation.organisation_id, actor, 'invitation.redeemed', actor, jsonb_build_object('invitation_id', invitation.id));
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
begin
  if not private_meet.has_org_role(target_organisation_id, array['owner', 'admin']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  select event.after_state into result from public.audit_events event
  where event.organisation_id = target_organisation_id and event.request_id = remove_membership.request_id
    and event.action = 'membership.removed';
  if result is not null then return result; end if;
  if char_length(btrim(reason)) not between 1 and 500 then raise exception using message = 'MEET_REASON_REQUIRED'; end if;
  select candidate.* into membership from public.organisation_memberships candidate
  where candidate.organisation_id = target_organisation_id and candidate.user_id = target_user_id for update;
  if not found then raise exception using message = 'MEET_MEMBERSHIP_NOT_FOUND'; end if;
  if membership.role = 'owner' and not private_meet.has_org_role(target_organisation_id, array['owner']) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  delete from public.organisation_memberships
  where organisation_id = target_organisation_id and user_id = target_user_id;
  result := jsonb_build_object('organisation_id', target_organisation_id, 'user_id', target_user_id, 'removed', true);
  insert into public.audit_events
    (organisation_id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, request_id)
  values (target_organisation_id, actor, 'membership.removed', 'organisation_membership', target_user_id,
    to_jsonb(membership), result, btrim(reason), request_id);
  insert into public.security_events (organisation_id, actor_id, event_type, subject_user_id, metadata)
  values (target_organisation_id, actor, 'membership.removed', target_user_id, jsonb_build_object('reason', btrim(reason)));
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
  if heat.version <> expected_version then
    raise exception using message = 'MEET_VERSION_CONFLICT';
  end if;
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
  if correction and not (char_length(btrim(reason)) between 1 and 500) then
    raise exception using message = 'MEET_REASON_REQUIRED';
  end if;
  if lane_times is not null and (
    jsonb_typeof(lane_times) <> 'object'
    or exists (select 1 from jsonb_object_keys(lane_times) key where key not in ('lane1', 'lane2', 'lane3'))
    or exists (select 1 from jsonb_each_text(lane_times) item where item.value !~ '^[0-9]+(?:\.[0-9]{1,3})?$' or item.value::numeric <= 0 or item.value::numeric > 86400)
  ) then raise exception using message = 'MEET_INVALID_LANE_TIMES'; end if;
  before_value := jsonb_build_object('winner_car_id', heat.winner_car_id, 'version', heat.version,
    'lane1', heat.lane_1_time, 'lane2', heat.lane_2_time, 'lane3', heat.lane_3_time);
  update public.heats set
    status = 'confirmed', winner_car_id = winner_id,
    lane_1_time = coalesce((lane_times->>'lane1')::numeric, lane_1_time),
    lane_2_time = coalesce((lane_times->>'lane2')::numeric, lane_2_time),
    lane_3_time = coalesce((lane_times->>'lane3')::numeric, lane_3_time),
    version = version + 1, confirmed_by = actor, confirmed_at = statement_timestamp()
  where id = heat_id;
  update public.brackets set version = version + 1 where id = heat.bracket_id;
  with recursive stale_chain(id) as (
    select snapshot.id from public.advancement_snapshots snapshot
    where snapshot.source_bracket_id = heat.bracket_id and snapshot.replaced_by_snapshot_id is null
    union
    select snapshot.id
    from public.advancement_snapshots snapshot
    join public.cars source_car on source_car.bracket_id = snapshot.source_bracket_id
    join stale_chain upstream on upstream.id = source_car.snapshot_id
    where snapshot.replaced_by_snapshot_id is null
  )
  update public.advancement_snapshots set stale = true
  where id in (select id from stale_chain);
  result := jsonb_build_object('heat_id', heat_id, 'winner_car_id', winner_id, 'version', heat.version + 1);
  insert into public.audit_events
    (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, request_id)
  values (heat.organisation_id, heat.meet_id, heat.bracket_id, actor, action_name, 'heat', heat_id,
    before_value, result, case when correction then btrim(reason) else null end, request_id);
  return result;
end;
$$;

create or replace function public.confirm_heat_winner(
  heat_id uuid, winner_car_id uuid, lane_times jsonb, expected_version integer, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$ select private_meet.write_heat_winner(heat_id, winner_car_id, lane_times, expected_version, null, request_id, false); $$;

create or replace function public.correct_heat_winner(
  heat_id uuid, winner_car_id uuid, lane_times jsonb, expected_version integer, reason text, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$ select private_meet.write_heat_winner(heat_id, winner_car_id, lane_times, expected_version, reason, request_id, true); $$;

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
  participant_id uuid;
  destination_car_id uuid;
  next_number integer;
  has_tie boolean;
  selected_ids uuid[];
  automatic_ids uuid[];
  previous_participant_ids uuid[];
begin
  select r.*, source.stage as source_stage, source.status as source_status,
    source.version as actual_source_version, meet.status as meet_status
  into rule
  from public.advancement_rules r
  join public.brackets source on source.id = r.source_bracket_id and source.organisation_id = r.organisation_id
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
  where destination.rule_id = write_advancement.rule_id order by destination.destination_order, bracket.id for update of bracket;
  select snapshot.* into previous from public.advancement_snapshots snapshot
  where snapshot.rule_id = write_advancement.rule_id and snapshot.replaced_by_snapshot_id is null
  order by snapshot.id for update;
  if replacing and not found then raise exception using message = 'MEET_ADVANCEMENT_NOT_FOUND'; end if;
  if not replacing and found then raise exception using message = 'MEET_ADVANCEMENT_EXISTS'; end if;
  if replacing and not (char_length(btrim(reason)) between 1 and 500) then
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
    left join public.advancement_rule_destinations destination on destination.rule_id = write_advancement.rule_id
      and destination.destination_bracket_id = (item->>'destinationBracketId')::uuid
    left join public.brackets destination_bracket on destination_bracket.id = destination.destination_bracket_id
    where source_car.id is null or destination.rule_id is null
      or case destination_bracket.stage when 'qualifier' then 1 when 'semifinal' then 2 else 3 end
         <= case rule.source_stage when 'qualifier' then 1 when 'semifinal' then 2 else 3 end
      or (item->>'rank')::integer not between 1 and 10000
  ) then raise exception using message = 'MEET_INVALID_SELECTION'; end if;
  if exists (
    select 1 from public.cars source_car
    join public.advancement_snapshots source_snapshot on source_snapshot.id = source_car.snapshot_id
    where source_car.bracket_id = rule.source_bracket_id and source_snapshot.stale
  ) then raise exception using message = 'MEET_STALE_SOURCE'; end if;
  if exists (
    select 1
    from public.advancement_rule_destinations destination
    where destination.rule_id = write_advancement.rule_id and
      (select count(*) from public.cars car where car.bracket_id = destination.destination_bracket_id and car.active
        and (not replacing or car.snapshot_id is distinct from previous.id))
      + (select count(*) from jsonb_array_elements(selections) item
         where (item->>'destinationBracketId')::uuid = destination.destination_bracket_id)
      > rule.destination_capacity
  ) then raise exception using message = 'MEET_DESTINATION_CAPACITY'; end if;
  with standings as (
    select car.id, count(heat.id) filter (where heat.winner_car_id = car.id) as wins
    from public.cars car left join public.heats heat on heat.bracket_id = car.bracket_id and heat.status = 'confirmed'
    where car.bracket_id = rule.source_bracket_id and car.active group by car.id
  ), ranked as (
    select id, wins, rank() over (order by wins desc) as place, count(*) over (partition by wins) as tie_size
    from standings
  )
  select coalesce(bool_or(place <= rule.top_n and place + tie_size - 1 >= rule.top_n and tie_size > 1), false),
         (array_agg(id order by wins desc, id))[1:rule.top_n]
  into has_tie, automatic_ids from ranked;
  if (has_tie or selected_ids <> (select array_agg(id order by id) from unnest(automatic_ids) id))
     and not (char_length(btrim(reason)) between 1 and 500) then
    raise exception using message = 'MEET_REASON_REQUIRED';
  end if;
  if replacing then
    select array_agg(participant_id) into previous_participant_ids
    from public.cars where snapshot_id = previous.id;
    delete from public.cars where snapshot_id = previous.id;
    delete from public.participants participant
    where participant.id = any (coalesce(previous_participant_ids, array[]::uuid[]))
      and not exists (select 1 from public.cars car where car.participant_id = participant.id);
    update public.advancement_snapshots set replaced_by_snapshot_id = snapshot_id where id = previous.id;
  end if;
  insert into public.advancement_snapshots
    (id, organisation_id, meet_id, rule_id, source_bracket_id, source_result_version, confirmed_by, reason, request_id)
  values (snapshot_id, rule.organisation_id, rule.meet_id, rule.id, rule.source_bracket_id,
    source_result_version, actor, nullif(btrim(reason), ''), request_id);
  for selection in
    select item.*, destination.destination_order
    from jsonb_array_elements(selections) with ordinality item(value, ordinality)
    join public.advancement_rule_destinations destination
      on destination.rule_id = write_advancement.rule_id and destination.destination_bracket_id = (item.value->>'destinationBracketId')::uuid
    order by destination.destination_order, (item.value->>'rank')::integer, (item.value->>'sourceCarId')::uuid
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
      (organisation_id, snapshot_id, rule_id, source_bracket_id, source_car_id, destination_bracket_id, destination_car_id, rank)
    values (rule.organisation_id, snapshot_id, rule.id, rule.source_bracket_id,
      (selection.value->>'sourceCarId')::uuid, (selection.value->>'destinationBracketId')::uuid,
      destination_car_id, (selection.value->>'rank')::integer);
  end loop;
  update public.brackets set version = version + 1
  where id in (select destination_bracket_id from public.advancement_rule_destinations where rule_id = write_advancement.rule_id);
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

create or replace function public.confirm_advancement(
  rule_id uuid, source_result_version integer, expected_version integer,
  selections jsonb, reason text, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$ select private_meet.write_advancement(rule_id, source_result_version, expected_version, selections, reason, request_id, false); $$;

create or replace function public.replace_advancement(
  rule_id uuid, source_result_version integer, expected_version integer,
  selections jsonb, reason text, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$ select private_meet.write_advancement(rule_id, source_result_version, expected_version, selections, reason, request_id, true); $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private_meet from public, anon, authenticated;
grant execute on function public.create_organisation(text, text, uuid) to authenticated;
grant execute on function public.create_invitation(uuid, text, timestamptz, uuid) to authenticated;
grant execute on function public.redeem_invitation(text, uuid) to authenticated;
grant execute on function public.remove_membership(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.confirm_heat_winner(uuid, uuid, jsonb, integer, uuid) to authenticated;
grant execute on function public.correct_heat_winner(uuid, uuid, jsonb, integer, text, uuid) to authenticated;
grant execute on function public.confirm_advancement(uuid, integer, integer, jsonb, text, uuid) to authenticated;
grant execute on function public.replace_advancement(uuid, integer, integer, jsonb, text, uuid) to authenticated;

comment on function public.create_invitation(uuid, text, timestamptz, uuid) is 'Returns a random invitation code once; only its SHA-256 digest is stored.';
comment on function public.confirm_heat_winner(uuid, uuid, jsonb, integer, uuid) is 'Atomic optimistic winner confirmation with same-transaction audit and stale propagation.';
comment on function public.confirm_advancement(uuid, integer, integer, jsonb, text, uuid) is 'Atomic optimistic advancement snapshot, lineage copy and audit.';
