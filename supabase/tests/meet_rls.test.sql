begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'organiser@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marshal@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-owner@example.test', '', now(), now(), now());

insert into public.organisations (id, name, slug, created_by)
values
  ('11000000-0000-0000-0000-000000000001', 'Alpha Club', 'alpha-club', '10000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0000-000000000001', 'Beta Club', 'beta-club', '20000000-0000-0000-0000-000000000001');

insert into public.organisation_memberships (organisation_id, user_id, role)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'admin'),
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'organiser'),
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'marshal'),
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'viewer'),
  ('22000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'owner');

insert into public.organisation_invitations (id, organisation_id, role, code_digest, expires_at, created_by)
values
  ('11000000-0000-0000-0001-000000000001', '11000000-0000-0000-0000-000000000001', 'viewer', repeat('a', 64), now() + interval '1 day', '10000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0001-000000000001', '22000000-0000-0000-0000-000000000001', 'viewer', repeat('b', 64), now() + interval '1 day', '20000000-0000-0000-0000-000000000001');

insert into public.meets (id, organisation_id, name, venue, meet_date, created_by)
values
  ('11000000-0000-0000-0002-000000000001', '11000000-0000-0000-0000-000000000001', 'Alpha Meet', 'Track A', '2026-08-14', '10000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0002-000000000001', '22000000-0000-0000-0000-000000000001', 'Beta Meet', 'Track B', '2026-08-14', '20000000-0000-0000-0000-000000000001');

insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order)
values
  ('11000000-0000-0000-0003-000000000001', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0002-000000000001', 'Alpha Qualifier', 'qualifier', 1),
  ('22000000-0000-0000-0003-000000000001', '22000000-0000-0000-0000-000000000001', '22000000-0000-0000-0002-000000000001', 'Beta Qualifier', 'qualifier', 1);

insert into public.participants (id, organisation_id, bracket_id, name)
values
  ('11000000-0000-0000-0004-000000000001', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0003-000000000001', 'Alpha Driver'),
  ('22000000-0000-0000-0004-000000000001', '22000000-0000-0000-0000-000000000001', '22000000-0000-0000-0003-000000000001', 'Beta Driver');

insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
values
  ('11000000-0000-0000-0005-000000000001', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0003-000000000001', '11000000-0000-0000-0004-000000000001', 7, 'Alpha Car'),
  ('22000000-0000-0000-0005-000000000001', '22000000-0000-0000-0000-000000000001', '22000000-0000-0000-0003-000000000001', '22000000-0000-0000-0004-000000000001', 7, 'Beta Car');

insert into public.heats (id, organisation_id, bracket_id, round_number, heat_number, lane_1_car_id)
values
  ('11000000-0000-0000-0006-000000000001', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0003-000000000001', 1, 1, '11000000-0000-0000-0005-000000000001'),
  ('22000000-0000-0000-0006-000000000001', '22000000-0000-0000-0000-000000000001', '22000000-0000-0000-0003-000000000001', 1, 1, '22000000-0000-0000-0005-000000000001');

insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id, request_id)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fixture.created', 'organisation', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0007-000000000001'),
  ('22000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'fixture.created', 'organisation', '22000000-0000-0000-0000-000000000001', '22000000-0000-0000-0007-000000000001');

insert into public.security_events (organisation_id, actor_id, event_type, subject_user_id)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fixture.created', '10000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'fixture.created', '20000000-0000-0000-0000-000000000001');

select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = any (array[
       'organisations', 'organisation_memberships', 'organisation_invitations',
       'meets', 'brackets', 'participants', 'cars', 'heats',
       'advancement_rules', 'advancement_rule_destinations', 'advancement_snapshots',
       'advancement_selections', 'audit_events', 'security_events', 'mutation_rate_limits'
     ])),
  'every Meet-owned table enables and forces RLS'
);

set local role anon;
select is((select count(*) from public.organisations), 0::bigint, 'anonymous users see no organisations');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000006';
select is((select count(*) from public.organisations), 0::bigint, 'outsiders see no organisation rows');
select is((select count(*) from public.meets), 0::bigint, 'outsiders see no meet rows');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is((select count(*) from public.organisations), 1::bigint, 'owner reads only their organisation');
select is((select count(*) from public.security_events), 1::bigint, 'owner reads organisation security events');
select is((select count(*) from public.organisation_invitations), 1::bigint, 'owner reads organisation invitations');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select is((select count(*) from public.organisations), 1::bigint, 'admin reads only their organisation');
select is((select count(*) from public.security_events), 1::bigint, 'admin reads organisation security events');
select is((select count(*) from public.organisation_invitations), 1::bigint, 'admin reads organisation invitations');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select is((select count(*) from public.organisations), 1::bigint, 'organiser reads only their organisation');
select is((select count(*) from public.security_events), 0::bigint, 'organiser cannot read security events');
select is((select count(*) from public.organisation_invitations), 0::bigint, 'organiser cannot read invitations');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select is((select count(*) from public.organisations), 1::bigint, 'marshal reads only their organisation');
select is((select count(*) from public.security_events), 0::bigint, 'marshal cannot read security events');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
select is((select count(*) from public.organisations), 1::bigint, 'viewer reads only their organisation');
select is((select count(*) from public.security_events), 0::bigint, 'viewer cannot read security events');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select lives_ok(
  $$insert into public.meets (organisation_id, name, venue, meet_date, created_by)
    values ('11000000-0000-0000-0000-000000000001', 'Organiser Meet', 'Track A', '2026-08-15', '10000000-0000-0000-0000-000000000003')$$,
  'organiser can create a meet in their organisation'
);
select throws_ok(
  $$insert into public.heats
      (organisation_id, bracket_id, round_number, heat_number, lane_1_car_id, status, winner_car_id, lane_1_time, version, confirmed_by, confirmed_at)
    values
      ('11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0003-000000000001', 2, 1,
       '11000000-0000-0000-0005-000000000001', 'confirmed', '11000000-0000-0000-0005-000000000001', 9.1, 99,
       '10000000-0000-0000-0000-000000000003', now())$$,
  '42501', null, 'organiser cannot forge a confirmed heat through direct insert'
);
select lives_ok(
  $$insert into public.heats
      (organisation_id, bracket_id, round_number, heat_number, lane_1_car_id)
    values
      ('11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0003-000000000001', 2, 1,
       '11000000-0000-0000-0005-000000000001')$$,
  'organiser can insert only a safe pending schedule row'
);
select is((select count(*) from public.heats where bracket_id = '11000000-0000-0000-0003-000000000001' and round_number = 2 and status = 'pending' and winner_car_id is null and version = 1), 1::bigint, 'safe direct heat insert preserves protected defaults');
select is((select count(*) from public.audit_events where action = 'heat.schedule_inserted' and actor_id = '10000000-0000-0000-0000-000000000003'), 1::bigint, 'direct schedule insert writes a same-transaction actor audit');
select throws_ok(
  $$update public.heats set status = 'confirmed', winner_car_id = lane_1_car_id, lane_1_time = 9.0, version = 99,
      confirmed_by = '10000000-0000-0000-0000-000000000003', confirmed_at = now()
    where id = '11000000-0000-0000-0006-000000000001'$$,
  '42501', null, 'organiser cannot update protected heat result columns directly'
);

create temporary table bracket_version_before as
select version from public.brackets where id = '11000000-0000-0000-0003-000000000001';
select lives_ok(
  $$insert into public.cars (organisation_id, bracket_id, participant_id, car_number, name)
    values ('11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0003-000000000001',
      '11000000-0000-0000-0004-000000000001', 8, 'Second Alpha Car')$$,
  'organiser registration mutation succeeds through audited direct policy'
);
select is(
  (select version from public.brackets where id = '11000000-0000-0000-0003-000000000001'),
  (select version + 1 from bracket_version_before),
  'registration mutation increments the source bracket version'
);
select is((select count(*) from public.audit_events where action = 'car.inserted' and actor_id = '10000000-0000-0000-0000-000000000003'), 1::bigint, 'registration mutation stores actor and before/after audit');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select throws_ok(
  $$insert into public.meets (organisation_id, name, venue, meet_date, created_by)
    values ('11000000-0000-0000-0000-000000000001', 'Marshal Meet', 'Track A', '2026-08-15', '10000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'marshal cannot create meets'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
select throws_ok(
  $$insert into public.meets (organisation_id, name, venue, meet_date, created_by)
    values ('11000000-0000-0000-0000-000000000001', 'Viewer Meet', 'Track A', '2026-08-15', '10000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'viewer cannot create meets'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$insert into public.organisation_memberships (organisation_id, user_id, role)
    values ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'viewer')$$,
  '42501', null, 'membership writes must use audited RPCs even for owners'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select throws_ok(
  $$update public.heats set winner_car_id = lane_1_car_id where id = '11000000-0000-0000-0006-000000000001'$$,
  '42501', null, 'marshal heat result writes must use transactional RPCs'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id, request_id)
    values ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'forged', 'meet', gen_random_uuid(), gen_random_uuid())$$,
  '42501', null, 'authenticated users cannot forge audit events'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select is(
  (select count(*) from public.audit_events where organisation_id = '22000000-0000-0000-0000-000000000001'),
  0::bigint,
  'cross-organisation audit rows never leak'
);

select * from finish();
rollback;
