-- Canonical current/history equality and destination-lineage bijection.

create or replace function private_meet.validate_hosted_bundle_v13(bundle jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare current_projection jsonb;
declare history_projection jsonb;
declare actual_lineage jsonb;
declare expected_lineage jsonb;
declare current_selection_count integer;
declare materialized_selection_count integer;
begin
  perform private_meet.validate_hosted_bundle_v12(bundle);

  -- CANONICAL CURRENT HISTORY EQUALITY
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', current_snapshot->>'id',
    'ruleId', current_snapshot->>'ruleId',
    'sourceBracketId', current_snapshot->>'sourceBracketId',
    'sourceResultVersion', current_snapshot->'sourceResultVersion',
    'stale', current_snapshot->'stale',
    'confirmedBy', current_snapshot->>'confirmedBy',
    'reason', current_snapshot->'reason',
    'confirmedAt', current_snapshot->>'confirmedAt',
    'selections', coalesce((select jsonb_agg(jsonb_build_object(
      'sourceCarId', current_selection->>'sourceCarId',
      'destinationBracketId', current_selection->>'destinationBracketId',
      'rank', current_selection->'rank'
    ) order by current_selection->>'sourceCarId' collate "C", current_selection->>'destinationBracketId' collate "C", (current_selection->>'rank')::numeric)
      from jsonb_array_elements(current_snapshot->'selections') current_selection), '[]'::jsonb)
  ) order by current_snapshot->>'id' collate "C"), '[]'::jsonb)
  into current_projection
  from jsonb_array_elements(bundle#>'{state,advancementSnapshots}') current_snapshot;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', historical_snapshot->>'id',
    'ruleId', historical_snapshot->>'ruleId',
    'sourceBracketId', historical_snapshot->>'sourceBracketId',
    'sourceResultVersion', historical_snapshot->'sourceResultVersion',
    'stale', historical_snapshot->'stale',
    'confirmedBy', historical_snapshot->>'confirmedBy',
    'reason', historical_snapshot->'reason',
    'confirmedAt', historical_snapshot->>'confirmedAt',
    'selections', coalesce((select jsonb_agg(jsonb_build_object(
      'sourceCarId', historical_selection->>'sourceCarId',
      'destinationBracketId', historical_selection->>'destinationBracketId',
      'rank', historical_selection->'rank'
    ) order by historical_selection->>'sourceCarId' collate "C", historical_selection->>'destinationBracketId' collate "C", (historical_selection->>'rank')::numeric)
      from jsonb_array_elements(bundle#>'{history,selections}') historical_selection
      where historical_selection->>'snapshotId'=historical_snapshot->>'id'), '[]'::jsonb)
  ) order by historical_snapshot->>'id' collate "C"), '[]'::jsonb)
  into history_projection
  from jsonb_array_elements(bundle#>'{history,snapshots}') historical_snapshot
  where historical_snapshot->>'replacedBySnapshotId' is null;

  if private_meet.canonical_json(current_projection) <> private_meet.canonical_json(history_projection) then
    raise exception using message='MEET_BACKUP_GRAPH_INVALID';
  end if;

  -- LINEAGE BIJECTION
  select count(*) into current_selection_count
  from jsonb_array_elements(bundle#>'{history,snapshots}') historical_snapshot
  join lateral jsonb_array_elements(bundle#>'{history,selections}') historical_selection
    on historical_selection->>'snapshotId'=historical_snapshot->>'id'
  where historical_snapshot->>'replacedBySnapshotId' is null;

  select count(*) into materialized_selection_count
  from jsonb_array_elements(bundle#>'{history,snapshots}') historical_snapshot
  join lateral jsonb_array_elements(bundle#>'{history,selections}') historical_selection
    on historical_selection->>'snapshotId'=historical_snapshot->>'id'
  where historical_snapshot->>'replacedBySnapshotId' is null
    and historical_selection->>'destinationCarId' is not null;
  if current_selection_count <> materialized_selection_count then raise exception using message='MEET_BACKUP_GRAPH_INVALID'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'destinationBracketId', bracket_value->>'id',
    'snapshotId', lineage_value->>'snapshotId',
    'ruleId', lineage_value->>'ruleId',
    'sourceBracketId', lineage_value->>'sourceBracketId',
    'sourceCarId', lineage_value->>'sourceCarId'
  ) order by bracket_value->>'id' collate "C", lineage_value->>'snapshotId' collate "C", lineage_value->>'ruleId' collate "C", lineage_value->>'sourceCarId' collate "C"), '[]'::jsonb)
  into actual_lineage
  from jsonb_array_elements(bundle#>'{state,brackets}') bracket_value
  cross join lateral jsonb_array_elements(bracket_value->'lineage') lineage_value;

  select coalesce(jsonb_agg(jsonb_build_object(
    'destinationBracketId', historical_selection->>'destinationBracketId',
    'snapshotId', historical_selection->>'snapshotId',
    'ruleId', historical_selection->>'ruleId',
    'sourceBracketId', historical_selection->>'sourceBracketId',
    'sourceCarId', historical_selection->>'sourceCarId'
  ) order by historical_selection->>'destinationBracketId' collate "C", historical_selection->>'snapshotId' collate "C", historical_selection->>'ruleId' collate "C", historical_selection->>'sourceCarId' collate "C"), '[]'::jsonb)
  into expected_lineage
  from jsonb_array_elements(bundle#>'{history,snapshots}') historical_snapshot
  join lateral jsonb_array_elements(bundle#>'{history,selections}') historical_selection
    on historical_selection->>'snapshotId'=historical_snapshot->>'id'
  where historical_snapshot->>'replacedBySnapshotId' is null;

  if private_meet.canonical_json(actual_lineage) <> private_meet.canonical_json(expected_lineage) then
    raise exception using message='MEET_BACKUP_GRAPH_INVALID';
  end if;
end;
$$;

create or replace function private_meet.validate_portable_backup_v13(backup jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare bundle jsonb;
begin
  bundle := private_meet.validate_portable_backup_v12(backup);
  perform private_meet.validate_hosted_bundle_v13(bundle);
  return bundle;
end;
$$;

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
  bundle := private_meet.validate_portable_backup_v13(backup);
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
  perform private_meet.validate_hosted_bundle_v13(revision.payload);
  return private_meet.import_bundle_copy(target_organisation_id,revision.payload,'pre_restore','Restored revision copy',btrim(reason),request_id,'meet.restored_copy');
end;
$$;

revoke execute on function private_meet.validate_hosted_bundle_v13(jsonb), private_meet.validate_portable_backup_v13(jsonb) from public, anon, authenticated;
revoke execute on function public.import_meet_backup(uuid,jsonb,text,boolean,uuid), public.restore_meet_revision_copy(uuid,uuid,text,boolean,uuid) from public, anon;
grant execute on function public.import_meet_backup(uuid,jsonb,text,boolean,uuid) to authenticated;
grant execute on function public.restore_meet_revision_copy(uuid,uuid,text,boolean,uuid) to authenticated;
