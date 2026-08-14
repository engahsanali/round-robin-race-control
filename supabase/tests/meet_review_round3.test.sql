begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'round3-organiser@example.test', '', now(), '{}', now(), now()),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'marshal.private@example.test', '', now(), '{"display_name":"Track Marshal"}', now(), now()),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'secret.identity@example.test', '', now(), '{}', now(), now());
insert into public.organisations (id, name, slug, created_by)
values ('71000000-0000-0000-0000-000000000001', 'Round Three Club', 'round-three-club', '70000000-0000-0000-0000-000000000001');
insert into public.organisation_memberships (organisation_id, user_id, role) values
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'organiser'),
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'marshal'),
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003', 'viewer');
insert into public.meets (id, organisation_id, name, venue, meet_date, status, created_by)
values ('71000000-0000-0000-0001-000000000001', '71000000-0000-0000-0000-000000000001', 'Round Three Meet', 'Track', '2026-08-14', 'running', '70000000-0000-0000-0000-000000000001');

insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status, settings) values
  ('71000000-0000-0000-0002-000000000001', '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0001-000000000001',
   'Mixed phase ranking', 'qualifier', 1, 'running', '{"rankingMode":"competition","tieBreakOrder":["totalWins","averageTime"]}'),
  ('71000000-0000-0000-0002-000000000002', '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0001-000000000001',
   'Mixed phase destination', 'semifinal', 2, 'setup', '{}'),
  ('71000000-0000-0000-0002-000000000003', '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0001-000000000001',
   'Incomplete preliminary', 'qualifier', 3, 'running', '{"rankingMode":"competition","tieBreakOrder":["totalWins","averageTime"]}'),
  ('71000000-0000-0000-0002-000000000004', '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0001-000000000001',
   'Incomplete destination', 'semifinal', 4, 'setup', '{}');

do $$
declare
  source_id uuid;
  participant_id uuid;
  car_ids uuid[];
  car_number integer;
begin
  foreach source_id in array array['71000000-0000-0000-0002-000000000001'::uuid, '71000000-0000-0000-0002-000000000003'::uuid]
  loop
    car_ids := array[]::uuid[];
    for car_number in 1..(case when source_id = '71000000-0000-0000-0002-000000000003' then 4 else 3 end) loop
      participant_id := extensions.gen_random_uuid();
      car_ids := array_append(car_ids, extensions.gen_random_uuid());
      insert into public.participants (id, organisation_id, bracket_id, name)
      values (participant_id, '71000000-0000-0000-0000-000000000001', source_id, 'Driver ' || car_number);
      insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
      values (car_ids[car_number], '71000000-0000-0000-0000-000000000001', source_id, participant_id, car_number, 'Car ' || car_number);
    end loop;
    insert into public.heats
      (organisation_id, bracket_id, round_number, heat_number, phase, status, lane_1_car_id, lane_2_car_id, lane_3_car_id,
       winner_car_id, lane_1_time, lane_2_time, lane_3_time, confirmed_by, confirmed_at)
    values ('71000000-0000-0000-0000-000000000001', source_id, 1, 1, 'preliminary', 'confirmed',
      car_ids[1], car_ids[2], car_ids[3], car_ids[1], 10, 11, 12, '70000000-0000-0000-0000-000000000001', statement_timestamp());
    insert into public.heats
      (organisation_id, bracket_id, round_number, heat_number, phase, status, lane_1_car_id, lane_2_car_id, lane_3_car_id,
       winner_car_id, lane_1_time, lane_2_time, lane_3_time, confirmed_by, confirmed_at)
    values ('71000000-0000-0000-0000-000000000001', source_id, 2, 1, 'final', 'confirmed',
      car_ids[1], car_ids[2], case when cardinality(car_ids) = 4 then car_ids[4] else car_ids[3] end,
      car_ids[2], 100, 1, 2, '70000000-0000-0000-0000-000000000001', statement_timestamp());
    insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
    values (case when source_id = '71000000-0000-0000-0002-000000000001' then '71000000-0000-0000-0005-000000000001' else '71000000-0000-0000-0005-000000000002' end,
      '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0001-000000000001', source_id, 3, 10);
  end loop;
end;
$$;
insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order) values
  ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0001-000000000001', '71000000-0000-0000-0005-000000000001', '71000000-0000-0000-0002-000000000002', 1),
  ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0001-000000000001', '71000000-0000-0000-0005-000000000002', '71000000-0000-0000-0002-000000000004', 1);

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.confirm_advancement('71000000-0000-0000-0005-000000000001', 1, 1,
    (select jsonb_agg(jsonb_build_object('sourceCarId', ranked.id, 'destinationBracketId', '71000000-0000-0000-0002-000000000002', 'rank', ranked.rank) order by ranked.rank)
     from (select car.id, row_number() over (order by car.car_number)::integer rank from public.cars car
       where car.bracket_id = '71000000-0000-0000-0002-000000000001') ranked),
    null, '71000000-0000-0000-0008-000000000001')$$,
  'advancement ranking ignores confirmed final-phase wins and times'
);
select throws_ok(
  $$select public.confirm_advancement('71000000-0000-0000-0005-000000000002', 1, 1,
    (select jsonb_agg(jsonb_build_object('sourceCarId', car.id, 'destinationBracketId', '71000000-0000-0000-0002-000000000004', 'rank', car.car_number) order by car.car_number)
     from public.cars car where car.bracket_id = '71000000-0000-0000-0002-000000000003' and car.car_number <= 3),
    null, '71000000-0000-0000-0008-000000000002')$$,
  'MEET_SOURCE_INCOMPLETE', 'a car scheduled only in a final-phase heat leaves the preliminary source incomplete'
);

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';
select is((select display_name from public.list_organisation_members('71000000-0000-0000-0000-000000000001')
  where user_id = '70000000-0000-0000-0000-000000000002'), 'Track Marshal',
  'marshal sees an explicitly supplied bounded display name');
select is((select email from public.list_organisation_members('71000000-0000-0000-0000-000000000001')
  where user_id = '70000000-0000-0000-0000-000000000002'), null,
  'marshal cannot read member email through the directory RPC');
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003';
select is((select display_name from public.list_organisation_members('71000000-0000-0000-0000-000000000001')
  where user_id = '70000000-0000-0000-0000-000000000003'), 'Member 70000000',
  'viewer sees a neutral stable label instead of an email local part');
select is((select email from public.list_organisation_members('71000000-0000-0000-0000-000000000001')
  where user_id = '70000000-0000-0000-0000-000000000003'), null,
  'viewer cannot read member email through the directory RPC');

select * from finish();
rollback;
