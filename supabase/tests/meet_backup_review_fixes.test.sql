begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('62000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-owner@example.test','',now(),now(),now()),
  ('62000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-outsider@example.test','',now(),now(),now());
insert into public.organisations (id,name,slug,created_by) values
  ('62000000-0000-4000-8001-000000000001','Review Backup Club','review-backup-club','62000000-0000-4000-8000-000000000001'),
  ('62000000-0000-4000-8001-000000000002','Review Other Club','review-other-club','62000000-0000-4000-8000-000000000002');
insert into public.organisation_memberships (organisation_id,user_id,role) values
  ('62000000-0000-4000-8001-000000000001','62000000-0000-4000-8000-000000000001','owner'),
  ('62000000-0000-4000-8001-000000000002','62000000-0000-4000-8000-000000000002','owner');
insert into public.meets (id,organisation_id,name,meet_date,status,created_by) values
  ('62000000-0000-4000-8002-000000000001','62000000-0000-4000-8001-000000000001','Review Source','2026-08-14','setup','62000000-0000-4000-8000-000000000001');
insert into public.brackets (id,organisation_id,meet_id,name,stage,display_order,status) values
  ('62000000-0000-4000-8003-000000000001','62000000-0000-4000-8001-000000000001','62000000-0000-4000-8002-000000000001','Qualifier','qualifier',1,'setup');

create temporary table backup_review_fixture (name text primary key, payload jsonb not null);
with source as (
  select private_meet.build_hosted_bundle('62000000-0000-4000-8001-000000000001','62000000-0000-4000-8002-000000000001') bundle
), envelope as (
  select jsonb_build_object(
    'format','rr3-meet-backup','version',1,'exportedAt','2026-08-14T12:00:00.000Z',
    'product','Round Robin Race Control Meet','creatorCredit','Made by Cesar Lacsamana and Ahsan Ali',
    'source',jsonb_build_object('meetId',bundle#>>'{state,meet,id}','meetVersion',bundle#>'{state,meet,version}','applicationVersion','0.1.0'),
    'manifest',jsonb_build_object('meetVersion',bundle#>'{state,meet,version}','bracketCount',1,'participantCount',0,'carCount',0,'heatCount',0,'ruleCount',0,'currentAdvancementSnapshotCount',0,'historicalAdvancementSnapshotCount',0,'advancementSelectionCount',0,'auditEventCount',0,'bundleSha256',private_meet.bundle_sha256(bundle)),
    'bundle',bundle
  ) payload from source
)
insert into backup_review_fixture select 'valid',payload from envelope;

insert into backup_review_fixture
select 'extra_heat_version',
  jsonb_set(jsonb_set(payload,'{bundle,heatVersions}',jsonb_build_object('62000000-0000-4000-8004-000000000001',1)),
    '{manifest,bundleSha256}',to_jsonb(private_meet.bundle_sha256(jsonb_set(payload#>'{bundle}','{heatVersions}',jsonb_build_object('62000000-0000-4000-8004-000000000001',1)))))
from backup_review_fixture where name='valid';

with expanded as (
  select jsonb_agg(
    jsonb_set(jsonb_set(jsonb_set(source_bracket,'{id}',to_jsonb((lpad(to_hex(number),8,'0')||'-0000-4000-8005-'||lpad(to_hex(number),12,'0')))),
      '{displayOrder}',to_jsonb(number)),
      '{event,event,id}',to_jsonb((lpad(to_hex(number),8,'0')||'-0000-4000-8005-'||lpad(to_hex(number),12,'0')))) order by number
  ) brackets
  from backup_review_fixture fixture
  cross join lateral (select fixture.payload#>'{bundle,state,brackets,0}' source_bracket) source
  cross join generate_series(1,16) number where fixture.name='valid'
), changed as (
  select jsonb_set((select payload from backup_review_fixture where name='valid'),'{bundle,state,brackets}',brackets) payload from expanded
)
insert into backup_review_fixture
select 'sixteen_brackets',jsonb_set(jsonb_set(payload,'{manifest,bracketCount}','16'::jsonb),'{manifest,bundleSha256}',to_jsonb(private_meet.bundle_sha256(payload#>'{bundle}'))) from changed;

select set_config('request.jwt.claims',json_build_object('sub','62000000-0000-4000-8000-000000000001','role','authenticated')::text,true);
set local role authenticated;

select throws_ok($$select public.import_meet_backup('62000000-0000-4000-8001-000000000001',jsonb_set((select payload from backup_review_fixture where name='valid'),'{product}','null'::jsonb),'Reason',true,'62000000-0000-4000-8006-000000000001')$$,'P0001','MEET_BACKUP_INVALID','NULL required product is rejected');
select throws_ok($$select public.import_meet_backup('62000000-0000-4000-8001-000000000001',(select payload from backup_review_fixture where name='valid')#-'{source,applicationVersion}','Reason',true,'62000000-0000-4000-8006-000000000002')$$,'P0001','MEET_BACKUP_INVALID','incomplete source object is rejected');
select throws_ok($$select public.import_meet_backup('62000000-0000-4000-8001-000000000001',(select payload from backup_review_fixture where name='valid')#-'{manifest,participantCount}','Reason',true,'62000000-0000-4000-8006-000000000003')$$,'P0001','MEET_BACKUP_INVALID','incomplete manifest is rejected');
select throws_ok($$select public.import_meet_backup('62000000-0000-4000-8001-000000000001',(select payload from backup_review_fixture where name='sixteen_brackets'),'Reason',true,'62000000-0000-4000-8006-000000000004')$$,'P0001','MEET_BACKUP_GRAPH_INVALID','server enforces the 15 bracket maximum');
select throws_ok($$select public.import_meet_backup('62000000-0000-4000-8001-000000000001',(select payload from backup_review_fixture where name='extra_heat_version'),'Reason',true,'62000000-0000-4000-8006-000000000005')$$,'P0001','MEET_BACKUP_GRAPH_INVALID','heatVersions rejects extras as well as omissions');

select lives_ok($$select public.import_meet_backup('62000000-0000-4000-8001-000000000001',(select payload from backup_review_fixture where name='valid'),'Verified import',true,'62000000-0000-4000-8006-000000000006')$$,'strict valid backup imports');
select is((select count(*)::integer from public.meet_revisions where organisation_id='62000000-0000-4000-8001-000000000001' and request_id='62000000-0000-4000-8006-000000000006'),1,'successful import has one durable receipt');
select is(public.import_meet_backup('62000000-0000-4000-8001-000000000001','{}',null,false,'62000000-0000-4000-8006-000000000006')->>'meet_id',(select meet_id::text from public.meet_revisions where request_id='62000000-0000-4000-8006-000000000006'),'import retry resolves before fresh confirmation, reason and envelope validation');

select lives_ok($$select public.create_meet_revision('62000000-0000-4000-8001-000000000001','62000000-0000-4000-8002-000000000001',1,'manual','Restore source','Verified restore source','62000000-0000-4000-8006-000000000007')$$,'source checkpoint is created');
select lives_ok($$select public.restore_meet_revision_copy('62000000-0000-4000-8001-000000000001',(select id from public.meet_revisions where request_id='62000000-0000-4000-8006-000000000007'),'Verified restore',true,'62000000-0000-4000-8006-000000000008')$$,'strict revision restores as a new meet');
select is(public.restore_meet_revision_copy('62000000-0000-4000-8001-000000000001','00000000-0000-4000-8000-000000000000',null,false,'62000000-0000-4000-8006-000000000008')->>'meet_id',(select meet_id::text from public.meet_revisions where request_id='62000000-0000-4000-8006-000000000008'),'restore retry resolves before fresh confirmation, reason, revision and hash validation');

select set_config('request.jwt.claims',json_build_object('sub','62000000-0000-4000-8000-000000000002','role','authenticated')::text,true);
select throws_ok($$select public.import_meet_backup('62000000-0000-4000-8001-000000000001','{}',null,false,'62000000-0000-4000-8006-000000000006')$$,'P0001','MEET_FORBIDDEN','outsider cannot resolve another organisation request receipt');
select is((select count(*)::integer from public.meets where organisation_id='62000000-0000-4000-8001-000000000001'),3,'failed strict validations leave no partial meets');

reset role;
select * from finish();
rollback;
