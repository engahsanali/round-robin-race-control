-- Meet portable backup, immutable recovery checkpoints and create-new restore.

create table public.meet_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  meet_id uuid not null,
  sequence integer not null check (sequence > 0),
  kind text not null check (kind in ('manual', 'pre_restore', 'imported_source')),
  source_meet_version integer not null check (source_meet_version > 0),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 10000000),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  request_id uuid not null,
  foreign key (organisation_id, meet_id) references public.meets(organisation_id, id) on delete restrict,
  unique (organisation_id, meet_id, sequence),
  unique (organisation_id, request_id)
);

create index meet_revisions_meet_sequence_idx on public.meet_revisions (meet_id, sequence desc);
create index meet_revisions_org_created_idx on public.meet_revisions (organisation_id, created_at desc, id desc);

revoke all on table public.meet_revisions from public, anon, authenticated;
grant select on table public.meet_revisions to authenticated;
alter table public.meet_revisions enable row level security;
alter table public.meet_revisions force row level security;
create policy "meet_revisions_member_read" on public.meet_revisions for select to authenticated
  using (private_meet.is_org_member(organisation_id));

create or replace function private_meet.canonical_json(value jsonb)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare result text;
begin
  if value is null then return 'null'; end if;
  if jsonb_typeof(value) = 'object' then
    select '{' || coalesce(string_agg(to_jsonb(item.key)::text || ':' || private_meet.canonical_json(item.value), ',' order by item.key collate "C"), '') || '}'
    into result from jsonb_each(value) item;
    return result;
  elsif jsonb_typeof(value) = 'array' then
    select '[' || coalesce(string_agg(private_meet.canonical_json(item.value), ',' order by item.ordinal), '') || ']'
    into result from jsonb_array_elements(value) with ordinality item(value, ordinal);
    return result;
  end if;
  return value::text;
end;
$$;

create or replace function private_meet.bundle_sha256(value jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(private_meet.canonical_json(value), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function private_meet.event_settings(value jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'scheduleMode', case when value->>'scheduleMode' in ('template9','template12','template15','custom') then value->>'scheduleMode' else 'custom' end,
    'seed', coalesce(value->>'seed', 'meet-hosted'),
    'rankingMode', case when value->>'rankingMode' in ('competition','dense','ordinal') then value->>'rankingMode' else 'competition' end,
    'allowSharedRanks', case when value->>'rankingMode' = 'ordinal' then false else true end,
    'tieBreakOrder', case when jsonb_typeof(value->'tieBreakOrder') = 'array' and jsonb_array_length(value->'tieBreakOrder') > 0 then value->'tieBreakOrder' else '["totalWins"]'::jsonb end,
    'finalistCount', case when coalesce(value->>'finalistCount','') ~ '^[0-9]+$' then (value->>'finalistCount')::integer else 0 end,
    'autoSave', true, 'confirmWinnerChanges', true,
    'enableTiming', coalesce((value->>'enableTiming')::boolean, true),
    'prices', '{}'::jsonb
  );
$$;

create or replace function private_meet.build_hosted_bundle(target_organisation_id uuid, target_meet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_meet public.meets%rowtype;
declare state_value jsonb;
declare history_value jsonb;
declare versions_value jsonb;
begin
  select * into target_meet from public.meets meet
  where meet.organisation_id = target_organisation_id and meet.id = target_meet_id;
  if not found then raise exception using message = 'MEET_NOT_FOUND'; end if;

  select jsonb_build_object(
    'version', 1,
    'meet', jsonb_build_object(
      'id', target_meet.id, 'name', target_meet.name, 'venue', target_meet.venue,
      'date', target_meet.meet_date::text, 'status', target_meet.status,
      'createdAt', target_meet.created_at::text, 'updatedAt', target_meet.updated_at::text, 'version', target_meet.version
    ),
    'brackets', coalesce((select jsonb_agg(jsonb_build_object(
      'id', bracket.id, 'name', bracket.name, 'stage', bracket.stage, 'displayOrder', bracket.display_order,
      'status', bracket.status, 'version', bracket.version,
      'lineage', coalesce((select jsonb_agg(jsonb_build_object(
        'sourceBracketId', car.source_bracket_id, 'sourceCarId', car.source_car_id,
        'ruleId', car.rule_id, 'snapshotId', car.snapshot_id
      ) order by car.car_number, car.id) from public.cars car
        join public.advancement_snapshots snapshot on snapshot.id = car.snapshot_id and snapshot.replaced_by_snapshot_id is null
        where car.organisation_id = target_organisation_id and car.bracket_id = bracket.id and car.snapshot_id is not null), '[]'::jsonb),
      'event', jsonb_build_object(
        'version', 1,
        'event', jsonb_build_object(
          'id', bracket.id, 'name', bracket.name, 'date', target_meet.meet_date::text, 'venue', target_meet.venue,
          'organizer', coalesce(nullif(target_meet.settings->>'organizer',''), 'Meet officials'), 'laneCount', 3,
          'status', bracket.status, 'createdAt', bracket.created_at::text, 'updatedAt', bracket.updated_at::text,
          'resultSeal', case bracket.status when 'completed' then 'official' when 'running' then 'provisional' else 'draft' end
        ),
        'settings', private_meet.event_settings(bracket.settings),
        'participants', coalesce((select jsonb_agg(jsonb_build_object(
          'id', participant.id, 'name', participant.name, 'email', participant.email, 'phone', participant.phone, 'notes', participant.notes
        ) order by participant.name collate "C", participant.id) from public.participants participant
          where participant.organisation_id = target_organisation_id and participant.bracket_id = bracket.id), '[]'::jsonb),
        'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'id', car.id, 'participantId', car.participant_id, 'carNumber', car.car_number, 'name', car.name,
          'categoryId', bracket.id, 'quantity', 1, 'active', car.active
        ) order by car.car_number, car.id) from public.cars car
          where car.organisation_id = target_organisation_id and car.bracket_id = bracket.id), '[]'::jsonb),
        'matches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', heat.id, 'phase', 'preliminary', 'matchNumber', heat.round_number, 'heatNumber', heat.heat_number,
          'lanes', jsonb_build_array(heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id),
          'status', case heat.status when 'confirmed' then 'completed' else 'scheduled' end,
          'winnerEntryId', heat.winner_car_id,
          'laneTimesMs', jsonb_build_array(case when heat.lane_1_time is null then null else round(heat.lane_1_time * 1000)::bigint end, case when heat.lane_2_time is null then null else round(heat.lane_2_time * 1000)::bigint end, case when heat.lane_3_time is null then null else round(heat.lane_3_time * 1000)::bigint end),
          'notes', ''
        ) order by heat.round_number, heat.heat_number, heat.id) from public.heats heat
          where heat.organisation_id = target_organisation_id and heat.bracket_id = bracket.id and heat.phase = 'preliminary'), '[]'::jsonb),
        'finals', coalesce((select jsonb_agg(jsonb_build_object(
          'id', heat.id, 'phase', 'final', 'matchNumber', heat.round_number, 'heatNumber', heat.heat_number,
          'lanes', jsonb_build_array(heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id),
          'status', case heat.status when 'confirmed' then 'completed' else 'scheduled' end,
          'winnerEntryId', heat.winner_car_id,
          'laneTimesMs', jsonb_build_array(case when heat.lane_1_time is null then null else round(heat.lane_1_time * 1000)::bigint end, case when heat.lane_2_time is null then null else round(heat.lane_2_time * 1000)::bigint end, case when heat.lane_3_time is null then null else round(heat.lane_3_time * 1000)::bigint end),
          'notes', ''
        ) order by heat.round_number, heat.heat_number, heat.id) from public.heats heat
          where heat.organisation_id = target_organisation_id and heat.bracket_id = bracket.id and heat.phase = 'final'), '[]'::jsonb),
        'payments', '[]'::jsonb, 'auditLog', '[]'::jsonb
      )
    ) order by bracket.display_order, bracket.id) from public.brackets bracket
      where bracket.organisation_id = target_organisation_id and bracket.meet_id = target_meet_id), '[]'::jsonb),
    'advancementRules', coalesce((select jsonb_agg(jsonb_build_object(
      'id', rule.id, 'version', rule.version, 'sourceBracketId', rule.source_bracket_id,
      'destinationBracketIds', coalesce((select jsonb_agg(destination.destination_bracket_id order by destination.destination_order) from public.advancement_rule_destinations destination where destination.rule_id = rule.id), '[]'::jsonb),
      'topN', rule.top_n, 'destinationCapacity', rule.destination_capacity,
      'destinationOrder', coalesce((select jsonb_agg(destination.destination_bracket_id order by destination.destination_order) from public.advancement_rule_destinations destination where destination.rule_id = rule.id), '[]'::jsonb),
      'status', rule.status
    ) order by rule.id) from public.advancement_rules rule where rule.organisation_id = target_organisation_id and rule.meet_id = target_meet_id), '[]'::jsonb),
    'advancementSnapshots', coalesce((select jsonb_agg(jsonb_build_object(
      'id', snapshot.id, 'ruleId', snapshot.rule_id, 'sourceBracketId', snapshot.source_bracket_id,
      'sourceResultVersion', snapshot.source_result_version,
      'selections', coalesce((select jsonb_agg(jsonb_build_object('sourceCarId', selection.source_car_id, 'destinationBracketId', selection.destination_bracket_id, 'rank', selection.rank) order by selection.rank, selection.id) from public.advancement_selections selection where selection.snapshot_id = snapshot.id), '[]'::jsonb),
      'confirmedBy', snapshot.confirmed_by, 'reason', snapshot.reason, 'confirmedAt', snapshot.confirmed_at::text, 'stale', snapshot.stale
    ) order by snapshot.confirmed_at, snapshot.id) from public.advancement_snapshots snapshot
      where snapshot.organisation_id = target_organisation_id and snapshot.meet_id = target_meet_id and snapshot.replaced_by_snapshot_id is null), '[]'::jsonb),
    'auditLog', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id, 'timestamp', event.occurred_at::text, 'actorId', event.actor_id, 'action', event.action,
      'entityType', event.entity_type, 'entityId', event.entity_id, 'reason', event.reason,
      'before', event.before_state, 'after', event.after_state
    ) order by event.occurred_at, event.id) from public.audit_events event
      where event.organisation_id = target_organisation_id and event.meet_id = target_meet_id), '[]'::jsonb)
  ) into state_value;

  select jsonb_build_object(
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object(
      'id', snapshot.id, 'ruleId', snapshot.rule_id, 'sourceBracketId', snapshot.source_bracket_id,
      'sourceResultVersion', snapshot.source_result_version, 'stale', snapshot.stale,
      'replacedBySnapshotId', snapshot.replaced_by_snapshot_id, 'confirmedBy', snapshot.confirmed_by,
      'reason', snapshot.reason, 'confirmedAt', snapshot.confirmed_at::text
    ) order by snapshot.confirmed_at, snapshot.id) from public.advancement_snapshots snapshot
      where snapshot.organisation_id = target_organisation_id and snapshot.meet_id = target_meet_id), '[]'::jsonb),
    'selections', coalesce((select jsonb_agg(jsonb_build_object(
      'id', selection.id, 'snapshotId', selection.snapshot_id, 'ruleId', selection.rule_id,
      'sourceBracketId', selection.source_bracket_id, 'sourceCarId', selection.source_car_id,
      'destinationBracketId', selection.destination_bracket_id, 'destinationCarId', selection.destination_car_id,
      'rank', selection.rank
    ) order by selection.snapshot_id, selection.rank, selection.id) from public.advancement_selections selection
      where selection.organisation_id = target_organisation_id and selection.meet_id = target_meet_id), '[]'::jsonb)
  ) into history_value;

  select coalesce(jsonb_object_agg(heat.id::text, heat.version order by heat.id), '{}'::jsonb)
  into versions_value from public.heats heat join public.brackets bracket on bracket.id = heat.bracket_id
  where heat.organisation_id = target_organisation_id and bracket.meet_id = target_meet_id;
  return jsonb_build_object('state', state_value, 'history', history_value, 'heatVersions', versions_value);
end;
$$;

create or replace function public.export_meet_bundle(target_organisation_id uuid, target_meet_id uuid, expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare current_version integer;
begin
  if not private_meet.is_org_member(target_organisation_id) then raise exception using message = 'MEET_FORBIDDEN'; end if;
  select meet.version into current_version from public.meets meet
  where meet.organisation_id = target_organisation_id and meet.id = target_meet_id
  for share;
  if not found then raise exception using message = 'MEET_NOT_FOUND'; end if;
  if expected_version is null or current_version <> expected_version then raise exception using message = 'MEET_VERSION_CONFLICT'; end if;
  return private_meet.build_hosted_bundle(target_organisation_id, target_meet_id);
end;
$$;

create or replace function public.create_meet_revision(
  target_organisation_id uuid, target_meet_id uuid, expected_version integer,
  revision_kind text, revision_label text, revision_reason text, request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare prior public.meet_revisions%rowtype;
declare current_version integer;
declare next_sequence integer;
declare bundle jsonb;
declare revision_id uuid;
begin
  if not private_meet.has_org_role(target_organisation_id, array['owner','admin','organiser']) then raise exception using message = 'MEET_FORBIDDEN'; end if;
  select * into prior from public.meet_revisions revision where revision.organisation_id = target_organisation_id and revision.request_id = create_meet_revision.request_id;
  if found then return jsonb_build_object('revision_id', prior.id, 'sequence', prior.sequence, 'meet_id', prior.meet_id); end if;
  if revision_kind <> 'manual' or char_length(btrim(revision_label)) not between 1 and 200 or char_length(btrim(revision_reason)) not between 1 and 500 then raise exception using message = 'MEET_BACKUP_INVALID'; end if;
  select meet.version into current_version from public.meets meet where meet.organisation_id = target_organisation_id and meet.id = target_meet_id for update;
  if not found then raise exception using message = 'MEET_NOT_FOUND'; end if;
  if expected_version is null or current_version <> expected_version then raise exception using message = 'MEET_VERSION_CONFLICT'; end if;
  bundle := private_meet.build_hosted_bundle(target_organisation_id, target_meet_id);
  select coalesce(max(revision.sequence), 0) + 1 into next_sequence from public.meet_revisions revision where revision.meet_id = target_meet_id;
  insert into public.meet_revisions (organisation_id, meet_id, sequence, kind, source_meet_version, label, reason, payload, payload_sha256, created_by, request_id)
  values (target_organisation_id, target_meet_id, next_sequence, revision_kind, current_version, btrim(revision_label), btrim(revision_reason), bundle, private_meet.bundle_sha256(bundle), auth.uid(), request_id)
  returning id into revision_id;
  insert into public.audit_events (organisation_id, meet_id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, request_id)
  values (target_organisation_id, target_meet_id, auth.uid(), 'meet.revision_created', 'meet_revision', revision_id, '{}'::jsonb, jsonb_build_object('revision_id',revision_id,'sequence',next_sequence,'source_meet_version',current_version), btrim(revision_reason), request_id);
  return jsonb_build_object('revision_id', revision_id, 'sequence', next_sequence, 'meet_id', target_meet_id);
end;
$$;

create or replace function public.list_meet_revisions(target_organisation_id uuid, target_meet_id uuid, page_size integer default 50, before_sequence integer default null)
returns table (id uuid, organisation_id uuid, meet_id uuid, sequence integer, kind text, source_meet_version integer, label text, reason text, payload_sha256 text, created_by uuid, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not private_meet.is_org_member(target_organisation_id) then raise exception using message = 'MEET_FORBIDDEN'; end if;
  if page_size is null or page_size not between 1 and 100 or (before_sequence is not null and before_sequence <= 0) then raise exception using message = 'MEET_INVALID_PAGE'; end if;
  return query select revision.id, revision.organisation_id, revision.meet_id, revision.sequence, revision.kind, revision.source_meet_version, revision.label, revision.reason, revision.payload_sha256, revision.created_by, revision.created_at
  from public.meet_revisions revision where revision.organisation_id = target_organisation_id and revision.meet_id = target_meet_id and (before_sequence is null or revision.sequence < before_sequence)
  order by revision.sequence desc limit page_size;
end;
$$;

create or replace function public.preview_meet_revision(target_organisation_id uuid, revision_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare revision public.meet_revisions%rowtype;
begin
  if not private_meet.is_org_member(target_organisation_id) then raise exception using message = 'MEET_FORBIDDEN'; end if;
  select * into revision from public.meet_revisions item where item.organisation_id = target_organisation_id and item.id = revision_id;
  if not found then raise exception using message = 'MEET_REVISION_NOT_FOUND'; end if;
  if private_meet.bundle_sha256(revision.payload) <> revision.payload_sha256 then raise exception using message = 'MEET_BACKUP_HASH_MISMATCH'; end if;
  return jsonb_build_object('revision_id',revision.id,'meet_id',revision.meet_id,'source_meet_version',revision.source_meet_version,
    'manifest',jsonb_build_object('bracketCount',jsonb_array_length(revision.payload#>'{state,brackets}'),'ruleCount',jsonb_array_length(revision.payload#>'{state,advancementRules}'),'auditEventCount',jsonb_array_length(revision.payload#>'{state,auditLog}')));
end;
$$;

create or replace function private_meet.import_bundle_copy(
  target_organisation_id uuid, bundle jsonb, import_kind text, import_label text,
  import_reason text, request_id uuid, audit_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare prior public.meet_revisions%rowtype;
declare new_meet_id uuid := extensions.gen_random_uuid();
declare new_revision_id uuid;
declare source_version integer;
declare bracket_value jsonb; declare participant_value jsonb; declare car_value jsonb; declare heat_value jsonb;
declare rule_value jsonb; declare destination_value jsonb; declare destination_ordinal bigint; declare snapshot_value jsonb; declare selection_value jsonb;
declare bracket_map jsonb := '{}'::jsonb; declare participant_map jsonb := '{}'::jsonb; declare car_map jsonb := '{}'::jsonb;
declare heat_map jsonb := '{}'::jsonb; declare rule_map jsonb := '{}'::jsonb; declare snapshot_map jsonb := '{}'::jsonb;
declare old_id text; declare new_id uuid; declare source_meet jsonb := bundle#>'{state,meet}';
begin
  select * into prior from public.meet_revisions revision where revision.organisation_id = target_organisation_id and revision.request_id = import_bundle_copy.request_id;
  if found then return jsonb_build_object('meet_id', prior.meet_id, 'source_revision_id', prior.id, 'version', 1); end if;
  if jsonb_typeof(bundle) <> 'object' or jsonb_typeof(bundle#>'{state,meet}') <> 'object' or jsonb_typeof(bundle#>'{state,brackets}') <> 'array'
     or jsonb_array_length(bundle#>'{state,brackets}') not between 1 and 100 then raise exception using message = 'MEET_BACKUP_GRAPH_INVALID'; end if;
  source_version := (source_meet->>'version')::integer;
  if source_version <= 0 then raise exception using message = 'MEET_BACKUP_GRAPH_INVALID'; end if;
  insert into public.meets (id, organisation_id, name, venue, meet_date, status, settings, created_by, version)
  values (new_meet_id, target_organisation_id, left(btrim(source_meet->>'name') || ' (Imported)',200), coalesce(source_meet->>'venue',''), (source_meet->>'date')::date,
    case when source_meet->>'status' in ('setup','running','completed') then source_meet->>'status' else 'setup' end, jsonb_build_object('importedSourceMeetId',source_meet->>'id'), auth.uid(), 1);

  for bracket_value in select item.value from jsonb_array_elements(bundle#>'{state,brackets}') item loop
    old_id := bracket_value->>'id'; new_id := extensions.gen_random_uuid(); bracket_map := bracket_map || jsonb_build_object(old_id,new_id);
    insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status, settings, version)
    values (new_id,target_organisation_id,new_meet_id,bracket_value->>'name',bracket_value->>'stage',(bracket_value->>'displayOrder')::integer,bracket_value->>'status',bracket_value#>'{event,settings}',1);
  end loop;
  for bracket_value in select item.value from jsonb_array_elements(bundle#>'{state,brackets}') item loop
    for participant_value in select item.value from jsonb_array_elements(bracket_value#>'{event,participants}') item loop
      old_id := participant_value->>'id'; new_id := extensions.gen_random_uuid(); participant_map := participant_map || jsonb_build_object(old_id,new_id);
      insert into public.participants (id,organisation_id,bracket_id,name,email,phone,notes) values (new_id,target_organisation_id,(bracket_map->>(bracket_value->>'id'))::uuid,participant_value->>'name',coalesce(participant_value->>'email',''),coalesce(participant_value->>'phone',''),coalesce(participant_value->>'notes',''));
    end loop;
    for car_value in select item.value from jsonb_array_elements(bracket_value#>'{event,entries}') item loop
      old_id := car_value->>'id'; new_id := extensions.gen_random_uuid(); car_map := car_map || jsonb_build_object(old_id,new_id);
      insert into public.cars (id,organisation_id,bracket_id,participant_id,car_number,name,active) values (new_id,target_organisation_id,(bracket_map->>(bracket_value->>'id'))::uuid,(participant_map->>(car_value->>'participantId'))::uuid,(car_value->>'carNumber')::integer,car_value->>'name',(car_value->>'active')::boolean);
    end loop;
  end loop;
  for bracket_value in select item.value from jsonb_array_elements(bundle#>'{state,brackets}') item loop
    for heat_value in select item.value from jsonb_array_elements((bracket_value#>'{event,matches}') || (bracket_value#>'{event,finals}')) item loop
      old_id := heat_value->>'id'; new_id := extensions.gen_random_uuid(); heat_map := heat_map || jsonb_build_object(old_id,new_id);
      insert into public.heats (id,organisation_id,bracket_id,round_number,heat_number,phase,status,lane_1_car_id,lane_2_car_id,lane_3_car_id,winner_car_id,lane_1_time,lane_2_time,lane_3_time,version,confirmed_by,confirmed_at)
      values (new_id,target_organisation_id,(bracket_map->>(bracket_value->>'id'))::uuid,(heat_value->>'matchNumber')::integer,(heat_value->>'heatNumber')::integer,heat_value->>'phase',case when heat_value->>'status'='completed' then 'confirmed' else 'pending' end,
        (car_map->>(heat_value#>>'{lanes,0}'))::uuid,nullif(car_map->>(heat_value#>>'{lanes,1}'),'')::uuid,nullif(car_map->>(heat_value#>>'{lanes,2}'),'')::uuid,
        case when heat_value->>'status'='completed' then (car_map->>(heat_value->>'winnerEntryId'))::uuid else null end,
        case when heat_value#>>'{laneTimesMs,0}' is null then null else (heat_value#>>'{laneTimesMs,0}')::numeric/1000 end,
        case when heat_value#>>'{laneTimesMs,1}' is null then null else (heat_value#>>'{laneTimesMs,1}')::numeric/1000 end,
        case when heat_value#>>'{laneTimesMs,2}' is null then null else (heat_value#>>'{laneTimesMs,2}')::numeric/1000 end,1,
        case when heat_value->>'status'='completed' then auth.uid() else null end,case when heat_value->>'status'='completed' then statement_timestamp() else null end);
    end loop;
  end loop;
  for rule_value in select item.value from jsonb_array_elements(bundle#>'{state,advancementRules}') item loop
    old_id := rule_value->>'id'; new_id := extensions.gen_random_uuid(); rule_map := rule_map || jsonb_build_object(old_id,new_id);
    insert into public.advancement_rules (id,organisation_id,meet_id,source_bracket_id,top_n,destination_capacity,status,version) values (new_id,target_organisation_id,new_meet_id,(bracket_map->>(rule_value->>'sourceBracketId'))::uuid,(rule_value->>'topN')::integer,(rule_value->>'destinationCapacity')::integer,rule_value->>'status',1);
    for destination_value, destination_ordinal in select item.value, item.ordinal from jsonb_array_elements(rule_value->'destinationOrder') with ordinality item(value,ordinal) loop
      insert into public.advancement_rule_destinations (organisation_id,meet_id,rule_id,destination_bracket_id,destination_order) values (target_organisation_id,new_meet_id,new_id,(bracket_map->>trim(both '"' from destination_value::text))::uuid,destination_ordinal::integer);
    end loop;
  end loop;
  for snapshot_value in select item.value from jsonb_array_elements(bundle#>'{history,snapshots}') item loop
    old_id := snapshot_value->>'id'; snapshot_map := snapshot_map || jsonb_build_object(old_id,extensions.gen_random_uuid());
  end loop;
  for snapshot_value in select item.value from jsonb_array_elements(bundle#>'{history,snapshots}') item loop
    new_id := (snapshot_map->>(snapshot_value->>'id'))::uuid;
    insert into public.advancement_snapshots (id,organisation_id,meet_id,rule_id,source_bracket_id,source_result_version,stale,replaced_by_snapshot_id,confirmed_by,reason,request_id,confirmed_at)
    values (new_id,target_organisation_id,new_meet_id,(rule_map->>(snapshot_value->>'ruleId'))::uuid,(bracket_map->>(snapshot_value->>'sourceBracketId'))::uuid,(snapshot_value->>'sourceResultVersion')::integer,(snapshot_value->>'stale')::boolean,
      case when snapshot_value->>'replacedBySnapshotId' is null then null else (snapshot_map->>(snapshot_value->>'replacedBySnapshotId'))::uuid end,
      auth.uid(),snapshot_value->>'reason',extensions.gen_random_uuid(),statement_timestamp());
  end loop;
  for selection_value in select item.value from jsonb_array_elements(bundle#>'{history,selections}') item loop
    insert into public.advancement_selections (id,organisation_id,meet_id,snapshot_id,rule_id,source_bracket_id,source_car_id,destination_bracket_id,destination_car_id,rank)
    values (extensions.gen_random_uuid(),target_organisation_id,new_meet_id,(snapshot_map->>(selection_value->>'snapshotId'))::uuid,(rule_map->>(selection_value->>'ruleId'))::uuid,(bracket_map->>(selection_value->>'sourceBracketId'))::uuid,(car_map->>(selection_value->>'sourceCarId'))::uuid,(bracket_map->>(selection_value->>'destinationBracketId'))::uuid,nullif(car_map->>(selection_value->>'destinationCarId'),'')::uuid,(selection_value->>'rank')::integer);
    if selection_value->>'destinationCarId' is not null then update public.cars set source_bracket_id=(bracket_map->>(selection_value->>'sourceBracketId'))::uuid,source_car_id=(car_map->>(selection_value->>'sourceCarId'))::uuid,rule_id=(rule_map->>(selection_value->>'ruleId'))::uuid,snapshot_id=(snapshot_map->>(selection_value->>'snapshotId'))::uuid where id=(car_map->>(selection_value->>'destinationCarId'))::uuid; end if;
  end loop;
  insert into public.meet_revisions (organisation_id,meet_id,sequence,kind,source_meet_version,label,reason,payload,payload_sha256,created_by,request_id)
  values (target_organisation_id,new_meet_id,1,import_kind,source_version,import_label,import_reason,bundle,private_meet.bundle_sha256(bundle),auth.uid(),request_id) returning id into new_revision_id;
  insert into public.audit_events (organisation_id,meet_id,actor_id,action,entity_type,entity_id,before_state,after_state,reason,request_id)
  values (target_organisation_id,new_meet_id,auth.uid(),audit_action,'meet',new_meet_id,'{}',jsonb_build_object('source_revision_id',new_revision_id,'source_meet_id',source_meet->>'id','source_meet_version',source_version),import_reason,request_id);
  return jsonb_build_object('meet_id',new_meet_id,'source_revision_id',new_revision_id,'version',1);
end;
$$;

create or replace function public.import_meet_backup(target_organisation_id uuid, backup jsonb, reason text, confirm_import boolean, request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare bundle jsonb; declare expected_hash text; declare allowed boolean;
begin
  if not private_meet.has_org_role(target_organisation_id,array['owner','admin','organiser']) then raise exception using message='MEET_FORBIDDEN'; end if;
  if confirm_import is not true then raise exception using message='MEET_BACKUP_CONFIRM_REQUIRED'; end if;
  if char_length(btrim(reason)) not between 1 and 500 then raise exception using message='MEET_REASON_REQUIRED'; end if;
  if jsonb_typeof(backup)<>'object' or backup->>'format'<>'rr3-meet-backup' or backup->>'version'<>'1' or jsonb_typeof(backup->'bundle')<>'object' then raise exception using message='MEET_BACKUP_INVALID'; end if;
  select bool_and(key=any(array['format','version','exportedAt','product','creatorCredit','source','manifest','bundle'])) into allowed from jsonb_object_keys(backup) key;
  if allowed is not true then raise exception using message='MEET_BACKUP_INVALID'; end if;
  bundle:=backup->'bundle'; expected_hash:=backup#>>'{manifest,bundleSha256}';
  if expected_hash is null or private_meet.bundle_sha256(bundle)<>expected_hash then raise exception using message='MEET_BACKUP_HASH_MISMATCH'; end if; -- backup_hash_mismatch
  if (backup#>>'{manifest,meetVersion}')::integer<>(bundle#>>'{state,meet,version}')::integer
     or (backup#>>'{manifest,bracketCount}')::integer<>jsonb_array_length(bundle#>'{state,brackets}')
     or (backup#>>'{manifest,ruleCount}')::integer<>jsonb_array_length(bundle#>'{state,advancementRules}') then raise exception using message='MEET_BACKUP_MANIFEST_MISMATCH'; end if;
  return private_meet.import_bundle_copy(target_organisation_id,bundle,'imported_source','Imported portable backup',btrim(reason),request_id,'meet.imported');
end;
$$;

-- RESTORE CREATES A NEW MEET
create or replace function public.restore_meet_revision_copy(target_organisation_id uuid, revision_id uuid, reason text, confirm_restore boolean, request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare revision public.meet_revisions%rowtype;
begin
  if not private_meet.has_org_role(target_organisation_id,array['owner','admin','organiser']) then raise exception using message='MEET_FORBIDDEN'; end if;
  if confirm_restore is not true then raise exception using message='MEET_BACKUP_CONFIRM_REQUIRED'; end if;
  if char_length(btrim(reason)) not between 1 and 500 then raise exception using message='MEET_REASON_REQUIRED'; end if;
  select * into revision from public.meet_revisions item where item.organisation_id=target_organisation_id and item.id=revision_id for share;
  if not found then raise exception using message='MEET_REVISION_NOT_FOUND'; end if;
  if private_meet.bundle_sha256(revision.payload)<>revision.payload_sha256 then raise exception using message='MEET_BACKUP_HASH_MISMATCH'; end if;
  return private_meet.import_bundle_copy(target_organisation_id,revision.payload,'pre_restore','Restored revision copy',btrim(reason),request_id,'meet.restored_copy');
end;
$$;

revoke execute on function private_meet.canonical_json(jsonb), private_meet.bundle_sha256(jsonb), private_meet.event_settings(jsonb), private_meet.build_hosted_bundle(uuid,uuid), private_meet.import_bundle_copy(uuid,jsonb,text,text,text,uuid,text) from public, anon, authenticated;
revoke execute on function public.export_meet_bundle(uuid,uuid,integer), public.create_meet_revision(uuid,uuid,integer,text,text,text,uuid), public.list_meet_revisions(uuid,uuid,integer,integer), public.preview_meet_revision(uuid,uuid), public.import_meet_backup(uuid,jsonb,text,boolean,uuid), public.restore_meet_revision_copy(uuid,uuid,text,boolean,uuid) from public, anon;
grant execute on function public.export_meet_bundle(uuid,uuid,integer) to authenticated;
grant execute on function public.create_meet_revision(uuid,uuid,integer,text,text,text,uuid) to authenticated;
grant execute on function public.list_meet_revisions(uuid,uuid,integer,integer) to authenticated;
grant execute on function public.preview_meet_revision(uuid,uuid) to authenticated;
grant execute on function public.import_meet_backup(uuid,jsonb,text,boolean,uuid) to authenticated;
grant execute on function public.restore_meet_revision_copy(uuid,uuid,text,boolean,uuid) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='meet_revisions') then
    alter publication supabase_realtime add table public.meet_revisions;
  end if;
end $$;

comment on table public.meet_revisions is 'Immutable full-graph recovery checkpoints; imported source actors and security events remain provenance only and are never forged into operational history.';
comment on function public.restore_meet_revision_copy(uuid,uuid,text,boolean,uuid) is 'Creates a new meet from an immutable revision; never rolls an existing meet version backward in place.';
