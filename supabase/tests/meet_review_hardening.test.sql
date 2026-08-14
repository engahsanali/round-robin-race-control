begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-owner@example.test', '', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-organiser@example.test', '', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-viewer@example.test', '', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-admin@example.test', '', now(), now(), now());

insert into public.organisations (id, name, slug, created_by)
values ('41000000-0000-0000-0000-000000000001', 'Hardening Club', 'hardening-club', '40000000-0000-0000-0000-000000000001');
insert into public.organisation_memberships (organisation_id, user_id, role)
values
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'owner'),
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'organiser'),
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', 'viewer'),
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 'admin');
insert into public.meets (id, organisation_id, name, venue, meet_date, status, created_by)
values
  ('41000000-0000-0000-0001-000000000001', '41000000-0000-0000-0000-000000000001', 'Meet A', 'Track', '2026-08-14', 'running', '40000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0001-000000000002', '41000000-0000-0000-0000-000000000001', 'Meet B', 'Track', '2026-08-15', 'running', '40000000-0000-0000-0000-000000000001');
insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status)
values
  ('41000000-0000-0000-0002-000000000001', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', 'Source A', 'qualifier', 1, 'running'),
  ('41000000-0000-0000-0002-000000000002', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', 'Final A', 'final', 2, 'setup'),
  ('41000000-0000-0000-0002-000000000003', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000002', 'Final B', 'final', 1, 'setup');

select throws_ok(
  $$insert into public.advancement_rules (organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
    values ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000002',
      '41000000-0000-0000-0002-000000000001', 1, 3)$$,
  '23503', null, 'a rule source bracket must belong to the same meet'
);

insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
values
  ('41000000-0000-0000-0003-000000000001', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', '41000000-0000-0000-0002-000000000001', 1, 3),
  ('41000000-0000-0000-0003-000000000002', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', '41000000-0000-0000-0002-000000000001', 1, 3);

select throws_ok(
  $$insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
    values ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001',
      '41000000-0000-0000-0003-000000000001', '41000000-0000-0000-0002-000000000003', 1)$$,
  '23503', null, 'a destination bracket must belong to the same meet as the rule'
);
insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
values
  ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', '41000000-0000-0000-0003-000000000001', '41000000-0000-0000-0002-000000000002', 1),
  ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', '41000000-0000-0000-0003-000000000002', '41000000-0000-0000-0002-000000000002', 1);

insert into public.participants (id, organisation_id, bracket_id, name)
values
  ('41000000-0000-0000-0004-000000000001', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000001', 'Source Driver'),
  ('41000000-0000-0000-0004-000000000002', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000002', 'Advanced Driver One'),
  ('41000000-0000-0000-0004-000000000003', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000002', 'Advanced Driver Two');
insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
values ('41000000-0000-0000-0005-000000000001', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000001', '41000000-0000-0000-0004-000000000001', 1, 'Source Car');
insert into public.advancement_snapshots
  (id, organisation_id, meet_id, rule_id, source_bracket_id, source_result_version, confirmed_by, reason, request_id)
values
  ('41000000-0000-0000-0006-000000000001', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', '41000000-0000-0000-0003-000000000001', '41000000-0000-0000-0002-000000000001', 1, '40000000-0000-0000-0000-000000000002', 'Manual', '41000000-0000-0000-0007-000000000001'),
  ('41000000-0000-0000-0006-000000000002', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0001-000000000001', '41000000-0000-0000-0003-000000000002', '41000000-0000-0000-0002-000000000001', 1, '40000000-0000-0000-0000-000000000002', 'Manual', '41000000-0000-0000-0007-000000000002');

select lives_ok(
  $$insert into public.cars
      (id, organisation_id, bracket_id, participant_id, car_number, name, source_bracket_id, source_car_id, rule_id, snapshot_id)
    values ('41000000-0000-0000-0005-000000000002', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000002',
      '41000000-0000-0000-0004-000000000002', 2, 'Advanced One', '41000000-0000-0000-0002-000000000001',
      '41000000-0000-0000-0005-000000000001', '41000000-0000-0000-0003-000000000001', '41000000-0000-0000-0006-000000000001')$$,
  'first active advancement lineage is accepted'
);
select throws_ok(
  $$insert into public.cars
      (id, organisation_id, bracket_id, participant_id, car_number, name, source_bracket_id, source_car_id, rule_id, snapshot_id)
    values ('41000000-0000-0000-0005-000000000003', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000002',
      '41000000-0000-0000-0004-000000000003', 3, 'Advanced Two', '41000000-0000-0000-0002-000000000001',
      '41000000-0000-0000-0005-000000000001', '41000000-0000-0000-0003-000000000002', '41000000-0000-0000-0006-000000000002')$$,
  '23505', null, 'one active source car cannot advance through a second rule or snapshot'
);
select lives_ok(
  $$do $inner$
    begin
      update public.cars set active = false where id = '41000000-0000-0000-0005-000000000002';
      insert into public.cars
        (id, organisation_id, bracket_id, participant_id, car_number, name, source_bracket_id, source_car_id, rule_id, snapshot_id)
      values ('41000000-0000-0000-0005-000000000003', '41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000002',
        '41000000-0000-0000-0004-000000000003', 3, 'Advanced Two', '41000000-0000-0000-0002-000000000001',
        '41000000-0000-0000-0005-000000000001', '41000000-0000-0000-0003-000000000002', '41000000-0000-0000-0006-000000000002');
    end $inner$;$$,
  'retired historical lineage remains while one replacement becomes active'
);

select throws_ok(
  $$insert into public.heats
      (organisation_id, bracket_id, round_number, heat_number, lane_1_car_id, lane_2_car_id, lane_3_time)
    values ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0002-000000000001', 1, 1,
      '41000000-0000-0000-0005-000000000001', null, 10.2)$$,
  '23514', null, 'database constraint rejects a time for an unassigned lane'
);

create temporary table source_version_before as
select version from public.brackets where id = '41000000-0000-0000-0002-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '40000000-0000-0000-0000-000000000002';
select lives_ok(
  $$update public.advancement_rules set top_n = 2 where id = '41000000-0000-0000-0003-000000000001'$$,
  'direct rule configuration remains available through audited policy'
);
select is((select version from public.brackets where id = '41000000-0000-0000-0002-000000000001'), (select version + 1 from source_version_before), 'rule mutation increments the source result version');
select is((select count(*) from public.audit_events where action = 'advancement_rule.updated' and actor_id = '40000000-0000-0000-0000-000000000002'), 1::bigint, 'rule mutation writes actor and before/after audit');

select is(
  (select count(*) from pg_catalog.pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename = any (array['meets','brackets','participants','cars','heats','advancement_rules','advancement_rule_destinations','advancement_snapshots','advancement_selections','audit_events','security_events'])),
  11::bigint,
  'all RLS-readable operational tables are in the Supabase Realtime publication'
);

select throws_ok(
  $$select public.record_security_event('41000000-0000-0000-0000-000000000001', 'account.arbitrary', null, '{}', '41000000-0000-0000-0007-000000000010')$$,
  'MEET_SECURITY_EVENT_NOT_ALLOWED',
  'security event RPC rejects event names outside the allow-list'
);
select lives_ok(
  $$select public.record_security_event('41000000-0000-0000-0000-000000000001', 'account.sign_in', null, '{"method":"password"}', '41000000-0000-0000-0007-000000000011')$$,
  'member can record an allow-listed account event with derived actor'
);
select lives_ok(
  $$select public.record_security_event('41000000-0000-0000-0000-000000000001', 'account.sign_in', null, '{"ignored":"retry"}', '41000000-0000-0000-0007-000000000011')$$,
  'security event request retry is idempotent'
);
select is((select count(*) from public.security_events where request_id = '41000000-0000-0000-0007-000000000011'), 1::bigint, 'idempotent security event retry stores one event');
select throws_ok(
  $$insert into public.security_events (organisation_id, actor_id, event_type, request_id)
    values ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'account.sign_in', gen_random_uuid())$$,
  '42501', null, 'authenticated users cannot bypass the security event RPC'
);

set local request.jwt.claim.sub = '40000000-0000-0000-0000-000000000003';
select is((select count(*) from public.security_events where request_id = '41000000-0000-0000-0007-000000000011'), 0::bigint, 'viewer cannot read organisation security events');
set local request.jwt.claim.sub = '40000000-0000-0000-0000-000000000004';
select is((select count(*) from public.security_events where request_id = '41000000-0000-0000-0007-000000000011'), 1::bigint, 'admin can read organisation security events');

select * from finish();
rollback;
