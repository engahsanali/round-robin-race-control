-- REGISTRATION AUDIT REASSIGNMENT FIX V8

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
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  bracket_row record;
  result jsonb;
  item jsonb;
  before_count integer;
  stale_advancement_count integer := 0;
  before_registration_rows jsonb := '{}'::jsonb;
  after_registration_row jsonb;
begin
  select bracket.*, meet.status as meet_status into bracket_row
  from public.brackets bracket
  join public.meets meet on meet.id = bracket.meet_id and meet.organisation_id = bracket.organisation_id
  where bracket.id = target_bracket_id
  for update of bracket, meet;
  if not found then raise exception using message = 'MEET_BRACKET_NOT_FOUND'; end if;
  if actor is null or not private_meet.has_org_role(
    bracket_row.organisation_id, array['owner', 'admin', 'organiser']
  ) then raise exception using message = 'MEET_FORBIDDEN'; end if;
  if request_id is null then raise exception using message = 'MEET_REQUEST_ID_REQUIRED'; end if;
  select event.after_state into result from public.audit_events event
  where event.organisation_id = bracket_row.organisation_id
    and event.request_id = save_registration_batch.request_id
    and event.action = 'registration.batch_saved';
  if result is not null then return result; end if;
  if bracket_row.version <> expected_version then raise exception using message = 'MEET_VERSION_CONFLICT'; end if;
  if bracket_row.meet_status = 'completed' or bracket_row.status = 'completed' then
    raise exception using message = 'MEET_STATUS_CONFLICT';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) not between 1 and 500 then
    raise exception using message = 'MEET_INVALID_REGISTRATION_BATCH';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows) row_value
    where jsonb_typeof(row_value) <> 'object'
      or not (row_value ?& array['participantId', 'participantName', 'email', 'phone', 'notes', 'carId', 'carNumber', 'carName', 'active'])
      or row_value - array['participantId', 'participantName', 'email', 'phone', 'notes', 'carId', 'carNumber', 'carName', 'active'] <> '{}'::jsonb
      or coalesce(row_value->>'participantId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(row_value->>'carId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or char_length(btrim(coalesce(row_value->>'participantName', ''))) not between 1 and 200
      or char_length(coalesce(row_value->>'email', '')) > 320
      or char_length(coalesce(row_value->>'phone', '')) > 50
      or char_length(coalesce(row_value->>'notes', '')) > 2000
      or char_length(btrim(coalesce(row_value->>'carName', ''))) not between 1 and 200
      or jsonb_typeof(row_value->'carNumber') <> 'number'
      or coalesce(row_value->>'carNumber', '') !~ '^[0-9]+$'
      or (row_value->>'carNumber')::integer not between 1 and 999999
      or jsonb_typeof(row_value->'active') <> 'boolean'
  ) then raise exception using message = 'MEET_INVALID_REGISTRATION_ROW'; end if;
  if exists (
    select 1 from jsonb_array_elements(rows) row_value
    group by row_value->>'carId' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(rows) row_value
    group by (row_value->>'carNumber')::integer having count(*) > 1
  ) then raise exception using message = 'MEET_DUPLICATE_CAR_NUMBER'; end if;
  if exists (
    select 1 from jsonb_array_elements(rows) row_value
    group by row_value->>'participantId'
    having count(distinct jsonb_build_array(row_value->>'participantName', row_value->>'email', row_value->>'phone', row_value->>'notes')) > 1
  ) then raise exception using message = 'MEET_PARTICIPANT_CONFLICT'; end if;
  if exists (
    select 1 from public.participants participant
    join jsonb_array_elements(rows) row_value on participant.id = (row_value->>'participantId')::uuid
    where participant.organisation_id <> bracket_row.organisation_id
      or participant.bracket_id <> target_bracket_id
  ) or exists (
    select 1 from public.cars car
    join jsonb_array_elements(rows) row_value on car.id = (row_value->>'carId')::uuid
    where car.organisation_id <> bracket_row.organisation_id
      or car.bracket_id <> target_bracket_id
  ) then raise exception using message = 'MEET_CROSS_ORGANISATION_REFERENCE'; end if;
  if exists (
    select 1 from public.cars car
    join jsonb_array_elements(rows) row_value on car.id = (row_value->>'carId')::uuid
    where car.source_bracket_id is not null or car.source_car_id is not null
      or car.rule_id is not null or car.snapshot_id is not null
  ) then raise exception using message = 'MEET_REGISTRATION_LINEAGE_LOCKED'; end if;
  if exists (
    select 1 from public.participants participant
    join jsonb_array_elements(rows) row_value
      on participant.id = (row_value->>'participantId')::uuid
    join public.cars lineage_car on lineage_car.participant_id = participant.id
    where lineage_car.source_bracket_id is not null or lineage_car.source_car_id is not null
      or lineage_car.rule_id is not null or lineage_car.snapshot_id is not null
  ) then raise exception using message = 'MEET_REGISTRATION_LINEAGE_LOCKED'; end if;
  if exists (
    select 1 from jsonb_array_elements(rows) row_value
    join public.cars car on car.bracket_id = target_bracket_id
      and car.car_number = (row_value->>'carNumber')::integer
      and car.id <> (row_value->>'carId')::uuid
  ) then raise exception using message = 'MEET_DUPLICATE_CAR_NUMBER'; end if;
  if exists (
    select 1 from jsonb_array_elements(rows) row_value
    join public.cars car on car.id = (row_value->>'carId')::uuid and car.active
    join public.heats heat on heat.bracket_id = car.bracket_id
      and car.id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id)
    where not (row_value->>'active')::boolean
  ) then raise exception using message = 'MEET_REGISTRATION_SCHEDULED'; end if;

  select count(*) into before_count from public.cars car where car.bracket_id = target_bracket_id;
  select coalesce(jsonb_object_agg((row_value->>'carId'), jsonb_build_object(
    'participant', to_jsonb(previous_participant), 'car', to_jsonb(existing_car)
  )), '{}'::jsonb)
  into before_registration_rows
  from jsonb_array_elements(rows) row_value
  left join public.cars existing_car on existing_car.id = (row_value->>'carId')::uuid
  left join public.participants previous_participant on previous_participant.id = existing_car.participant_id;
  for item in
    select distinct on (row_value->>'participantId') row_value
    from jsonb_array_elements(rows) row_value
    order by row_value->>'participantId', row_value->>'carId'
  loop
    insert into public.participants (id, organisation_id, bracket_id, name, email, phone, notes)
    values ((item->>'participantId')::uuid, bracket_row.organisation_id, target_bracket_id,
      btrim(item->>'participantName'), item->>'email', item->>'phone', item->>'notes')
    on conflict (id) do update set name = excluded.name, email = excluded.email,
      phone = excluded.phone, notes = excluded.notes;
  end loop;
  for item in select row_value from jsonb_array_elements(rows) row_value order by row_value->>'carId'
  loop
    insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name, active)
    values ((item->>'carId')::uuid, bracket_row.organisation_id, target_bracket_id,
      (item->>'participantId')::uuid, (item->>'carNumber')::integer,
      btrim(item->>'carName'), (item->>'active')::boolean)
    on conflict (id) do update set participant_id = excluded.participant_id,
      car_number = excluded.car_number, name = excluded.name, active = excluded.active;
    select jsonb_build_object('participant', to_jsonb(participant), 'car', to_jsonb(car))
    into after_registration_row from public.cars car
    join public.participants participant on participant.id = car.participant_id
    where car.id = (item->>'carId')::uuid;
    insert into public.audit_events
      (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, request_id)
    values (bracket_row.organisation_id, bracket_row.meet_id, target_bracket_id, actor,
      'registration.row_saved.' || (item->>'carId'), 'car', (item->>'carId')::uuid,
      coalesce(before_registration_rows->(item->>'carId'), '{}'::jsonb),
      after_registration_row, request_id);
  end loop;
  with recursive stale_chain(id) as (
    select snapshot.id from public.advancement_snapshots snapshot
    where snapshot.source_bracket_id = target_bracket_id
      and snapshot.replaced_by_snapshot_id is null
    union
    select snapshot.id from public.advancement_snapshots snapshot
    join public.cars source_car on source_car.bracket_id = snapshot.source_bracket_id and source_car.active
    join stale_chain upstream on upstream.id = source_car.snapshot_id
    where snapshot.replaced_by_snapshot_id is null
  )
  update public.advancement_snapshots snapshot set stale = true
  where snapshot.id in (select id from stale_chain) and not snapshot.stale;
  get diagnostics stale_advancement_count = row_count;
  update public.brackets set version = version + 1 where id = target_bracket_id;
  update public.meets set version = version + 1 where id = bracket_row.meet_id;
  result := jsonb_build_object('bracket_id', target_bracket_id, 'version', bracket_row.version + 1,
    'saved_count', jsonb_array_length(rows), 'stale_advancement_count', stale_advancement_count);
  insert into public.audit_events
    (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
     before_state, after_state, request_id)
  values (bracket_row.organisation_id, bracket_row.meet_id, target_bracket_id, actor,
    'registration.batch_saved', 'bracket', target_bracket_id,
    jsonb_build_object('car_count', before_count, 'version', bracket_row.version), result, request_id);
  return result;
end;
$$;

revoke execute on function public.save_registration_batch(uuid, integer, jsonb, uuid) from public, anon;
grant execute on function public.save_registration_batch(uuid, integer, jsonb, uuid) to authenticated;

comment on function public.save_registration_batch(uuid, integer, jsonb, uuid) is
  'Atomically upserts bracket registration with optimistic concurrency and prior-owner audit snapshots for car reassignments.';
