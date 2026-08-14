begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('61000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'backup-owner@example.test', '', now(), now(), now()),
  ('61000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'backup-organiser@example.test', '', now(), now(), now()),
  ('61000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'backup-viewer@example.test', '', now(), now(), now()),
  ('61000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'backup-outsider@example.test', '', now(), now(), now());
insert into public.organisations (id, name, slug, created_by) values
  ('61000000-0000-0000-0001-000000000001', 'Backup Club', 'backup-club', '61000000-0000-0000-0000-000000000001'),
  ('61000000-0000-0000-0001-000000000002', 'Other Club', 'backup-other-club', '61000000-0000-0000-0000-000000000004');
insert into public.organisation_memberships (organisation_id, user_id, role) values
  ('61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0000-000000000001', 'owner'),
  ('61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0000-000000000002', 'organiser'),
  ('61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0000-000000000003', 'viewer'),
  ('61000000-0000-0000-0001-000000000002', '61000000-0000-0000-0000-000000000004', 'owner');
insert into public.meets (id, organisation_id, name, meet_date, status, created_by) values
  ('61000000-0000-0000-0002-000000000001', '61000000-0000-0000-0001-000000000001', 'Large Meet', '2026-08-14', 'setup', '61000000-0000-0000-0000-000000000001');
insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status) values
  ('61000000-0000-0000-0003-000000000001', '61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0002-000000000001', 'Qualifier', 'qualifier', 1, 'setup');
insert into public.participants (id, organisation_id, bracket_id, name)
select (lpad(to_hex(value), 8, '0') || '-0000-4000-8000-' || lpad(to_hex(value), 12, '0'))::uuid,
  '61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0003-000000000001', 'Entrant ' || value
from generate_series(1, 1001) value;

select set_config('request.jwt.claims', json_build_object('sub', '61000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(jsonb_array_length(public.export_meet_bundle('61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0002-000000000001', 1)#>'{state,brackets,0,event,participants}'), 1001, 'server export is not subject to a 1000-row API limit');
select throws_ok($$select public.create_meet_revision('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',1,'manual','Viewer try','Not allowed','61000000-0000-0000-0004-000000000001')$$, 'P0001', 'MEET_FORBIDDEN', 'viewer cannot create checkpoints');

select set_config('request.jwt.claims', json_build_object('sub', '61000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select lives_ok($$select public.create_meet_revision('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',1,'manual','Before racing','Verified checkpoint','61000000-0000-0000-0004-000000000002')$$, 'organiser creates a revision');
select is((select count(*)::integer from public.meet_revisions where organisation_id='61000000-0000-0000-0001-000000000001'), 1, 'checkpoint persisted once');
select lives_ok($$select * from public.list_meet_revisions('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',25,null)$$, 'organiser lists revisions');
select throws_ok($$select * from public.list_meet_revisions('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',null,null)$$, 'P0001', 'MEET_INVALID_PAGE', 'NULL page size is rejected');

select set_config('request.jwt.claims', json_build_object('sub', '61000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
select is((select count(*)::integer from public.meet_revisions where organisation_id='61000000-0000-0000-0001-000000000001'), 0, 'outsider cannot read revision rows through RLS');
select throws_ok($$select public.export_meet_bundle('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',1)$$, 'P0001', 'MEET_FORBIDDEN', 'outsider cannot export another organisation');
select throws_ok($$select * from public.list_meet_revisions('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',25,null)$$, 'P0001', 'MEET_FORBIDDEN', 'outsider cannot list another organisation revisions');

select set_config('request.jwt.claims', json_build_object('sub', '61000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select throws_ok($$select public.export_meet_bundle('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',2)$$, 'P0001', 'MEET_VERSION_CONFLICT', 'export rejects stale expected version');
select throws_ok($$select public.import_meet_backup('61000000-0000-0000-0001-000000000001','{}', 'Reason', true, '61000000-0000-0000-0004-000000000003')$$, 'P0001', 'MEET_BACKUP_INVALID', 'malformed backup is rejected');
select throws_ok($$select public.import_meet_backup('61000000-0000-0000-0001-000000000001', jsonb_build_object('format','rr3-meet-backup','version',1,'bundle',public.export_meet_bundle('61000000-0000-0000-0001-000000000001','61000000-0000-0000-0002-000000000001',1),'manifest',jsonb_build_object('bundleSha256',repeat('0',64))), 'Reason', true, '61000000-0000-0000-0004-000000000004')$$, 'P0001', 'MEET_BACKUP_HASH_MISMATCH', 'tampered checksum is rejected');
select throws_ok($$select public.restore_meet_revision_copy('61000000-0000-0000-0001-000000000001',(select id from public.meet_revisions limit 1),'Reason',false,'61000000-0000-0000-0004-000000000005')$$, 'P0001', 'MEET_BACKUP_CONFIRM_REQUIRED', 'restore requires explicit confirmation');
select is((select count(*)::integer from public.meets where organisation_id='61000000-0000-0000-0001-000000000001'), 1, 'failed imports roll back without partial meets');
select ok((select relforcerowsecurity from pg_class where oid='public.meet_revisions'::regclass), 'meet_revisions forces RLS');
select ok((select payload ? 'state' from public.meet_revisions limit 1), 'revision retains the complete hosted bundle as provenance');
select is((select count(*)::integer from public.audit_events where action='meet.revision_created'), 1, 'checkpoint audit is same-transaction accountability');
select is((select count(*)::integer from public.security_events where event_type like 'backup.%'), 0, 'backup does not forge security history');

reset role;
select * from finish();
rollback;
