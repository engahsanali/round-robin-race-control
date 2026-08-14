begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'advancement-organiser@example.test', '', now(), now(), now());
insert into public.organisations (id, name, slug, created_by)
values ('51000000-0000-0000-0000-000000000001', 'Advancement Review Club', 'advancement-review-club', '50000000-0000-0000-0000-000000000001');
insert into public.organisation_memberships (organisation_id, user_id, role)
values ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'organiser');
insert into public.meets (id, organisation_id, name, venue, meet_date, status, created_by)
values ('51000000-0000-0000-0001-000000000001', '51000000-0000-0000-0000-000000000001', 'Advancement Review Meet', 'Track', '2026-08-14', 'running', '50000000-0000-0000-0000-000000000001');

create temporary table advancement_fixture (
  fixture text primary key,
  rule_id uuid not null,
  source_id uuid not null,
  destination_ids uuid[] not null,
  car_ids uuid[] not null
);

do $$
declare
  destination_id uuid;
  source_id uuid;
  rule_id uuid;
  participant_id uuid;
  car_ids uuid[];
  car_id uuid;
  fixture_name text;
  fixture_index integer;
begin
  for fixture_index in 1..3 loop
    fixture_name := case fixture_index when 1 then 'no_result' when 2 then 'cutoff_tie' else 'non_cutoff_tie' end;
    source_id := extensions.gen_random_uuid();
    destination_id := extensions.gen_random_uuid();
    rule_id := extensions.gen_random_uuid();
    insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status)
    values
      (source_id, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', fixture_name || ' source', 'qualifier', fixture_index * 2 - 1, 'running'),
      (destination_id, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', fixture_name || ' final', 'final', fixture_index * 2, 'setup');
    car_ids := array[]::uuid[];
    for car_number in 1..3 loop
      participant_id := extensions.gen_random_uuid();
      car_id := extensions.gen_random_uuid();
      insert into public.participants (id, organisation_id, bracket_id, name)
      values (participant_id, '51000000-0000-0000-0000-000000000001', source_id, fixture_name || ' driver ' || car_number);
      insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
      values (car_id, '51000000-0000-0000-0000-000000000001', source_id, participant_id, car_number, fixture_name || ' car ' || car_number);
      car_ids := array_append(car_ids, car_id);
    end loop;
    if fixture_name <> 'no_result' then
      insert into public.heats
        (organisation_id, bracket_id, round_number, heat_number, status, lane_1_car_id, lane_2_car_id, lane_3_car_id,
         winner_car_id, confirmed_by, confirmed_at)
      values ('51000000-0000-0000-0000-000000000001', source_id, 1, 1, 'confirmed', car_ids[1], car_ids[2], car_ids[3],
        car_ids[1], '50000000-0000-0000-0000-000000000001', statement_timestamp());
    end if;
    insert into public.advancement_rules
      (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
    values (rule_id, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', source_id,
      case when fixture_name = 'non_cutoff_tie' then 3 else 2 end, 6);
    insert into public.advancement_rule_destinations
      (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
    values ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', rule_id, destination_id, 1);
    insert into advancement_fixture values (fixture_name, rule_id, source_id, array[destination_id], car_ids);
  end loop;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.confirm_advancement(
      (select rule_id from advancement_fixture where fixture = 'no_result'), 1, 1,
      (select jsonb_build_array(
        jsonb_build_object('sourceCarId', car_ids[1], 'destinationBracketId', destination_ids[1], 'rank', 1),
        jsonb_build_object('sourceCarId', car_ids[2], 'destinationBracketId', destination_ids[1], 'rank', 1)) from advancement_fixture where fixture = 'no_result'),
      null, '51000000-0000-0000-0008-000000000001')$$,
  'MEET_SOURCE_INCOMPLETE',
  'a no-result source cannot auto-advance'
);
select lives_ok(
  $$select public.confirm_advancement(
      (select rule_id from advancement_fixture where fixture = 'no_result'), 1, 1,
      (select jsonb_build_array(
        jsonb_build_object('sourceCarId', car_ids[1], 'destinationBracketId', destination_ids[1], 'rank', 1),
        jsonb_build_object('sourceCarId', car_ids[2], 'destinationBracketId', destination_ids[1], 'rank', 1)) from advancement_fixture where fixture = 'no_result'),
      'Manual advancement because no completed result exists', '51000000-0000-0000-0008-000000000002')$$,
  'reasoned manual mode can resolve an incomplete source without claiming automatic ranking'
);
select throws_ok(
  $$select public.confirm_advancement(
      (select rule_id from advancement_fixture where fixture = 'cutoff_tie'), 1, 1,
      (select jsonb_build_array(
        jsonb_build_object('sourceCarId', car_ids[1], 'destinationBracketId', destination_ids[1], 'rank', 1),
        jsonb_build_object('sourceCarId', car_ids[2], 'destinationBracketId', destination_ids[1], 'rank', 2)) from advancement_fixture where fixture = 'cutoff_tie'),
      null, '51000000-0000-0000-0008-000000000003')$$,
  'MEET_REASON_REQUIRED',
  'a tie group crossing the cutoff cannot be resolved by UUID order'
);
select lives_ok(
  $$select public.confirm_advancement(
      (select rule_id from advancement_fixture where fixture = 'cutoff_tie'), 1, 1,
      (select jsonb_build_array(
        jsonb_build_object('sourceCarId', car_ids[1], 'destinationBracketId', destination_ids[1], 'rank', 1),
        jsonb_build_object('sourceCarId', car_ids[2], 'destinationBracketId', destination_ids[1], 'rank', 2)) from advancement_fixture where fixture = 'cutoff_tie'),
      'Manual cutoff tie resolution', '51000000-0000-0000-0008-000000000004')$$,
  'reasoned manual mode selects only automatic rows plus a member of the server cutoff group'
);
select lives_ok(
  $$select public.confirm_advancement(
      (select rule_id from advancement_fixture where fixture = 'non_cutoff_tie'), 1, 1,
      (select jsonb_build_array(
        jsonb_build_object('sourceCarId', car_ids[1], 'destinationBracketId', destination_ids[1], 'rank', 1),
        jsonb_build_object('sourceCarId', car_ids[2], 'destinationBracketId', destination_ids[1], 'rank', 2),
        jsonb_build_object('sourceCarId', car_ids[3], 'destinationBracketId', destination_ids[1], 'rank', 2)) from advancement_fixture where fixture = 'non_cutoff_tie'),
      null, '51000000-0000-0000-0008-000000000005')$$,
  'a complete tie group wholly above the cutoff auto-advances without a UUID tie-break'
);

reset role;
do $$
declare
  semis uuid[] := array[extensions.gen_random_uuid(), extensions.gen_random_uuid()];
  source_id uuid;
  rule_id uuid;
  participant_id uuid;
  car_id uuid;
  car_ids uuid[];
begin
  insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status)
  values
    (semis[1], '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', 'Balanced Semi A', 'semifinal', 20, 'setup'),
    (semis[2], '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', 'Balanced Semi B', 'semifinal', 21, 'setup');
  for qualifier_number in 1..5 loop
    source_id := extensions.gen_random_uuid();
    rule_id := extensions.gen_random_uuid();
    car_ids := array[]::uuid[];
    insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status)
    values (source_id, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001',
      'Balanced Qualifier ' || qualifier_number, 'qualifier', 21 + qualifier_number, 'running');
    for car_number in 1..3 loop
      participant_id := extensions.gen_random_uuid(); car_id := extensions.gen_random_uuid();
      insert into public.participants values (participant_id, '51000000-0000-0000-0000-000000000001', source_id,
        'Balanced Driver ' || qualifier_number || '-' || car_number, '', '', '', statement_timestamp(), statement_timestamp());
      insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
      values (car_id, '51000000-0000-0000-0000-000000000001', source_id, participant_id, car_number, 'Balanced Car');
      car_ids := array_append(car_ids, car_id);
    end loop;
    insert into public.heats
      (organisation_id, bracket_id, round_number, heat_number, status, lane_1_car_id, lane_2_car_id, lane_3_car_id, winner_car_id, confirmed_by, confirmed_at)
    values ('51000000-0000-0000-0000-000000000001', source_id, 1, 1, 'confirmed', car_ids[1], car_ids[2], car_ids[3], car_ids[1],
      '50000000-0000-0000-0000-000000000001', statement_timestamp());
    insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
    values (rule_id, '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', source_id, 3, 20);
    insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
    values
      ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', rule_id, semis[1], 1),
      ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0001-000000000001', rule_id, semis[2], 2);
    insert into advancement_fixture values ('balanced_' || qualifier_number, rule_id, source_id, semis, car_ids);
  end loop;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
select lives_ok(
  $$do $inner$
    declare fixture_row advancement_fixture%rowtype; first_destination uuid; second_destination uuid;
    begin
      for fixture_row in select * from advancement_fixture where fixture like 'balanced_%' and fixture <> 'balanced_5' order by fixture loop
        if fixture_row.fixture in ('balanced_1', 'balanced_3') then first_destination := fixture_row.destination_ids[1]; second_destination := fixture_row.destination_ids[2];
        else first_destination := fixture_row.destination_ids[2]; second_destination := fixture_row.destination_ids[1]; end if;
        perform public.confirm_advancement(fixture_row.rule_id, 1, 1,
          jsonb_build_array(
            jsonb_build_object('sourceCarId', fixture_row.car_ids[1], 'destinationBracketId', first_destination, 'rank', 1),
            jsonb_build_object('sourceCarId', fixture_row.car_ids[2], 'destinationBracketId',
              case when fixture_row.car_ids[2] < fixture_row.car_ids[3] then second_destination else first_destination end, 'rank', 2),
            jsonb_build_object('sourceCarId', fixture_row.car_ids[3], 'destinationBracketId',
              case when fixture_row.car_ids[3] < fixture_row.car_ids[2] then second_destination else first_destination end, 'rank', 2)),
          null, extensions.gen_random_uuid());
      end loop;
    end $inner$;$$,
  'four qualifier transactions accept the deterministic server-balanced allocation'
);
select is((select count(*) from public.cars where bracket_id = (select destination_ids[1] from advancement_fixture where fixture = 'balanced_1') and active), 6::bigint, 'first semifinal receives six active cars');
select is((select count(*) from public.cars where bracket_id = (select destination_ids[2] from advancement_fixture where fixture = 'balanced_1') and active), 6::bigint, 'second semifinal receives six active cars');
select throws_ok(
  $$select public.confirm_advancement(
      (select rule_id from advancement_fixture where fixture = 'balanced_5'), 1, 1,
      (select jsonb_build_array(
        jsonb_build_object('sourceCarId', car_ids[1], 'destinationBracketId', destination_ids[1], 'rank', 1),
        jsonb_build_object('sourceCarId', car_ids[2], 'destinationBracketId', destination_ids[1], 'rank', 2),
        jsonb_build_object('sourceCarId', car_ids[3], 'destinationBracketId', destination_ids[1], 'rank', 2)) from advancement_fixture where fixture = 'balanced_5'),
      null, '51000000-0000-0000-0008-000000000009')$$,
  'MEET_DESTINATION_ALLOCATION',
  'skewed client destination allocation is rejected even when capacity remains'
);

select * from finish();
rollback;
