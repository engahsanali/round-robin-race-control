-- WORKBOOK COMMANDS V7

alter table public.audit_events drop constraint audit_events_organisation_id_bracket_id_fkey;
alter table public.audit_events
  add constraint audit_events_bracket_id_fkey
  foreign key (organisation_id, bracket_id) references public.brackets(organisation_id, id)
  on delete set null (bracket_id);

create or replace function public.save_meet_workbook(
  target_organisation_id uuid,
  target_meet_id uuid,
  expected_version integer,
  workbook jsonb,
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
  meet_row public.meets%rowtype;
  saved_meet_id uuid := coalesce(target_meet_id, extensions.gen_random_uuid());
  result jsonb;
  bracket_item jsonb;
  rule_item jsonb;
  destination_item jsonb;
  bracket_count integer;
  next_version integer;
  is_create boolean := target_meet_id is null;
  has_snapshots boolean := false;
  before_meet_state jsonb := '{}'::jsonb;
  before_brackets jsonb := '{}'::jsonb;
  before_rules jsonb := '{}'::jsonb;
  after_entity jsonb;
  removed_id uuid;
begin
  if actor is null or not private_meet.has_org_role(
    target_organisation_id, array['owner', 'admin', 'organiser']
  ) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  if request_id is null then raise exception using message = 'MEET_REQUEST_ID_REQUIRED'; end if;

  perform organisation.id from public.organisations organisation
  where organisation.id = target_organisation_id for update;
  if not found then raise exception using message = 'MEET_ORGANISATION_NOT_FOUND'; end if;

  select event.after_state into result
  from public.audit_events event
  where event.organisation_id = target_organisation_id
    and event.request_id = save_meet_workbook.request_id
    and event.action = 'meet.workbook_saved';
  if result is not null then return result; end if;

  if not is_create then
    select meet.* into meet_row from public.meets meet
    where meet.id = target_meet_id and meet.organisation_id = target_organisation_id
    for update;
    if not found then raise exception using message = 'MEET_NOT_FOUND'; end if;
    if expected_version is null or meet_row.version <> expected_version then
      raise exception using message = 'MEET_VERSION_CONFLICT';
    end if;
    select exists (
      select 1 from public.advancement_snapshots snapshot where snapshot.meet_id = saved_meet_id
    ) into has_snapshots;
  elsif expected_version is not null then
    raise exception using message = 'MEET_VERSION_CONFLICT';
  end if;

  if workbook is null or jsonb_typeof(workbook) <> 'object'
     or workbook - array['meet', 'brackets', 'rules'] <> '{}'::jsonb
     or jsonb_typeof(workbook->'meet') <> 'object'
     or jsonb_typeof(workbook->'brackets') <> 'array'
     or jsonb_typeof(workbook->'rules') <> 'array' then
    raise exception using message = 'MEET_INVALID_WORKBOOK';
  end if;
  if jsonb_array_length(workbook->'brackets') not between 1 and 15 then
    raise exception using message = 'MEET_BRACKET_LIMIT';
  end if;
  if jsonb_array_length(workbook->'rules') > 100 then
    raise exception using message = 'MEET_RULE_LIMIT';
  end if;
  if not (workbook->'meet' ?& array['name', 'venue', 'meetDate', 'status', 'settings'])
     or workbook->'meet' - array['name', 'venue', 'meetDate', 'status', 'settings'] <> '{}'::jsonb
     or char_length(btrim(coalesce(workbook->'meet'->>'name', ''))) not between 1 and 200
     or char_length(coalesce(workbook->'meet'->>'venue', '')) > 200
     or coalesce(workbook->'meet'->>'meetDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(workbook->'meet'->>'status', '') not in ('setup', 'running', 'completed')
     or jsonb_typeof(workbook->'meet'->'settings') <> 'object'
     or pg_column_size(workbook->'meet'->'settings') > 32768 then
    raise exception using message = 'MEET_INVALID_MEET';
  end if;

  if exists (
    select 1 from jsonb_array_elements(workbook->'brackets') item
    where jsonb_typeof(item) <> 'object'
      or not (item ?& array['id', 'name', 'stage', 'displayOrder', 'status', 'settings'])
      or item - array['id', 'name', 'stage', 'displayOrder', 'status', 'settings'] <> '{}'::jsonb
      or coalesce(item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or char_length(btrim(coalesce(item->>'name', ''))) not between 1 and 200
      or coalesce(item->>'stage', '') not in ('qualifier', 'semifinal', 'final')
      or jsonb_typeof(item->'displayOrder') <> 'number'
      or coalesce(item->>'displayOrder', '') !~ '^[0-9]+$'
      or (item->>'displayOrder')::integer not between 1 and 15
      or coalesce(item->>'status', '') not in ('setup', 'running', 'completed')
      or jsonb_typeof(item->'settings') <> 'object'
      or pg_column_size(item->'settings') > 32768
  ) then raise exception using message = 'MEET_INVALID_BRACKET'; end if;
  if exists (
    select 1 from jsonb_array_elements(workbook->'brackets') item
    group by item->>'id' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(workbook->'brackets') item
    group by (item->>'displayOrder')::integer having count(*) > 1
  ) then raise exception using message = 'MEET_DUPLICATE_BRACKET'; end if;

  if exists (
    select 1 from jsonb_array_elements(workbook->'rules') rule
    where jsonb_typeof(rule) <> 'object'
      or not (rule ?& array['id', 'sourceBracketId', 'topN', 'destinationCapacity', 'status', 'destinations'])
      or rule - array['id', 'sourceBracketId', 'topN', 'destinationCapacity', 'status', 'destinations'] <> '{}'::jsonb
      or coalesce(rule->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(rule->>'sourceBracketId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(rule->'topN') <> 'number' or coalesce(rule->>'topN', '') !~ '^[0-9]+$'
      or (rule->>'topN')::integer not between 1 and 10000
      or jsonb_typeof(rule->'destinationCapacity') <> 'number'
      or coalesce(rule->>'destinationCapacity', '') !~ '^[0-9]+$'
      or (rule->>'destinationCapacity')::integer not between 1 and 10000
      or coalesce(rule->>'status', '') not in ('active', 'disabled')
      or jsonb_typeof(rule->'destinations') <> 'array'
      or jsonb_array_length(rule->'destinations') not between 1 and 15
  ) then raise exception using message = 'MEET_INVALID_ADVANCEMENT_RULE'; end if;
  if exists (
    select 1 from jsonb_array_elements(workbook->'rules') rule
    group by rule->>'id' having count(*) > 1
  ) then raise exception using message = 'MEET_DUPLICATE_ADVANCEMENT_RULE'; end if;
  if exists (
    select 1
    from jsonb_array_elements(workbook->'rules') rule
    cross join lateral jsonb_array_elements(rule->'destinations') destination
    where jsonb_typeof(destination) <> 'object'
      or not (destination ?& array['bracketId', 'order'])
      or destination - array['bracketId', 'order'] <> '{}'::jsonb
      or coalesce(destination->>'bracketId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(destination->'order') <> 'number'
      or coalesce(destination->>'order', '') !~ '^[0-9]+$'
      or (destination->>'order')::integer not between 1 and 15
  ) then raise exception using message = 'MEET_INVALID_ADVANCEMENT_DESTINATION'; end if;
  if exists (
    select 1
    from jsonb_array_elements(workbook->'rules') rule
    cross join lateral jsonb_array_elements(rule->'destinations') destination
    group by rule->>'id', destination->>'bracketId' having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(workbook->'rules') rule
    cross join lateral jsonb_array_elements(rule->'destinations') destination
    group by rule->>'id', (destination->>'order')::integer having count(*) > 1
  ) then raise exception using message = 'MEET_DUPLICATE_ADVANCEMENT_DESTINATION'; end if;

  if exists (
    select 1 from jsonb_array_elements(workbook->'rules') rule
    where not exists (
      select 1 from jsonb_array_elements(workbook->'brackets') bracket
      where bracket->>'id' = rule->>'sourceBracketId'
    )
  ) then raise exception using message = 'MEET_UNKNOWN_SOURCE_BRACKET'; end if;
  if exists (
    select 1
    from jsonb_array_elements(workbook->'rules') rule
    cross join lateral jsonb_array_elements(rule->'destinations') destination
    where not exists (
      select 1 from jsonb_array_elements(workbook->'brackets') bracket
      where bracket->>'id' = destination->>'bracketId'
    )
  ) then raise exception using message = 'MEET_UNKNOWN_DESTINATION_BRACKET'; end if;
  if exists (
    select 1
    from jsonb_array_elements(workbook->'rules') rule
    join jsonb_array_elements(workbook->'brackets') source on source->>'id' = rule->>'sourceBracketId'
    cross join lateral jsonb_array_elements(rule->'destinations') destination
    join jsonb_array_elements(workbook->'brackets') target on target->>'id' = destination->>'bracketId'
    where case target->>'stage' when 'qualifier' then 1 when 'semifinal' then 2 else 3 end
       <= case source->>'stage' when 'qualifier' then 1 when 'semifinal' then 2 else 3 end
  ) then raise exception using message = 'MEET_INVALID_STAGE_ORDER'; end if;
  if exists (
    with recursive edges(source_id, destination_id) as (
      select (rule->>'sourceBracketId')::uuid, (destination->>'bracketId')::uuid
      from jsonb_array_elements(workbook->'rules') rule
      cross join lateral jsonb_array_elements(rule->'destinations') destination
    ), walk(origin_id, node_id, visited, is_cycle) as (
      select edge.source_id, edge.destination_id, array[edge.source_id, edge.destination_id],
        edge.source_id = edge.destination_id from edges edge
      union all
      select walk.origin_id, edge.destination_id, walk.visited || edge.destination_id,
        edge.destination_id = any(walk.visited)
      from walk join edges edge on edge.source_id = walk.node_id
      where not walk.is_cycle
    )
    select 1 from walk where is_cycle
  ) then raise exception using message = 'MEET_ADVANCEMENT_CYCLE'; end if;
  if exists (
    select 1 from jsonb_array_elements(workbook->'rules') rule
    where (rule->>'topN')::integer
      > (rule->>'destinationCapacity')::integer * jsonb_array_length(rule->'destinations')
  ) then raise exception using message = 'MEET_DESTINATION_CAPACITY'; end if;
  if exists (
    select 1
    from jsonb_array_elements(workbook->'rules') rule
    cross join lateral jsonb_array_elements(rule->'destinations') destination
    group by destination->>'bracketId'
    having count(distinct (rule->>'destinationCapacity')::integer) > 1
  ) then raise exception using message = 'MEET_INCONSISTENT_DESTINATION_CAPACITY'; end if;
  if not has_snapshots and exists (
    with recursive bracket_payload as (
      select (item->>'id')::uuid as id, (item->>'displayOrder')::integer as display_order
      from jsonb_array_elements(workbook->'brackets') item
    ), rule_payload as (
      select (item->>'id')::uuid as id, (item->>'sourceBracketId')::uuid as source_id,
        (item->>'topN')::integer as top_n, (item->>'destinationCapacity')::integer as capacity,
        item->'destinations' as destinations
      from jsonb_array_elements(workbook->'rules') item
    ), destination_payload as (
      select rule.id as rule_id, (destination->>'bracketId')::uuid as destination_id,
        (destination->>'order')::integer as destination_order
      from rule_payload rule cross join lateral jsonb_array_elements(rule.destinations) destination
    ), allocation_units as (
      select row_number() over (order by source.display_order, rule.id, unit)::integer as step_no,
        rule.id as rule_id, rule.capacity
      from rule_payload rule join bracket_payload source on source.id = rule.source_id
      cross join lateral generate_series(1, rule.top_n) unit
    ), initial_counts as (
      select coalesce(jsonb_object_agg(destination.id::text,
        to_jsonb((select count(*)::integer from public.cars car
          where car.bracket_id = destination.id and car.active))), '{}'::jsonb) as counts
      from (select distinct destination_id as id from destination_payload) destination
    ), allocation(step_no, counts, failed) as (
      select 0, initial_counts.counts, false from initial_counts
      union all
      select unit.step_no,
        case when choice.destination_id is null then allocation.counts
          else jsonb_set(allocation.counts, array[choice.destination_id::text],
            to_jsonb(coalesce((allocation.counts->>choice.destination_id::text)::integer, 0) + 1), true)
        end,
        choice.destination_id is null
      from allocation
      join allocation_units unit on unit.step_no = allocation.step_no + 1
      left join lateral (
        select destination.destination_id
        from destination_payload destination
        where destination.rule_id = unit.rule_id
          and coalesce((allocation.counts->>destination.destination_id::text)::integer, 0) < unit.capacity
        order by coalesce((allocation.counts->>destination.destination_id::text)::integer, 0),
          destination.destination_order, destination.destination_id
        limit 1
      ) choice on true
      where not allocation.failed
    )
    select 1 from allocation where failed
  ) then raise exception using message = 'MEET_DESTINATION_CAPACITY'; end if;

  if exists (
    select 1 from public.brackets bracket
    join jsonb_array_elements(workbook->'brackets') item on bracket.id = (item->>'id')::uuid
    where bracket.organisation_id <> target_organisation_id
      or bracket.meet_id <> saved_meet_id
  ) or exists (
    select 1 from public.advancement_rules rule
    join jsonb_array_elements(workbook->'rules') item on rule.id = (item->>'id')::uuid
    where rule.organisation_id <> target_organisation_id
      or rule.meet_id <> saved_meet_id
  ) then raise exception using message = 'MEET_CROSS_ORGANISATION_REFERENCE'; end if;

  if not is_create then
    select count(*) into bracket_count from public.brackets bracket where bracket.meet_id = saved_meet_id;
    if bracket_count > 15 then raise exception using message = 'MEET_BRACKET_LIMIT'; end if;
    if has_snapshots and (
      bracket_count <> jsonb_array_length(workbook->'brackets')
      or (select count(*) from public.advancement_rules rule where rule.meet_id = saved_meet_id)
        <> jsonb_array_length(workbook->'rules')
      or exists (
        select 1 from public.brackets bracket
        where bracket.meet_id = saved_meet_id and not exists (
          select 1 from jsonb_array_elements(workbook->'brackets') item
          where (item->>'id')::uuid = bracket.id
            and item->>'stage' = bracket.stage
            and (item->>'displayOrder')::integer = bracket.display_order
            and item->'settings' = bracket.settings
        )
      )
      or exists (
        select 1 from public.advancement_rules rule
        where rule.meet_id = saved_meet_id and not exists (
          select 1 from jsonb_array_elements(workbook->'rules') item
          where (item->>'id')::uuid = rule.id
            and (item->>'sourceBracketId')::uuid = rule.source_bracket_id
            and (item->>'topN')::integer = rule.top_n
            and (item->>'destinationCapacity')::integer = rule.destination_capacity
            and item->>'status' = rule.status
            and coalesce((
              select jsonb_agg(jsonb_build_object('bracketId', destination.destination_bracket_id,
                'order', destination.destination_order) order by destination.destination_order, destination.destination_bracket_id)
              from public.advancement_rule_destinations destination where destination.rule_id = rule.id
            ), '[]'::jsonb) = coalesce((
              select jsonb_agg(jsonb_build_object('bracketId', destination->>'bracketId',
                'order', (destination->>'order')::integer) order by (destination->>'order')::integer,
                destination->>'bracketId')
              from jsonb_array_elements(item->'destinations') destination
            ), '[]'::jsonb)
        )
      )
    ) then raise exception using message = 'MEET_WORKBOOK_IN_USE'; end if;
    if exists (
      select 1 from public.advancement_rules rule
      where rule.meet_id = saved_meet_id
        and not exists (select 1 from jsonb_array_elements(workbook->'rules') item where (item->>'id')::uuid = rule.id)
        and exists (select 1 from public.advancement_snapshots snapshot where snapshot.rule_id = rule.id)
    ) then raise exception using message = 'MEET_WORKBOOK_IN_USE'; end if;
    if exists (
      select 1 from public.brackets bracket
      where bracket.meet_id = saved_meet_id
        and not exists (select 1 from jsonb_array_elements(workbook->'brackets') item where (item->>'id')::uuid = bracket.id)
        and (
          exists (select 1 from public.participants participant where participant.bracket_id = bracket.id)
          or exists (select 1 from public.heats heat where heat.bracket_id = bracket.id)
          or exists (select 1 from public.advancement_snapshots snapshot where snapshot.source_bracket_id = bracket.id)
          or exists (select 1 from public.advancement_selections selection where selection.destination_bracket_id = bracket.id)
        )
    ) then raise exception using message = 'MEET_WORKBOOK_IN_USE'; end if;
  end if;

  if not is_create then before_meet_state := to_jsonb(meet_row); end if;
  select coalesce(jsonb_object_agg(bracket.id::text, to_jsonb(bracket)), '{}'::jsonb)
  into before_brackets from public.brackets bracket where bracket.meet_id = saved_meet_id;
  select coalesce(jsonb_object_agg(rule.id::text, jsonb_build_object(
    'rule', to_jsonb(rule),
    'destinations', coalesce((select jsonb_agg(to_jsonb(destination)
      order by destination.destination_order, destination.destination_bracket_id)
      from public.advancement_rule_destinations destination where destination.rule_id = rule.id), '[]'::jsonb)
  )), '{}'::jsonb)
  into before_rules from public.advancement_rules rule where rule.meet_id = saved_meet_id;

  if is_create then
    insert into public.meets (id, organisation_id, name, venue, meet_date, status, settings, created_by)
    values (saved_meet_id, target_organisation_id, btrim(workbook->'meet'->>'name'),
      workbook->'meet'->>'venue', (workbook->'meet'->>'meetDate')::date,
      workbook->'meet'->>'status', workbook->'meet'->'settings', actor)
    returning * into meet_row;
  else
    update public.meets set name = btrim(workbook->'meet'->>'name'),
      venue = workbook->'meet'->>'venue', meet_date = (workbook->'meet'->>'meetDate')::date,
      status = workbook->'meet'->>'status', settings = workbook->'meet'->'settings',
      version = version + 1
    where id = saved_meet_id returning * into meet_row;
  end if;
  insert into public.audit_events
    (organisation_id, meet_id, actor_id, action, entity_type, entity_id,
     before_state, after_state, request_id)
  values (target_organisation_id, saved_meet_id, actor, 'meet.details_saved', 'meet', saved_meet_id,
    before_meet_state, to_jsonb(meet_row), request_id);

  if not has_snapshots then
    update public.brackets existing
    set display_order = 1001 - temporary_order.row_number
    from (
      select bracket.id, row_number() over (order by bracket.display_order, bracket.id)::integer as row_number
      from public.brackets bracket where bracket.meet_id = saved_meet_id
    ) temporary_order
    where existing.id = temporary_order.id;
  end if;

  for bracket_item in select item from jsonb_array_elements(workbook->'brackets') item
    order by (item->>'displayOrder')::integer, (item->>'id')::uuid
  loop
    insert into public.brackets
      (id, organisation_id, meet_id, name, stage, display_order, status, settings)
    values ((bracket_item->>'id')::uuid, target_organisation_id, saved_meet_id,
      btrim(bracket_item->>'name'), bracket_item->>'stage', (bracket_item->>'displayOrder')::integer,
      bracket_item->>'status', bracket_item->'settings')
    on conflict (id) do update set name = excluded.name, stage = excluded.stage,
      display_order = excluded.display_order, status = excluded.status, settings = excluded.settings,
      version = case when has_snapshots then public.brackets.version else public.brackets.version + 1 end;
    select to_jsonb(bracket) into after_entity from public.brackets bracket
    where bracket.id = (bracket_item->>'id')::uuid;
    insert into public.audit_events
      (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, request_id)
    values (target_organisation_id, saved_meet_id, (bracket_item->>'id')::uuid, actor,
      'meet.bracket_saved.' || (bracket_item->>'id'), 'bracket', (bracket_item->>'id')::uuid,
      coalesce(before_brackets->(bracket_item->>'id'), '{}'::jsonb), after_entity, request_id);
  end loop;

  for removed_id in
    select rule.id from public.advancement_rules rule where rule.meet_id = saved_meet_id
      and not exists (select 1 from jsonb_array_elements(workbook->'rules') item where (item->>'id')::uuid = rule.id)
  loop
    insert into public.audit_events
      (organisation_id, meet_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, request_id)
    values (target_organisation_id, saved_meet_id, actor, 'meet.rule_removed.' || removed_id::text,
      'advancement_rule', removed_id, coalesce(before_rules->(removed_id::text), '{}'::jsonb), '{}'::jsonb, request_id);
  end loop;

  delete from public.advancement_rule_destinations destination
  using public.advancement_rules rule
  where destination.rule_id = rule.id and rule.meet_id = saved_meet_id;
  delete from public.advancement_rules rule
  where rule.meet_id = saved_meet_id
    and not exists (select 1 from jsonb_array_elements(workbook->'rules') item where (item->>'id')::uuid = rule.id);

  for rule_item in select item from jsonb_array_elements(workbook->'rules') item
    order by (item->>'sourceBracketId')::uuid, (item->>'id')::uuid
  loop
    insert into public.advancement_rules
      (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity, status)
    values ((rule_item->>'id')::uuid, target_organisation_id, saved_meet_id,
      (rule_item->>'sourceBracketId')::uuid, (rule_item->>'topN')::integer,
      (rule_item->>'destinationCapacity')::integer, rule_item->>'status')
    on conflict (id) do update set source_bracket_id = excluded.source_bracket_id,
      top_n = excluded.top_n, destination_capacity = excluded.destination_capacity,
      status = excluded.status,
      version = case when has_snapshots then public.advancement_rules.version else public.advancement_rules.version + 1 end;
    for destination_item in select item from jsonb_array_elements(rule_item->'destinations') item
      order by (item->>'order')::integer, (item->>'bracketId')::uuid
    loop
      insert into public.advancement_rule_destinations
        (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
      values (target_organisation_id, saved_meet_id, (rule_item->>'id')::uuid,
        (destination_item->>'bracketId')::uuid, (destination_item->>'order')::integer);
    end loop;
    select jsonb_build_object('rule', to_jsonb(rule),
      'destinations', coalesce((select jsonb_agg(to_jsonb(destination)
        order by destination.destination_order, destination.destination_bracket_id)
        from public.advancement_rule_destinations destination where destination.rule_id = rule.id), '[]'::jsonb))
    into after_entity from public.advancement_rules rule where rule.id = (rule_item->>'id')::uuid;
    insert into public.audit_events
      (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, request_id)
    values (target_organisation_id, saved_meet_id, (rule_item->>'sourceBracketId')::uuid, actor,
      'meet.rule_saved.' || (rule_item->>'id'), 'advancement_rule', (rule_item->>'id')::uuid,
      coalesce(before_rules->(rule_item->>'id'), '{}'::jsonb), after_entity, request_id);
  end loop;

  for removed_id in
    select bracket.id from public.brackets bracket where bracket.meet_id = saved_meet_id
      and not exists (select 1 from jsonb_array_elements(workbook->'brackets') item where (item->>'id')::uuid = bracket.id)
  loop
    insert into public.audit_events
      (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, request_id)
    values (target_organisation_id, saved_meet_id, null, actor,
      'meet.bracket_removed.' || removed_id::text, 'bracket', removed_id,
      coalesce(before_brackets->(removed_id::text), '{}'::jsonb), '{}'::jsonb, request_id);
  end loop;
  delete from public.brackets bracket
  where bracket.meet_id = saved_meet_id
    and not exists (select 1 from jsonb_array_elements(workbook->'brackets') item where (item->>'id')::uuid = bracket.id);

  next_version := meet_row.version;
  result := jsonb_build_object('meet_id', saved_meet_id, 'version', next_version,
    'bracket_count', jsonb_array_length(workbook->'brackets'),
    'rule_count', jsonb_array_length(workbook->'rules'));
  insert into public.audit_events
    (organisation_id, meet_id, actor_id, action, entity_type, entity_id,
     before_state, after_state, request_id)
  values (target_organisation_id, saved_meet_id, actor, 'meet.workbook_saved', 'meet', saved_meet_id,
    case when is_create then '{}'::jsonb else jsonb_build_object('version', expected_version) end,
    result, request_id);
  return result;
end;
$$;

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
    'participant', to_jsonb(participant), 'car', to_jsonb(car)
  )), '{}'::jsonb)
  into before_registration_rows
  from jsonb_array_elements(rows) row_value
  left join public.participants participant on participant.id = (row_value->>'participantId')::uuid
  left join public.cars car on car.id = (row_value->>'carId')::uuid;
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

create or replace function public.activate_bracket_schedule(
  target_bracket_id uuid,
  expected_version integer,
  schedule jsonb,
  replacement_reason text,
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
  heat_item jsonb;
  pending_count integer;
  computed_repeat_excess integer;
  computed_lower_bound integer;
  computed_max_pair_frequency integer;
  computed_max_car_repeat_burden integer;
  computed_lane_spread integer;
  computed_appearance_imbalance integer;
  heat_row public.heats%rowtype;
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
    and event.request_id = activate_bracket_schedule.request_id
    and event.action = 'schedule.activated';
  if result is not null then return result; end if;
  if bracket_row.version <> expected_version then raise exception using message = 'MEET_VERSION_CONFLICT'; end if;
  if bracket_row.meet_status = 'completed' or bracket_row.status = 'completed' then
    raise exception using message = 'MEET_STATUS_CONFLICT';
  end if;
  perform 1 from public.heats heat where heat.bracket_id = target_bracket_id
    order by heat.round_number, heat.heat_number, heat.id for update;
  if exists (select 1 from public.heats heat where heat.bracket_id = target_bracket_id and heat.status = 'confirmed') then
    raise exception using message = 'MEET_CONFIRMED_RESULTS_EXIST';
  end if;
  select count(*) into pending_count from public.heats heat where heat.bracket_id = target_bracket_id;
  if pending_count > 0 and (replacement_reason is null or char_length(btrim(replacement_reason)) not between 1 and 500) then
    raise exception using message = 'MEET_REASON_REQUIRED';
  end if;
  if schedule is null or jsonb_typeof(schedule) <> 'object'
     or not (schedule ?& array['seed', 'quality', 'heats'])
     or schedule - array['seed', 'quality', 'heats'] <> '{}'::jsonb
     or char_length(btrim(coalesce(schedule->>'seed', ''))) not between 1 and 128
     or btrim(schedule->>'seed') ~ '[[:cntrl:]]'
     or jsonb_typeof(schedule->'quality') <> 'object'
     or jsonb_typeof(schedule->'heats') <> 'array'
     or jsonb_array_length(schedule->'heats') not between 1 and 10000 then
    raise exception using message = 'MEET_INVALID_SCHEDULE';
  end if;
  if not (schedule->'quality' ?& array['opponentRepeatExcess', 'lowerBound', 'maxPairFrequency', 'maxCarRepeatBurden', 'laneSpread', 'provenOptimal'])
     or schedule->'quality' - array['opponentRepeatExcess', 'lowerBound', 'maxPairFrequency', 'maxCarRepeatBurden', 'laneSpread', 'provenOptimal'] <> '{}'::jsonb
     or exists (
       select 1 from jsonb_each(schedule->'quality') quality
       where quality.key in ('opponentRepeatExcess', 'lowerBound', 'maxPairFrequency', 'maxCarRepeatBurden', 'laneSpread')
         and (jsonb_typeof(quality.value) <> 'number' or quality.value #>> '{}' !~ '^[0-9]+$'
           or (quality.value #>> '{}')::integer not between 0 and 1000000)
     )
     or jsonb_typeof(schedule->'quality'->'provenOptimal') <> 'boolean'
     or (schedule->'quality'->>'opponentRepeatExcess')::integer < (schedule->'quality'->>'lowerBound')::integer
     or (schedule->'quality'->>'maxPairFrequency')::integer < 1 then
    raise exception using message = 'MEET_INVALID_SCHEDULE_QUALITY';
  end if;
  if exists (
    select 1 from jsonb_array_elements(schedule->'heats') heat
    where jsonb_typeof(heat) <> 'object'
      or not (heat ?& array['id', 'roundNumber', 'heatNumber', 'phase', 'lanes'])
      or heat - array['id', 'roundNumber', 'heatNumber', 'phase', 'lanes'] <> '{}'::jsonb
      or coalesce(heat->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(heat->'roundNumber') <> 'number' or coalesce(heat->>'roundNumber', '') !~ '^[0-9]+$'
      or (heat->>'roundNumber')::integer not between 1 and 10000
      or jsonb_typeof(heat->'heatNumber') <> 'number' or coalesce(heat->>'heatNumber', '') !~ '^[0-9]+$'
      or (heat->>'heatNumber')::integer not between 1 and 100000
      or coalesce(heat->>'phase', '') not in ('preliminary', 'final')
      or jsonb_typeof(heat->'lanes') <> 'array'
      or jsonb_array_length(heat->'lanes') not between 2 and 3
      or exists (select 1 from jsonb_array_elements_text(heat->'lanes') lane
        where lane !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or (select count(*) from jsonb_array_elements_text(heat->'lanes'))
        <> (select count(distinct lane) from jsonb_array_elements_text(heat->'lanes') lane)
  ) then raise exception using message = 'MEET_INVALID_HEAT'; end if;
  if exists (
    select 1 from jsonb_array_elements(schedule->'heats') heat group by heat->>'id' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(schedule->'heats') heat
    group by (heat->>'roundNumber')::integer, (heat->>'heatNumber')::integer having count(*) > 1
  ) then raise exception using message = 'MEET_DUPLICATE_HEAT'; end if;
  if exists (
    select 1
    from jsonb_array_elements(schedule->'heats') heat
    cross join lateral jsonb_array_elements_text(heat->'lanes') lane
    group by (heat->>'roundNumber')::integer, lane
    having count(*) > 1
  ) then raise exception using message = 'MEET_DUPLICATE_ROUND_APPEARANCE'; end if;
  if exists (
    select 1
    from jsonb_array_elements(schedule->'heats') heat
    cross join lateral jsonb_array_elements_text(heat->'lanes') lane
    left join public.cars car on car.id = lane::uuid and car.organisation_id = bracket_row.organisation_id
      and car.bracket_id = target_bracket_id and car.active
    where car.id is null
  ) then raise exception using message = 'MEET_SCHEDULE_CAR_NOT_ACTIVE'; end if;
  if exists (
    select 1 from public.heats existing
    join jsonb_array_elements(schedule->'heats') heat on existing.id = (heat->>'id')::uuid
    where existing.bracket_id <> target_bracket_id or existing.organisation_id <> bracket_row.organisation_id
  ) then raise exception using message = 'MEET_CROSS_ORGANISATION_REFERENCE'; end if;

  with active_cars as (
    select car.id from public.cars car where car.bracket_id = target_bracket_id and car.active
  ), lane_assignments as (
    select heat->>'id' as heat_id, (heat->>'roundNumber')::integer as round_number,
      lane.ordinality::integer as lane_number, lane.car_id::uuid as car_id
    from jsonb_array_elements(schedule->'heats') heat
    cross join lateral jsonb_array_elements_text(heat->'lanes') with ordinality lane(car_id, ordinality)
  ), appearances as (
    select active.id, count(assignment.car_id)::integer as appearance_count,
      count(*) filter (where assignment.lane_number = 1)::integer as lane_1_count,
      count(*) filter (where assignment.lane_number = 2)::integer as lane_2_count,
      count(*) filter (where assignment.lane_number = 3)::integer as lane_3_count
    from active_cars active left join lane_assignments assignment on assignment.car_id = active.id
    group by active.id
  ), pair_counts as (
    select least(first.car_id, second.car_id) as first_car_id,
      greatest(first.car_id, second.car_id) as second_car_id, count(*)::integer as meetings
    from lane_assignments first join lane_assignments second
      on second.heat_id = first.heat_id and second.lane_number > first.lane_number
    group by least(first.car_id, second.car_id), greatest(first.car_id, second.car_id)
  ), car_burdens as (
    select active.id,
      coalesce(sum(greatest(pair.meetings - 1, 0)) filter (
        where active.id in (pair.first_car_id, pair.second_car_id)
      ), 0)::integer as burden
    from active_cars active left join pair_counts pair
      on active.id in (pair.first_car_id, pair.second_car_id)
    group by active.id
  )
  select
    coalesce((select sum(greatest(pair.meetings - 1, 0))::integer from pair_counts pair), 0),
    greatest(0, coalesce((select sum(pair.meetings)::integer from pair_counts pair), 0)
      - ((select count(*)::integer from active_cars) * ((select count(*)::integer from active_cars) - 1) / 2)),
    coalesce((select max(pair.meetings) from pair_counts pair), 0),
    coalesce((select max(burden.burden) from car_burdens burden), 0),
    coalesce((select max(greatest(appearance.lane_1_count, appearance.lane_2_count, appearance.lane_3_count)
      - least(appearance.lane_1_count, appearance.lane_2_count, appearance.lane_3_count)) from appearances appearance), 0),
    coalesce((select max(appearance.appearance_count) - min(appearance.appearance_count) from appearances appearance), 0)
  into computed_repeat_excess, computed_lower_bound, computed_max_pair_frequency,
    computed_max_car_repeat_burden, computed_lane_spread, computed_appearance_imbalance;

  if computed_appearance_imbalance > 1 then
    raise exception using message = 'MEET_UNBALANCED_APPEARANCES';
  end if;
  if computed_lane_spread > 1 then
    raise exception using message = 'MEET_UNBALANCED_LANES';
  end if;
  if (schedule->'quality'->>'opponentRepeatExcess')::integer <> computed_repeat_excess
     or (schedule->'quality'->>'lowerBound')::integer <> computed_lower_bound
     or (schedule->'quality'->>'maxPairFrequency')::integer <> computed_max_pair_frequency
     or (schedule->'quality'->>'maxCarRepeatBurden')::integer <> computed_max_car_repeat_burden
     or (schedule->'quality'->>'laneSpread')::integer <> computed_lane_spread
     or (schedule->'quality'->>'provenOptimal')::boolean
       <> (computed_repeat_excess = computed_lower_bound) then
    raise exception using message = 'MEET_SCHEDULE_QUALITY_MISMATCH';
  end if;

  for heat_row in select heat.* from public.heats heat
    where heat.bracket_id = target_bracket_id and heat.status = 'pending'
    order by heat.round_number, heat.heat_number, heat.id
  loop
    insert into public.audit_events
      (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, reason, request_id)
    values (bracket_row.organisation_id, bracket_row.meet_id, target_bracket_id, actor,
      'schedule.heat_retired.' || heat_row.id::text, 'heat', heat_row.id,
      to_jsonb(heat_row), '{}'::jsonb, btrim(replacement_reason), request_id);
  end loop;
  delete from public.heats heat where heat.bracket_id = target_bracket_id and heat.status = 'pending';
  for heat_item in
    select heat from jsonb_array_elements(schedule->'heats') heat
    order by (heat->>'roundNumber')::integer, (heat->>'heatNumber')::integer, (heat->>'id')::uuid
  loop
    insert into public.heats
      (id, organisation_id, bracket_id, round_number, heat_number, phase,
       lane_1_car_id, lane_2_car_id, lane_3_car_id)
    values ((heat_item->>'id')::uuid, bracket_row.organisation_id, target_bracket_id,
      (heat_item->>'roundNumber')::integer, (heat_item->>'heatNumber')::integer,
      heat_item->>'phase', (heat_item->'lanes'->>0)::uuid, (heat_item->'lanes'->>1)::uuid,
      case when jsonb_array_length(heat_item->'lanes') = 3 then (heat_item->'lanes'->>2)::uuid else null end);
    select heat.* into heat_row from public.heats heat where heat.id = (heat_item->>'id')::uuid;
    insert into public.audit_events
      (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
       before_state, after_state, reason, request_id)
    values (bracket_row.organisation_id, bracket_row.meet_id, target_bracket_id, actor,
      'schedule.heat_activated.' || heat_row.id::text, 'heat', heat_row.id,
      '{}'::jsonb, to_jsonb(heat_row), case when pending_count > 0 then btrim(replacement_reason) else null end, request_id);
  end loop;
  update public.brackets set settings = jsonb_set(settings, '{activeSchedule}',
      jsonb_build_object('seed', btrim(schedule->>'seed'), 'quality', schedule->'quality'), true),
    version = version + 1 where id = target_bracket_id;
  update public.meets set version = version + 1 where id = bracket_row.meet_id;
  result := jsonb_build_object('bracket_id', target_bracket_id, 'version', bracket_row.version + 1,
    'heat_count', jsonb_array_length(schedule->'heats'), 'seed', btrim(schedule->>'seed'),
    'quality', schedule->'quality');
  insert into public.audit_events
    (organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id,
     before_state, after_state, reason, request_id)
  values (bracket_row.organisation_id, bracket_row.meet_id, target_bracket_id, actor,
    'schedule.activated', 'bracket_schedule', target_bracket_id,
    jsonb_build_object('pending_heat_count', pending_count, 'version', bracket_row.version),
    result, case when pending_count > 0 then btrim(replacement_reason) else null end, request_id);
  return result;
end;
$$;

create or replace function private_meet.lane_times_from_milliseconds(lane_times_ms jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if lane_times_ms is null then return null; end if;
  if jsonb_typeof(lane_times_ms) <> 'object'
     or exists (select 1 from jsonb_object_keys(lane_times_ms) key where key not in ('lane1', 'lane2', 'lane3'))
     or exists (
       select 1 from jsonb_each(lane_times_ms) item
       where jsonb_typeof(item.value) <> 'number'
         or item.value #>> '{}' !~ '^[0-9]+$'
         or (item.value #>> '{}')::numeric not between 1 and 86400000
     ) then raise exception using message = 'MEET_INVALID_LANE_TIMES'; end if;
  select jsonb_object_agg(item.key,
    to_jsonb(((item.value #>> '{}')::numeric / 1000::numeric)::numeric(12, 3)))
  into result from jsonb_each(lane_times_ms) item;
  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.confirm_heat_winner_ms(
  heat_id uuid, winner_car_id uuid, lane_times_ms jsonb, expected_version integer, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private_meet.write_heat_winner(heat_id, winner_car_id,
    private_meet.lane_times_from_milliseconds(lane_times_ms), expected_version, null, request_id, false);
$$;

create or replace function public.correct_heat_winner_ms(
  heat_id uuid, winner_car_id uuid, lane_times_ms jsonb, expected_version integer, reason text, request_id uuid
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private_meet.write_heat_winner(heat_id, winner_car_id,
    private_meet.lane_times_from_milliseconds(lane_times_ms), expected_version, reason, request_id, true);
$$;

revoke insert, update, delete on table
  public.meets,
  public.brackets,
  public.participants,
  public.cars,
  public.heats,
  public.advancement_rules,
  public.advancement_rule_destinations
from authenticated;
revoke update (name, venue, meet_date, status, settings) on public.meets from authenticated;
revoke update (name, stage, display_order, status, settings) on public.brackets from authenticated;
revoke update (name, email, phone, notes) on public.participants from authenticated;
revoke insert (organisation_id, bracket_id, participant_id, car_number, name) on public.cars from authenticated;
revoke update (participant_id, car_number, name, active) on public.cars from authenticated;
revoke insert (organisation_id, bracket_id, round_number, heat_number, phase, lane_1_car_id, lane_2_car_id, lane_3_car_id)
  on public.heats from authenticated;
revoke update (round_number, heat_number, phase, lane_1_car_id, lane_2_car_id, lane_3_car_id)
  on public.heats from authenticated;
revoke update (top_n, destination_capacity, status) on public.advancement_rules from authenticated;
revoke update (destination_order) on public.advancement_rule_destinations from authenticated;

revoke execute on function public.save_meet_workbook(uuid, uuid, integer, jsonb, uuid) from public, anon;
revoke execute on function public.save_registration_batch(uuid, integer, jsonb, uuid) from public, anon;
revoke execute on function public.activate_bracket_schedule(uuid, integer, jsonb, text, uuid) from public, anon;
revoke execute on function public.confirm_heat_winner_ms(uuid, uuid, jsonb, integer, uuid) from public, anon;
revoke execute on function public.correct_heat_winner_ms(uuid, uuid, jsonb, integer, text, uuid) from public, anon;
revoke execute on function private_meet.lane_times_from_milliseconds(jsonb) from public, anon, authenticated;
grant execute on function public.save_meet_workbook(uuid, uuid, integer, jsonb, uuid) to authenticated;
grant execute on function public.save_registration_batch(uuid, integer, jsonb, uuid) to authenticated;
grant execute on function public.activate_bracket_schedule(uuid, integer, jsonb, text, uuid) to authenticated;
grant execute on function public.confirm_heat_winner_ms(uuid, uuid, jsonb, integer, uuid) to authenticated;
grant execute on function public.correct_heat_winner_ms(uuid, uuid, jsonb, integer, text, uuid) to authenticated;

comment on function public.save_meet_workbook(uuid, uuid, integer, jsonb, uuid) is
  'Creates or version-updates a complete <=15-bracket Meet workbook and validated progression DAG in one audited transaction.';
comment on function public.save_registration_batch(uuid, integer, jsonb, uuid) is
  'Atomically saves bounded participant and car registration rows without exposing advancement lineage columns.';
comment on function public.activate_bracket_schedule(uuid, integer, jsonb, text, uuid) is
  'Validates and activates a deterministic pending schedule; confirmed results are never replaced.';
comment on function private_meet.lane_times_from_milliseconds(jsonb) is
  'Converts bounded integer browser milliseconds exactly to numeric(12,3) seconds for winner RPCs.';
