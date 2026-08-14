begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'round2-organiser@example.test', '', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'round2-owner@example.test', '', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'round2-admin@example.test', '', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'round2-outsider@example.test', '', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'round2-marshal@example.test', '', now(), now(), now());
insert into public.organisations (id, name, slug, created_by)
values ('61000000-0000-0000-0000-000000000001', 'Round Two Club', 'round-two-club', '60000000-0000-0000-0000-000000000001');
insert into public.organisation_memberships (organisation_id, user_id, role)
values
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'organiser'),
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'owner'),
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'admin'),
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000005', 'marshal');
insert into public.meets (id, organisation_id, name, venue, meet_date, status, created_by)
values ('61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0000-000000000001', 'Round Two Meet', 'Track', '2026-08-14', 'running', '60000000-0000-0000-0000-000000000001');

create temporary table ranking_fixture (
  fixture text primary key,
  source_id uuid not null,
  destination_a uuid not null,
  destination_b uuid not null,
  rule_id uuid not null,
  car_a uuid not null,
  car_b uuid not null,
  car_c uuid not null
);

do $$
declare
  fixture_name text;
  fixture_number integer;
  source_id uuid;
  destination_a uuid;
  destination_b uuid;
  rule_id uuid;
  participant_a uuid;
  participant_b uuid;
  participant_c uuid;
  car_a uuid;
  car_b uuid;
  car_c uuid;
begin
  for fixture_number in 1..3 loop
    fixture_name := case fixture_number when 1 then 'dense' when 2 then 'ordinal_car_number' else 'competition_average_time' end;
    source_id := extensions.gen_random_uuid();
    destination_a := extensions.gen_random_uuid();
    destination_b := extensions.gen_random_uuid();
    rule_id := extensions.gen_random_uuid();
    participant_a := extensions.gen_random_uuid(); participant_b := extensions.gen_random_uuid(); participant_c := extensions.gen_random_uuid();
    car_a := extensions.gen_random_uuid(); car_b := extensions.gen_random_uuid(); car_c := extensions.gen_random_uuid();
    insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status, settings)
    values
      (source_id, '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', fixture_name, 'qualifier', fixture_number * 3 - 2, 'running',
       case fixture_name when 'dense' then '{"rankingMode":"dense","tieBreakOrder":["totalWins"]}'::jsonb
         when 'ordinal_car_number' then '{"rankingMode":"ordinal","tieBreakOrder":["totalWins","carNumber"]}'::jsonb
         else '{"rankingMode":"competition","tieBreakOrder":["totalWins","averageTime"]}'::jsonb end),
      (destination_a, '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', fixture_name || ' A', 'semifinal', fixture_number * 3 - 1, 'setup', '{}'),
      (destination_b, '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', fixture_name || ' B', 'semifinal', fixture_number * 3, 'setup', '{}');
    insert into public.participants (id, organisation_id, bracket_id, name) values
      (participant_a, '61000000-0000-0000-0000-000000000001', source_id, fixture_name || ' A'),
      (participant_b, '61000000-0000-0000-0000-000000000001', source_id, fixture_name || ' B'),
      (participant_c, '61000000-0000-0000-0000-000000000001', source_id, fixture_name || ' C');
    insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name) values
      (car_a, '61000000-0000-0000-0000-000000000001', source_id, participant_a, 10, 'A'),
      (car_b, '61000000-0000-0000-0000-000000000001', source_id, participant_b, 20, 'B'),
      (car_c, '61000000-0000-0000-0000-000000000001', source_id, participant_c, 30, 'C');
    insert into public.heats
      (organisation_id, bracket_id, round_number, heat_number, status, lane_1_car_id, lane_2_car_id, lane_3_car_id,
       winner_car_id, lane_1_time, lane_2_time, lane_3_time, confirmed_by, confirmed_at)
    values
      ('61000000-0000-0000-0000-000000000001', source_id, 1, 1, 'confirmed', car_a, car_b, car_c, car_a, 12, 11, 13, '60000000-0000-0000-0000-000000000001', statement_timestamp()),
      ('61000000-0000-0000-0000-000000000001', source_id, 2, 1, 'confirmed', car_a, car_b, car_c, car_b, 10, 9, 14, '60000000-0000-0000-0000-000000000001', statement_timestamp());
    insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
    values (rule_id, '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', source_id, 3, 10);
    insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order) values
      ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', rule_id, destination_a, 1),
      ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', rule_id, destination_b, 2);
    insert into ranking_fixture values (fixture_name, source_id, destination_a, destination_b, rule_id, car_a, car_b, car_c);
  end loop;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.confirm_advancement(
    (select rule_id from ranking_fixture where fixture = 'dense'), 1, 1,
    (select jsonb_build_array(
      jsonb_build_object('sourceCarId', car_a, 'destinationBracketId', case when car_a < car_b then destination_a else destination_b end, 'rank', 1),
      jsonb_build_object('sourceCarId', car_b, 'destinationBracketId', case when car_b < car_a then destination_a else destination_b end, 'rank', 1),
      jsonb_build_object('sourceCarId', car_c, 'destinationBracketId', destination_a, 'rank', 2)) from ranking_fixture where fixture = 'dense'),
    null, '61000000-0000-0000-0008-000000000001')$$,
  'dense ranking accepts domain ranks 1, 1, 2 instead of competition ranks 1, 1, 3'
);

select lives_ok(
  $$select public.confirm_advancement(
    (select rule_id from ranking_fixture where fixture = 'ordinal_car_number'), 1, 1,
    (select jsonb_build_array(
      jsonb_build_object('sourceCarId', car_a, 'destinationBracketId', destination_a, 'rank', 1),
      jsonb_build_object('sourceCarId', car_b, 'destinationBracketId', destination_b, 'rank', 2),
      jsonb_build_object('sourceCarId', car_c, 'destinationBracketId', destination_a, 'rank', 3)) from ranking_fixture where fixture = 'ordinal_car_number'),
    null, '61000000-0000-0000-0008-000000000002')$$,
  'ordinal ranking uses configured car-number tie breaking and accepts domain ranks 1, 2, 3'
);

select lives_ok(
  $$select public.confirm_advancement(
    (select rule_id from ranking_fixture where fixture = 'competition_average_time'), 1, 1,
    (select jsonb_build_array(
      jsonb_build_object('sourceCarId', car_b, 'destinationBracketId', destination_a, 'rank', 1),
      jsonb_build_object('sourceCarId', car_a, 'destinationBracketId', destination_b, 'rank', 2),
      jsonb_build_object('sourceCarId', car_c, 'destinationBracketId', destination_a, 'rank', 3)) from ranking_fixture where fixture = 'competition_average_time'),
    null, '61000000-0000-0000-0008-000000000003')$$,
  'competition ranking follows configured total-wins then average-time policy'
);

reset role;
insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status, settings) values
  ('61000000-0000-0000-0002-000000000101', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', 'Stable source', 'qualifier', 20, 'running', '{"rankingMode":"competition","tieBreakOrder":["totalWins"]}'),
  ('61000000-0000-0000-0002-000000000102', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', 'Stable A', 'semifinal', 21, 'setup', '{}'),
  ('61000000-0000-0000-0002-000000000103', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', 'Stable B', 'semifinal', 22, 'setup', '{}');
insert into public.participants (id, organisation_id, bracket_id, name) values
  ('61000000-0000-0000-0003-000000000101', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101', 'Stable winner'),
  ('61000000-0000-0000-0003-000000000102', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101', 'Stable low ID'),
  ('61000000-0000-0000-0003-000000000103', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101', 'Stable high ID');
insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name) values
  ('61000000-0000-0000-0004-000000000103', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101', '61000000-0000-0000-0003-000000000101', 50, 'Winner'),
  ('61000000-0000-0000-0004-000000000101', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101', '61000000-0000-0000-0003-000000000102', 99, 'Low ID'),
  ('61000000-0000-0000-0004-000000000102', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101', '61000000-0000-0000-0003-000000000103', 1, 'High ID');
insert into public.heats (organisation_id, bracket_id, round_number, heat_number, status, lane_1_car_id, lane_2_car_id, lane_3_car_id, winner_car_id, confirmed_by, confirmed_at)
values ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101', 1, 1, 'confirmed',
  '61000000-0000-0000-0004-000000000103', '61000000-0000-0000-0004-000000000101', '61000000-0000-0000-0004-000000000102',
  '61000000-0000-0000-0004-000000000103', '60000000-0000-0000-0000-000000000001', statement_timestamp());
insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
values ('61000000-0000-0000-0005-000000000101', '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0002-000000000101', 3, 10);
insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order) values
  ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0005-000000000101', '61000000-0000-0000-0002-000000000102', 1),
  ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0001-000000000001', '61000000-0000-0000-0005-000000000101', '61000000-0000-0000-0002-000000000103', 2);
set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.confirm_advancement('61000000-0000-0000-0005-000000000101', 1, 1,
    '[{"sourceCarId":"61000000-0000-0000-0004-000000000103","destinationBracketId":"61000000-0000-0000-0002-000000000102","rank":1},{"sourceCarId":"61000000-0000-0000-0004-000000000101","destinationBracketId":"61000000-0000-0000-0002-000000000103","rank":2},{"sourceCarId":"61000000-0000-0000-0004-000000000102","destinationBracketId":"61000000-0000-0000-0002-000000000102","rank":2}]',
    null, '61000000-0000-0000-0008-000000000004')$$,
  'equal-rank allocation follows stable source ID even when car-number order is opposite'
);

select throws_ok(
  $$insert into public.cars (organisation_id, bracket_id, participant_id, car_number, name, source_bracket_id, source_car_id, rule_id, snapshot_id)
    values ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101',
      '61000000-0000-0000-0003-000000000101', 77, 'Forged lineage', '61000000-0000-0000-0002-000000000101',
      '61000000-0000-0000-0004-000000000103', '61000000-0000-0000-0005-000000000101', extensions.gen_random_uuid())$$,
  '42501', null, 'organiser cannot fabricate lineage-bearing cars outside advancement RPC'
);
select lives_ok(
  $$insert into public.cars (organisation_id, bracket_id, participant_id, car_number, name)
    values ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0002-000000000101',
      '61000000-0000-0000-0003-000000000101', 77, 'Normal registration')$$,
  'organiser retains safe direct registration insert columns'
);
select is((select count(*) from public.cars where name = 'Normal registration' and source_car_id is null and snapshot_id is null), 1::bigint,
  'normal direct registration cannot populate advancement lineage defaults');

set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.create_invitation('61000000-0000-0000-0000-000000000001', 'owner', now() + interval '1 day',
    '61000000-0000-0000-0008-000000000010')$$,
  'MEET_FORBIDDEN', 'an admin cannot escalate privileges by issuing an owner invitation'
);
set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000002';
create temporary table owner_invitation as
select public.create_invitation('61000000-0000-0000-0000-000000000001', 'owner', now() + interval '1 day',
  '61000000-0000-0000-0008-000000000011') as payload;
select ok(length(payload->>'code') >= 32, 'an owner can issue an owner invitation') from owner_invitation;

set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.revoke_invitation((select (payload->>'invitation_id')::uuid from owner_invitation),
    '61000000-0000-0000-0008-000000000012')$$,
  'MEET_INVITATION_NOT_FOUND', 'an organiser cannot revoke an invitation or learn it exists'
);
set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000004';
select throws_ok(
  $$select public.revoke_invitation((select (payload->>'invitation_id')::uuid from owner_invitation),
    '61000000-0000-0000-0008-000000000013')$$,
  'MEET_INVITATION_NOT_FOUND', 'a cross-organisation caller cannot revoke an invitation or learn it exists'
);
set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000003';
select lives_ok(
  $$select public.revoke_invitation((select (payload->>'invitation_id')::uuid from owner_invitation),
    '61000000-0000-0000-0008-000000000014')$$,
  'an organisation admin can revoke an unused invitation atomically'
);
select lives_ok(
  $$select public.revoke_invitation((select (payload->>'invitation_id')::uuid from owner_invitation),
    '61000000-0000-0000-0008-000000000014')$$,
  'repeating an invitation revocation request is idempotent'
);
select is((select count(*) from public.audit_events where action = 'invitation.revoked' and request_id = '61000000-0000-0000-0008-000000000014'),
  1::bigint, 'invitation revocation writes one same-request actor audit');

set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000002';
select is((select count(*) from public.list_organisation_members('61000000-0000-0000-0000-000000000001')), 4::bigint,
  'owner can list active membership identities and roles for the same organisation');
select is((select count(*) from public.list_organisation_members('61000000-0000-0000-0000-000000000001') where email is not null), 4::bigint,
  'owner receives member email addresses through the bounded RPC');
set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000005';
select is((select count(*) from public.list_organisation_members('61000000-0000-0000-0000-000000000001') where display_name <> '' and email is null), 4::bigint,
  'marshal receives safe display identities but no member email addresses');
set local request.jwt.claim.sub = '60000000-0000-0000-0000-000000000004';
select throws_ok(
  $$select * from public.list_organisation_members('61000000-0000-0000-0000-000000000001')$$,
  'MEET_FORBIDDEN', 'outsider cannot enumerate organisation membership identities'
);
reset role;
select is((select count(*) from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename = any(array['organisations','organisation_memberships','organisation_invitations'])), 3::bigint,
  'organisation access and invitation changes are published through their existing RLS policies');

select * from finish();
rollback;
