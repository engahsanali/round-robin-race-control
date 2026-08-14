begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('63000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','canonical-owner@example.test','',now(),now(),now());
insert into public.organisations (id,name,slug,created_by)
values ('63000000-0000-4000-8001-000000000001','Canonical Club','canonical-club','63000000-0000-4000-8000-000000000001');
insert into public.organisation_memberships (organisation_id,user_id,role)
values ('63000000-0000-4000-8001-000000000001','63000000-0000-4000-8000-000000000001','owner');
insert into public.meets (id,organisation_id,name,meet_date,status,created_by)
values ('63000000-0000-4000-8002-000000000001','63000000-0000-4000-8001-000000000001','Canonical Meet','2026-08-14','running','63000000-0000-4000-8000-000000000001');
insert into public.brackets (id,organisation_id,meet_id,name,stage,display_order,status) values
  ('63000000-0000-4000-8003-000000000001','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001','Qualifier','qualifier',1,'completed'),
  ('63000000-0000-4000-8003-000000000002','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001','Final','final',2,'setup');
insert into public.participants (id,organisation_id,bracket_id,name) values
  ('63000000-0000-4000-8004-000000000001','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000001','Source One'),
  ('63000000-0000-4000-8004-000000000002','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000001','Source Two'),
  ('63000000-0000-4000-8004-000000000003','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000002','Final One'),
  ('63000000-0000-4000-8004-000000000004','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000002','Final Two');
insert into public.cars (id,organisation_id,bracket_id,participant_id,car_number,name) values
  ('63000000-0000-4000-8005-000000000001','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000001','63000000-0000-4000-8004-000000000001',1,'Source One'),
  ('63000000-0000-4000-8005-000000000002','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000001','63000000-0000-4000-8004-000000000002',2,'Source Two');
insert into public.advancement_rules (id,organisation_id,meet_id,source_bracket_id,top_n,destination_capacity,status)
values ('63000000-0000-4000-8006-000000000001','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001','63000000-0000-4000-8003-000000000001',2,2,'active');
insert into public.advancement_rule_destinations (organisation_id,meet_id,rule_id,destination_bracket_id,destination_order)
values ('63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001','63000000-0000-4000-8006-000000000001','63000000-0000-4000-8003-000000000002',1);
insert into public.advancement_snapshots (id,organisation_id,meet_id,rule_id,source_bracket_id,source_result_version,stale,confirmed_by,reason,request_id,confirmed_at)
values ('63000000-0000-4000-8007-000000000001','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001','63000000-0000-4000-8006-000000000001','63000000-0000-4000-8003-000000000001',1,false,'63000000-0000-4000-8000-000000000001','Official cutoff','63000000-0000-4000-8008-000000000001','2026-08-14T10:00:00Z');
insert into public.cars (id,organisation_id,bracket_id,participant_id,car_number,name,source_bracket_id,source_car_id,rule_id,snapshot_id) values
  ('63000000-0000-4000-8005-000000000003','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000002','63000000-0000-4000-8004-000000000003',1,'Final One','63000000-0000-4000-8003-000000000001','63000000-0000-4000-8005-000000000001','63000000-0000-4000-8006-000000000001','63000000-0000-4000-8007-000000000001'),
  ('63000000-0000-4000-8005-000000000004','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8003-000000000002','63000000-0000-4000-8004-000000000004',2,'Final Two','63000000-0000-4000-8003-000000000001','63000000-0000-4000-8005-000000000002','63000000-0000-4000-8006-000000000001','63000000-0000-4000-8007-000000000001');
insert into public.advancement_selections (id,organisation_id,meet_id,snapshot_id,rule_id,source_bracket_id,source_car_id,destination_bracket_id,destination_car_id,rank) values
  ('63000000-0000-4000-8009-000000000001','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001','63000000-0000-4000-8007-000000000001','63000000-0000-4000-8006-000000000001','63000000-0000-4000-8003-000000000001','63000000-0000-4000-8005-000000000001','63000000-0000-4000-8003-000000000002','63000000-0000-4000-8005-000000000003',1),
  ('63000000-0000-4000-8009-000000000002','63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001','63000000-0000-4000-8007-000000000001','63000000-0000-4000-8006-000000000001','63000000-0000-4000-8003-000000000001','63000000-0000-4000-8005-000000000002','63000000-0000-4000-8003-000000000002','63000000-0000-4000-8005-000000000004',2);

create temporary table canonical_fixture (name text primary key,payload jsonb not null);
insert into canonical_fixture values ('valid',private_meet.build_hosted_bundle('63000000-0000-4000-8001-000000000001','63000000-0000-4000-8002-000000000001'));
insert into canonical_fixture
select 'duplicate_current',jsonb_set(payload,'{state,advancementSnapshots,0,selections}',jsonb_build_array(payload#>'{state,advancementSnapshots,0,selections,0}',payload#>'{state,advancementSnapshots,0,selections,0}')) from canonical_fixture where name='valid';
insert into canonical_fixture
select 'snapshot_mismatch',jsonb_set(payload,'{state,advancementSnapshots,0,reason}',to_jsonb('Different reason'::text)) from canonical_fixture where name='valid';
insert into canonical_fixture
select 'extra_lineage',jsonb_set(payload,'{state,brackets,1,lineage}',(payload#>'{state,brackets,1,lineage}')||jsonb_build_array(payload#>'{state,brackets,1,lineage,0}')) from canonical_fixture where name='valid';
insert into canonical_fixture
select 'missing_lineage',jsonb_set(payload,'{state,brackets,1,lineage}','[]'::jsonb) from canonical_fixture where name='valid';
insert into canonical_fixture
select 'envelope_duplicate',jsonb_build_object('format','rr3-meet-backup','version',1,'exportedAt','2026-08-14T12:00:00.000Z','product','Round Robin Race Control Meet','creatorCredit','Made by Cesar Lacsamana and Ahsan Ali',
  'source',jsonb_build_object('meetId','63000000-0000-4000-8002-000000000001','meetVersion',1,'applicationVersion','0.1.0'),
  'manifest',jsonb_build_object('meetVersion',1,'bracketCount',2,'participantCount',4,'carCount',4,'heatCount',0,'ruleCount',1,'currentAdvancementSnapshotCount',1,'historicalAdvancementSnapshotCount',0,'advancementSelectionCount',2,'auditEventCount',0,'bundleSha256',private_meet.bundle_sha256(payload)),
  'bundle',payload) from canonical_fixture where name='duplicate_current';

select lives_ok($$select private_meet.validate_hosted_bundle_v12((select payload from canonical_fixture where name='duplicate_current'))$$,'v12 demonstrates duplicate-substitution review gap');
select throws_ok($$select private_meet.validate_hosted_bundle_v13((select payload from canonical_fixture where name='duplicate_current'))$$,'P0001','MEET_BACKUP_GRAPH_INVALID','canonical equality rejects duplicate current selection substitution');
select throws_ok($$select private_meet.validate_hosted_bundle_v13((select payload from canonical_fixture where name='snapshot_mismatch'))$$,'P0001','MEET_BACKUP_GRAPH_INVALID','canonical equality includes all current snapshot fields');
select lives_ok($$select private_meet.validate_hosted_bundle_v12((select payload from canonical_fixture where name='extra_lineage'))$$,'v12 demonstrates lineage-membership review gap');
select throws_ok($$select private_meet.validate_hosted_bundle_v13((select payload from canonical_fixture where name='extra_lineage'))$$,'P0001','MEET_BACKUP_GRAPH_INVALID','lineage bijection rejects duplicate extras');
select throws_ok($$select private_meet.validate_hosted_bundle_v13((select payload from canonical_fixture where name='missing_lineage'))$$,'P0001','MEET_BACKUP_GRAPH_INVALID','lineage bijection rejects missing destination lineage');
select lives_ok($$select private_meet.validate_hosted_bundle_v13((select payload from canonical_fixture where name='valid'))$$,'canonical progression accepts the authoritative graph');

select set_config('request.jwt.claims',json_build_object('sub','63000000-0000-4000-8000-000000000001','role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$
  select public.import_meet_backup('63000000-0000-4000-8001-000000000001',
    (select payload from canonical_fixture where name='envelope_duplicate'),
    'Direct RPC check',true,'63000000-0000-4000-8010-000000000001')
$$,'P0001','MEET_BACKUP_GRAPH_INVALID','public import cannot bypass canonical current/history equality');

reset role;
select * from finish();
rollback;
