-- Strict portable-backup validation and durable recovery request resolution.

create or replace function private_meet.jsonb_exact_keys(value jsonb, expected text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and coalesce((select array_agg(key order by key collate "C") from jsonb_object_keys(value) key), array[]::text[])
      = (select array_agg(item order by item collate "C") from unnest(expected) item);
$$;

create or replace function private_meet.safe_integer(value jsonb, minimum numeric default 0)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when jsonb_typeof(value) = 'number' and value::text ~ '^-?[0-9]+$'
    then value::text::numeric between minimum and 9007199254740991
    else false end;
$$;

create or replace function private_meet.valid_uuid_text(value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select value is not null and value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

create or replace function private_meet.validate_hosted_bundle_v12(bundle jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare state_value jsonb; declare history_value jsonb; declare versions_value jsonb;
declare meet_value jsonb; declare bracket_value jsonb; declare event_value jsonb; declare participant_value jsonb; declare car_value jsonb; declare heat_value jsonb;
declare rule_value jsonb; declare snapshot_value jsonb; declare selection_value jsonb; declare current_value jsonb; declare current_selection_value jsonb; declare lineage_value jsonb; declare audit_value jsonb; declare settings_value jsonb;
declare bracket_ids jsonb := '{}'::jsonb; declare bracket_stages jsonb := '{}'::jsonb; declare bracket_orders jsonb := '{}'::jsonb;
declare participant_ids jsonb := '{}'::jsonb; declare car_brackets jsonb := '{}'::jsonb; declare heat_ids jsonb := '{}'::jsonb;
declare rule_sources jsonb := '{}'::jsonb; declare rule_destinations jsonb := '{}'::jsonb; declare snapshot_rules jsonb := '{}'::jsonb;
declare snapshot_sources jsonb := '{}'::jsonb; declare snapshot_replacements jsonb := '{}'::jsonb; declare selection_ids jsonb := '{}'::jsonb;
declare unique_sources jsonb := '{}'::jsonb; declare unique_ranks jsonb := '{}'::jsonb; declare unique_destination_cars jsonb := '{}'::jsonb;
declare local_participants jsonb; declare local_cars jsonb; declare local_numbers jsonb; declare local_heat_numbers jsonb; declare local_audit_ids jsonb; declare meet_audit_ids jsonb := '{}'::jsonb;
declare object_id text; declare bracket_id text; declare participant_id text; declare source_id text; declare destination_id text; declare replacement_id text;
declare lane_id text; declare winner_id text; declare stage_rank integer; declare destination_rank integer; declare index_value integer;
declare participant_count integer := 0; declare car_count integer := 0; declare heat_count integer := 0;
declare selection_count integer := 0; declare snapshot_count integer := 0; declare current_count integer := 0;
begin
  if not private_meet.jsonb_exact_keys(bundle, array['state','history','heatVersions']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
  state_value := bundle->'state'; history_value := bundle->'history'; versions_value := bundle->'heatVersions';
  if not private_meet.jsonb_exact_keys(state_value,array['version','meet','brackets','advancementRules','advancementSnapshots','auditLog'])
     or not private_meet.safe_integer(state_value->'version',1)
     or not private_meet.jsonb_exact_keys(history_value,array['snapshots','selections'])
     or jsonb_typeof(versions_value) <> 'object'
     or jsonb_typeof(state_value->'brackets') <> 'array'
     or jsonb_array_length(state_value->'brackets') not between 1 and 15
     or jsonb_typeof(state_value->'advancementRules') <> 'array'
     or jsonb_typeof(state_value->'advancementSnapshots') <> 'array'
     or jsonb_typeof(state_value->'auditLog') <> 'array'
     or jsonb_typeof(history_value->'snapshots') <> 'array'
     or jsonb_typeof(history_value->'selections') <> 'array' then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;

  meet_value := state_value->'meet';
  if not private_meet.jsonb_exact_keys(meet_value,array['id','name','venue','date','status','createdAt','updatedAt','version'])
     or not private_meet.valid_uuid_text(meet_value->>'id')
     or jsonb_typeof(meet_value->'name') <> 'string' or char_length(btrim(meet_value->>'name')) not between 1 and 200
     or jsonb_typeof(meet_value->'venue') <> 'string' or jsonb_typeof(meet_value->'date') <> 'string'
     or meet_value->>'status' not in ('setup','running','completed')
     or not private_meet.safe_integer(meet_value->'version',1) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;

  -- STRICT GRAPH IDS AND RELATIONS
  for bracket_value in select value from jsonb_array_elements(state_value->'brackets') loop
    if not private_meet.jsonb_exact_keys(bracket_value,array['id','name','stage','displayOrder','status','version','event','lineage']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    bracket_id := bracket_value->>'id';
    if not private_meet.valid_uuid_text(bracket_id) or bracket_ids ? bracket_id
       or jsonb_typeof(bracket_value->'name') <> 'string' or char_length(btrim(bracket_value->>'name')) not between 1 and 200
       or bracket_value->>'stage' not in ('qualifier','semifinal','final')
       or bracket_value->>'status' not in ('setup','running','completed')
       or not private_meet.safe_integer(bracket_value->'displayOrder',1)
       or not private_meet.safe_integer(bracket_value->'version',1)
       or bracket_orders ? (bracket_value->>'displayOrder') then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    bracket_ids := bracket_ids || jsonb_build_object(bracket_id,true);
    bracket_stages := bracket_stages || jsonb_build_object(bracket_id,bracket_value->>'stage');
    bracket_orders := bracket_orders || jsonb_build_object(bracket_value->>'displayOrder',true);
    event_value := bracket_value->'event'; local_participants := '{}'::jsonb; local_cars := '{}'::jsonb; local_numbers := '{}'::jsonb; local_heat_numbers := '{}'::jsonb; local_audit_ids := '{}'::jsonb;
    if not private_meet.jsonb_exact_keys(event_value,array['version','event','settings','participants','entries','matches','finals','payments','auditLog'])
       or not private_meet.safe_integer(event_value->'version',1)
       or jsonb_typeof(event_value->'participants') <> 'array' or jsonb_typeof(event_value->'entries') <> 'array'
       or jsonb_typeof(event_value->'matches') <> 'array' or jsonb_typeof(event_value->'finals') <> 'array'
       or jsonb_typeof(event_value->'payments') <> 'array' or jsonb_array_length(event_value->'payments') <> 0
       or jsonb_typeof(event_value->'auditLog') <> 'array' or jsonb_typeof(event_value->'settings') <> 'object'
       or not private_meet.jsonb_exact_keys(event_value->'event',array['id','name','date','venue','organizer','laneCount','status','createdAt','updatedAt','resultSeal'])
       or event_value#>>'{event,id}' <> bracket_id or event_value#>>'{event,laneCount}' <> '3'
       or event_value#>>'{event,status}' not in ('setup','running','completed') or event_value#>>'{event,resultSeal}' not in ('draft','provisional','official') then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    settings_value := event_value->'settings';
    if not private_meet.jsonb_exact_keys(settings_value,array['scheduleMode','seed','rankingMode','allowSharedRanks','tieBreakOrder','finalistCount','autoSave','confirmWinnerChanges','enableTiming','prices'])
       or settings_value->>'scheduleMode' not in ('template9','template12','template15','custom')
       or settings_value->>'rankingMode' not in ('competition','dense','ordinal')
       or jsonb_typeof(settings_value->'seed') <> 'string' or jsonb_typeof(settings_value->'allowSharedRanks') <> 'boolean'
       or jsonb_typeof(settings_value->'tieBreakOrder') <> 'array' or jsonb_array_length(settings_value->'tieBreakOrder') > 8
       or not private_meet.safe_integer(settings_value->'finalistCount',0)
       or jsonb_typeof(settings_value->'autoSave') <> 'boolean' or jsonb_typeof(settings_value->'confirmWinnerChanges') <> 'boolean'
       or jsonb_typeof(settings_value->'enableTiming') <> 'boolean' or jsonb_typeof(settings_value->'prices') <> 'object'
       or exists (select 1 from jsonb_array_elements_text(settings_value->'tieBreakOrder') value where value not in ('totalWins','headToHead','matchesWon','averageTime','bestTime','laneBalance','playoff','carNumber'))
       or exists (select 1 from jsonb_each(settings_value->'prices') item where not private_meet.safe_integer(item.value,0)) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    for participant_value in select value from jsonb_array_elements(event_value->'participants') loop
      if not private_meet.jsonb_exact_keys(participant_value,array['id','name','email','phone','notes']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      object_id := participant_value->>'id';
      if not private_meet.valid_uuid_text(object_id) or participant_ids ? object_id or jsonb_typeof(participant_value->'name') <> 'string' or char_length(btrim(participant_value->>'name')) not between 1 and 200
         or jsonb_typeof(participant_value->'email') <> 'string' or char_length(participant_value->>'email') > 320
         or jsonb_typeof(participant_value->'phone') <> 'string' or char_length(participant_value->>'phone') > 64
         or jsonb_typeof(participant_value->'notes') <> 'string' or char_length(participant_value->>'notes') > 2000 then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      participant_ids := participant_ids || jsonb_build_object(object_id,bracket_id); local_participants := local_participants || jsonb_build_object(object_id,true); participant_count := participant_count + 1;
    end loop;
    for car_value in select value from jsonb_array_elements(event_value->'entries') loop
      if not private_meet.jsonb_exact_keys(car_value,array['id','participantId','carNumber','name','categoryId','quantity','active']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      object_id := car_value->>'id'; participant_id := car_value->>'participantId';
      if not private_meet.valid_uuid_text(object_id) or car_brackets ? object_id or not (local_participants ? participant_id)
         or not private_meet.safe_integer(car_value->'carNumber',1) or local_numbers ? (car_value->>'carNumber')
         or jsonb_typeof(car_value->'name') <> 'string' or char_length(btrim(car_value->>'name')) not between 1 and 200
         or jsonb_typeof(car_value->'categoryId') <> 'string' or char_length(btrim(car_value->>'categoryId')) not between 1 and 128
         or not private_meet.safe_integer(car_value->'quantity',1) or jsonb_typeof(car_value->'active') <> 'boolean' then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      car_brackets := car_brackets || jsonb_build_object(object_id,bracket_id); local_cars := local_cars || jsonb_build_object(object_id,true); local_numbers := local_numbers || jsonb_build_object(car_value->>'carNumber',true); car_count := car_count + 1;
    end loop;
    for heat_value in select value from jsonb_array_elements((event_value->'matches') || (event_value->'finals')) loop
      if not private_meet.jsonb_exact_keys(heat_value,array['id','phase','matchNumber','heatNumber','lanes','status','winnerEntryId','laneTimesMs','notes']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      object_id := heat_value->>'id';
      if not private_meet.valid_uuid_text(object_id) or heat_ids ? object_id or heat_value->>'phase' not in ('preliminary','final')
         or not private_meet.safe_integer(heat_value->'matchNumber',1) or not private_meet.safe_integer(heat_value->'heatNumber',1)
         or local_heat_numbers ? ((heat_value->>'phase') || ':' || (heat_value->>'matchNumber') || ':' || (heat_value->>'heatNumber'))
         or jsonb_typeof(heat_value->'lanes') <> 'array' or jsonb_array_length(heat_value->'lanes') <> 3
         or jsonb_typeof(heat_value->'laneTimesMs') <> 'array' or jsonb_array_length(heat_value->'laneTimesMs') <> 3
         or heat_value->>'status' not in ('scheduled','completed','cancelled','rerun')
         or jsonb_typeof(heat_value->'notes') <> 'string' or char_length(heat_value->>'notes') > 2000 then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      if ((event_value->'matches') @> jsonb_build_array(heat_value) and heat_value->>'phase' <> 'preliminary')
         or ((event_value->'finals') @> jsonb_build_array(heat_value) and heat_value->>'phase' <> 'final') then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      for index_value in 0..2 loop
        lane_id := heat_value#>>array['lanes',index_value::text];
        if lane_id is not null and not (local_cars ? lane_id) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
        if lane_id is null and heat_value#>array['laneTimesMs',index_value::text] <> 'null'::jsonb then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
        if heat_value#>array['laneTimesMs',index_value::text] <> 'null'::jsonb and not private_meet.safe_integer(heat_value#>array['laneTimesMs',index_value::text],0) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      end loop;
      if (select count(lane) <> count(distinct lane) from jsonb_array_elements_text(heat_value->'lanes') lane) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      winner_id := heat_value->>'winnerEntryId';
      if (heat_value->>'status'='completed' and (winner_id is null or not (heat_value->'lanes' @> to_jsonb(array[winner_id]))))
         or (heat_value->>'status'<>'completed' and winner_id is not null) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      heat_ids := heat_ids || jsonb_build_object(object_id,bracket_id); local_heat_numbers := local_heat_numbers || jsonb_build_object((heat_value->>'phase') || ':' || (heat_value->>'matchNumber') || ':' || (heat_value->>'heatNumber'),true); heat_count := heat_count + 1;
    end loop;
    for audit_value in select value from jsonb_array_elements(event_value->'auditLog') loop
      if not private_meet.jsonb_exact_keys(audit_value,array['id','timestamp','action','summary','entityType','entityId','details'])
         or not private_meet.valid_uuid_text(audit_value->>'id') or local_audit_ids ? (audit_value->>'id')
         or jsonb_typeof(audit_value->'timestamp') <> 'string' or jsonb_typeof(audit_value->'action') <> 'string'
         or jsonb_typeof(audit_value->'summary') <> 'string' or jsonb_typeof(audit_value->'entityType') <> 'string'
         or (audit_value->>'entityId' is not null and jsonb_typeof(audit_value->'entityId') <> 'string')
         or jsonb_typeof(audit_value->'details') <> 'object' then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
      local_audit_ids := local_audit_ids || jsonb_build_object(audit_value->>'id',true);
    end loop;
    if jsonb_typeof(bracket_value->'lineage') <> 'array' then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
  end loop;

  -- STRICT ADVANCEMENT DAG AND DESTINATIONS
  for rule_value in select value from jsonb_array_elements(state_value->'advancementRules') loop
    if not private_meet.jsonb_exact_keys(rule_value,array['id','version','sourceBracketId','destinationBracketIds','topN','destinationCapacity','destinationOrder','status']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    object_id := rule_value->>'id'; source_id := rule_value->>'sourceBracketId';
    if not private_meet.valid_uuid_text(object_id) or rule_sources ? object_id or not (bracket_ids ? source_id)
       or not private_meet.safe_integer(rule_value->'version',1) or not private_meet.safe_integer(rule_value->'topN',1)
       or not private_meet.safe_integer(rule_value->'destinationCapacity',1) or rule_value->>'status' not in ('active','disabled')
       or jsonb_typeof(rule_value->'destinationBracketIds') <> 'array' or jsonb_array_length(rule_value->'destinationBracketIds') < 1
       or rule_value->'destinationBracketIds' <> rule_value->'destinationOrder'
       or (select count(*) <> count(distinct value) from jsonb_array_elements_text(rule_value->'destinationBracketIds')) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    stage_rank := case bracket_stages->>source_id when 'qualifier' then 1 when 'semifinal' then 2 else 3 end;
    for destination_id in select value from jsonb_array_elements_text(rule_value->'destinationBracketIds') loop
      destination_rank := case bracket_stages->>destination_id when 'qualifier' then 1 when 'semifinal' then 2 when 'final' then 3 else 0 end;
      if destination_rank <= stage_rank then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    end loop;
    rule_sources := rule_sources || jsonb_build_object(object_id,source_id); rule_destinations := rule_destinations || jsonb_build_object(object_id,rule_value->'destinationBracketIds');
  end loop;

  -- STRICT HISTORY REPLACEMENT AND SELECTIONS
  for snapshot_value in select value from jsonb_array_elements(history_value->'snapshots') loop
    if not private_meet.jsonb_exact_keys(snapshot_value,array['id','ruleId','sourceBracketId','sourceResultVersion','stale','replacedBySnapshotId','confirmedBy','reason','confirmedAt']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    object_id := snapshot_value->>'id'; source_id := snapshot_value->>'sourceBracketId';
    if not private_meet.valid_uuid_text(object_id) or snapshot_rules ? object_id or not (rule_sources ? (snapshot_value->>'ruleId'))
       or rule_sources->>(snapshot_value->>'ruleId') <> source_id or not private_meet.safe_integer(snapshot_value->'sourceResultVersion',0)
       or jsonb_typeof(snapshot_value->'stale') <> 'boolean' then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    snapshot_rules := snapshot_rules || jsonb_build_object(object_id,snapshot_value->>'ruleId'); snapshot_sources := snapshot_sources || jsonb_build_object(object_id,source_id);
    snapshot_replacements := snapshot_replacements || jsonb_build_object(object_id,coalesce(snapshot_value->'replacedBySnapshotId','null'::jsonb)); snapshot_count := snapshot_count + 1;
  end loop;
  for snapshot_value in select value from jsonb_array_elements(history_value->'snapshots') loop
    object_id := snapshot_value->>'id'; replacement_id := snapshot_value->>'replacedBySnapshotId';
    if replacement_id is not null and (replacement_id=object_id or not (snapshot_rules ? replacement_id) or snapshot_rules->>replacement_id <> snapshot_rules->>object_id or snapshot_sources->>replacement_id <> snapshot_sources->>object_id) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
  end loop;
  if exists (
    with recursive chain(start_id,current_id,next_id,path,cycle) as (
      select key,key,nullif(snapshot_replacements->>key,'null'),array[key],false from jsonb_object_keys(snapshot_replacements) key
      union all
      select chain.start_id,chain.next_id,nullif(snapshot_replacements->>chain.next_id,'null'),chain.path||chain.next_id,chain.next_id=any(chain.path)
      from chain where chain.next_id is not null and not chain.cycle
    ) select 1 from chain where cycle
  ) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
  for selection_value in select value from jsonb_array_elements(history_value->'selections') loop
    if not private_meet.jsonb_exact_keys(selection_value,array['id','snapshotId','ruleId','sourceBracketId','sourceCarId','destinationBracketId','destinationCarId','rank']) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    object_id := selection_value->>'id'; source_id := selection_value->>'sourceCarId'; destination_id := selection_value->>'destinationBracketId';
    if not private_meet.valid_uuid_text(object_id) or selection_ids ? object_id or not (snapshot_rules ? (selection_value->>'snapshotId'))
       or snapshot_rules->>(selection_value->>'snapshotId') <> selection_value->>'ruleId'
       or snapshot_sources->>(selection_value->>'snapshotId') <> selection_value->>'sourceBracketId'
       or car_brackets->>source_id <> selection_value->>'sourceBracketId'
       or not (rule_destinations->(selection_value->>'ruleId') @> to_jsonb(array[destination_id]))
       or not private_meet.safe_integer(selection_value->'rank',1)
       or (selection_value->>'destinationCarId' is not null and car_brackets->>(selection_value->>'destinationCarId') <> destination_id)
       or unique_sources ? ((selection_value->>'snapshotId')||':'||source_id)
       or unique_ranks ? ((selection_value->>'snapshotId')||':'||(selection_value->>'rank'))
       or (selection_value->>'destinationCarId' is not null and unique_destination_cars ? ((selection_value->>'snapshotId')||':'||(selection_value->>'destinationCarId'))) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    selection_ids := selection_ids || jsonb_build_object(object_id,true); unique_sources := unique_sources || jsonb_build_object((selection_value->>'snapshotId')||':'||source_id,true); unique_ranks := unique_ranks || jsonb_build_object((selection_value->>'snapshotId')||':'||(selection_value->>'rank'),true);
    if selection_value->>'destinationCarId' is not null then unique_destination_cars := unique_destination_cars || jsonb_build_object((selection_value->>'snapshotId')||':'||(selection_value->>'destinationCarId'),true); end if;
    selection_count := selection_count + 1;
  end loop;
  for current_value in select value from jsonb_array_elements(state_value->'advancementSnapshots') loop
    if not private_meet.jsonb_exact_keys(current_value,array['id','ruleId','sourceBracketId','sourceResultVersion','selections','confirmedBy','reason','confirmedAt','stale'])
       or not (snapshot_rules ? (current_value->>'id')) or snapshot_replacements->>(current_value->>'id') <> 'null'
       or snapshot_rules->>(current_value->>'id') <> current_value->>'ruleId' or snapshot_sources->>(current_value->>'id') <> current_value->>'sourceBracketId'
       or not exists (select 1 from jsonb_array_elements(history_value->'snapshots') item where item->>'id'=current_value->>'id' and item->'sourceResultVersion'=current_value->'sourceResultVersion' and item->'stale'=current_value->'stale')
       or jsonb_typeof(current_value->'selections') <> 'array'
       or jsonb_array_length(current_value->'selections') <> (select count(*) from jsonb_array_elements(history_value->'selections') item where item->>'snapshotId'=current_value->>'id')
       or exists (select 1 from jsonb_array_elements(current_value->'selections') item where not exists (select 1 from jsonb_array_elements(history_value->'selections') history_item where history_item->>'snapshotId'=current_value->>'id' and history_item->>'sourceCarId'=item->>'sourceCarId' and history_item->>'destinationBracketId'=item->>'destinationBracketId' and history_item->'rank'=item->'rank')) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    for current_selection_value in select value from jsonb_array_elements(current_value->'selections') loop
      if not private_meet.jsonb_exact_keys(current_selection_value,array['sourceCarId','destinationBracketId','rank'])
         or not private_meet.safe_integer(current_selection_value->'rank',1) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    end loop;
    current_count := current_count + 1;
  end loop;
  if (select count(*) from jsonb_array_elements(history_value->'snapshots') item where item->>'replacedBySnapshotId' is null) <> current_count then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;

  -- EXACT HEAT VERSION SET
  if (select count(*) from jsonb_object_keys(versions_value)) <> heat_count then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
  for object_id in select key from jsonb_object_keys(versions_value) key loop
    if not (heat_ids ? object_id) or not private_meet.safe_integer(versions_value->object_id,1) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
  end loop;

  for bracket_value in select value from jsonb_array_elements(state_value->'brackets') loop
    bracket_id := bracket_value->>'id';
    for lineage_value in select value from jsonb_array_elements(bracket_value->'lineage') loop
      if not private_meet.jsonb_exact_keys(lineage_value,array['sourceBracketId','sourceCarId','ruleId','snapshotId'])
         or car_brackets->>(lineage_value->>'sourceCarId') <> lineage_value->>'sourceBracketId'
         or not (snapshot_rules ? (lineage_value->>'snapshotId')) or snapshot_rules->>(lineage_value->>'snapshotId') <> lineage_value->>'ruleId'
         or not (rule_destinations->(lineage_value->>'ruleId') @> to_jsonb(array[bracket_id])) then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    end loop;
  end loop;
  for audit_value in select value from jsonb_array_elements(state_value->'auditLog') loop
    if not private_meet.jsonb_exact_keys(audit_value,array['id','timestamp','actorId','action','entityType','entityId','reason','before','after'])
       or not private_meet.valid_uuid_text(audit_value->>'id') or meet_audit_ids ? (audit_value->>'id')
       or jsonb_typeof(audit_value->'timestamp') <> 'string' or jsonb_typeof(audit_value->'actorId') <> 'string'
       or jsonb_typeof(audit_value->'action') <> 'string' or jsonb_typeof(audit_value->'entityType') <> 'string'
       or jsonb_typeof(audit_value->'entityId') <> 'string'
       or (audit_value->>'reason' is not null and (jsonb_typeof(audit_value->'reason') <> 'string' or char_length(audit_value->>'reason') > 500))
       or audit_value->'before' is null or audit_value->'after' is null then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;
    meet_audit_ids := meet_audit_ids || jsonb_build_object(audit_value->>'id',true);
  end loop;
end;
$$;

create or replace function private_meet.validate_portable_backup_v12(backup jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare bundle jsonb; declare source_value jsonb; declare manifest_value jsonb;
declare participant_count integer; declare car_count integer; declare heat_count integer; declare current_count integer; declare snapshot_count integer;
begin
  if not private_meet.jsonb_exact_keys(backup,array['format','version','exportedAt','product','creatorCredit','source','manifest','bundle'])
     or backup->>'format' <> 'rr3-meet-backup' or backup->>'version' <> '1'
     or backup->>'product' <> 'Round Robin Race Control Meet'
     or backup->>'creatorCredit' <> 'Made by Cesar Lacsamana and Ahsan Ali'
     or jsonb_typeof(backup->'exportedAt') <> 'string' then raise exception using message='MEET_BACKUP_INVALID'; end if;
  source_value := backup->'source'; manifest_value := backup->'manifest'; bundle := backup->'bundle';
  if not private_meet.jsonb_exact_keys(source_value,array['meetId','meetVersion','applicationVersion'])
     or not private_meet.valid_uuid_text(source_value->>'meetId') or not private_meet.safe_integer(source_value->'meetVersion',1)
     or jsonb_typeof(source_value->'applicationVersion') <> 'string' or char_length(source_value->>'applicationVersion') not between 1 and 100
     or not private_meet.jsonb_exact_keys(manifest_value,array['meetVersion','bracketCount','participantCount','carCount','heatCount','ruleCount','currentAdvancementSnapshotCount','historicalAdvancementSnapshotCount','advancementSelectionCount','auditEventCount','bundleSha256'])
     or manifest_value->>'bundleSha256' !~ '^[0-9a-f]{64}$' then raise exception using message='MEET_BACKUP_INVALID'; end if;
  perform private_meet.validate_hosted_bundle_v12(bundle);
  participant_count := (select count(*) from jsonb_array_elements(bundle#>'{state,brackets}') bracket cross join lateral jsonb_array_elements(bracket#>'{event,participants}'));
  car_count := (select count(*) from jsonb_array_elements(bundle#>'{state,brackets}') bracket cross join lateral jsonb_array_elements(bracket#>'{event,entries}'));
  heat_count := (select count(*) from jsonb_array_elements(bundle#>'{state,brackets}') bracket cross join lateral jsonb_array_elements((bracket#>'{event,matches}')||(bracket#>'{event,finals}')));
  current_count := jsonb_array_length(bundle#>'{state,advancementSnapshots}'); snapshot_count := jsonb_array_length(bundle#>'{history,snapshots}');
  if source_value->>'meetId' <> bundle#>>'{state,meet,id}' or source_value->'meetVersion' <> bundle#>'{state,meet,version}' or manifest_value->'meetVersion' <> bundle#>'{state,meet,version}'
     or not private_meet.safe_integer(manifest_value->'bracketCount',0) or (manifest_value->>'bracketCount')::integer <> jsonb_array_length(bundle#>'{state,brackets}')
     or not private_meet.safe_integer(manifest_value->'participantCount',0) or (manifest_value->>'participantCount')::integer <> participant_count
     or not private_meet.safe_integer(manifest_value->'carCount',0) or (manifest_value->>'carCount')::integer <> car_count
     or not private_meet.safe_integer(manifest_value->'heatCount',0) or (manifest_value->>'heatCount')::integer <> heat_count
     or not private_meet.safe_integer(manifest_value->'ruleCount',0) or (manifest_value->>'ruleCount')::integer <> jsonb_array_length(bundle#>'{state,advancementRules}')
     or not private_meet.safe_integer(manifest_value->'currentAdvancementSnapshotCount',0) or (manifest_value->>'currentAdvancementSnapshotCount')::integer <> current_count
     or not private_meet.safe_integer(manifest_value->'historicalAdvancementSnapshotCount',0) or (manifest_value->>'historicalAdvancementSnapshotCount')::integer <> snapshot_count-current_count
     or not private_meet.safe_integer(manifest_value->'advancementSelectionCount',0) or (manifest_value->>'advancementSelectionCount')::integer <> jsonb_array_length(bundle#>'{history,selections}')
     or not private_meet.safe_integer(manifest_value->'auditEventCount',0) or (manifest_value->>'auditEventCount')::integer <> jsonb_array_length(bundle#>'{state,auditLog}') then raise exception using message='MEET_BACKUP_MANIFEST_MISMATCH'; end if;
  if private_meet.bundle_sha256(bundle) <> manifest_value->>'bundleSha256' then raise exception using message='MEET_BACKUP_HASH_MISMATCH'; end if;
  return bundle;
end;
$$;

-- BACKUP IDEMPOTENCY BEFORE FRESH VALIDATION
create or replace function public.import_meet_backup(target_organisation_id uuid, backup jsonb, reason text, confirm_import boolean, request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare prior public.meet_revisions%rowtype; declare bundle jsonb;
begin
  if not private_meet.has_org_role(target_organisation_id,array['owner','admin','organiser']) then raise exception using message='MEET_FORBIDDEN'; end if;
  select * into prior from public.meet_revisions revision where revision.organisation_id=target_organisation_id and revision.request_id=import_meet_backup.request_id;
  if found then return jsonb_build_object('meet_id',prior.meet_id,'source_revision_id',prior.id,'version',1); end if;
  if request_id is null then raise exception using message='MEET_BACKUP_INVALID'; end if;
  if confirm_import is not true then raise exception using message='MEET_BACKUP_CONFIRM_REQUIRED'; end if;
  if reason is null or char_length(btrim(reason)) not between 1 and 500 then raise exception using message='MEET_REASON_REQUIRED'; end if;
  bundle := private_meet.validate_portable_backup_v12(backup);
  return private_meet.import_bundle_copy(target_organisation_id,bundle,'imported_source','Imported portable backup',btrim(reason),request_id,'meet.imported');
end;
$$;

create or replace function public.restore_meet_revision_copy(target_organisation_id uuid, revision_id uuid, reason text, confirm_restore boolean, request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare prior public.meet_revisions%rowtype; declare revision public.meet_revisions%rowtype;
begin
  if not private_meet.has_org_role(target_organisation_id,array['owner','admin','organiser']) then raise exception using message='MEET_FORBIDDEN'; end if;
  select * into prior from public.meet_revisions item where item.organisation_id=target_organisation_id and item.request_id=restore_meet_revision_copy.request_id;
  if found then return jsonb_build_object('meet_id',prior.meet_id,'source_revision_id',prior.id,'version',1); end if;
  if request_id is null then raise exception using message='MEET_BACKUP_INVALID'; end if;
  if confirm_restore is not true then raise exception using message='MEET_BACKUP_CONFIRM_REQUIRED'; end if;
  if reason is null or char_length(btrim(reason)) not between 1 and 500 then raise exception using message='MEET_REASON_REQUIRED'; end if;
  select * into revision from public.meet_revisions item where item.organisation_id=target_organisation_id and item.id=revision_id for share;
  if not found then raise exception using message='MEET_REVISION_NOT_FOUND'; end if;
  if private_meet.bundle_sha256(revision.payload)<>revision.payload_sha256 then raise exception using message='MEET_BACKUP_HASH_MISMATCH'; end if;
  perform private_meet.validate_hosted_bundle_v12(revision.payload);
  return private_meet.import_bundle_copy(target_organisation_id,revision.payload,'pre_restore','Restored revision copy',btrim(reason),request_id,'meet.restored_copy');
end;
$$;

revoke execute on function private_meet.jsonb_exact_keys(jsonb,text[]), private_meet.safe_integer(jsonb,numeric), private_meet.valid_uuid_text(text), private_meet.validate_hosted_bundle_v12(jsonb), private_meet.validate_portable_backup_v12(jsonb) from public, anon, authenticated;
revoke execute on function public.import_meet_backup(uuid,jsonb,text,boolean,uuid), public.restore_meet_revision_copy(uuid,uuid,text,boolean,uuid) from public, anon;
grant execute on function public.import_meet_backup(uuid,jsonb,text,boolean,uuid) to authenticated;
grant execute on function public.restore_meet_revision_copy(uuid,uuid,text,boolean,uuid) to authenticated;

comment on function private_meet.validate_portable_backup_v12(jsonb) is 'Strict envelope, count, checksum and complete hosted graph validation used before any fresh portable import.';
