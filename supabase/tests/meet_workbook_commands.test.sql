begin;

create extension if not exists pgtap with schema extensions;
select plan(65);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-workbook@example.test', '', now(), now(), now()),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'organiser-one@example.test', '', now(), now(), now()),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'organiser-two@example.test', '', now(), now(), now()),
  ('70000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marshal-workbook@example.test', '', now(), now(), now()),
  ('70000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer-workbook@example.test', '', now(), now(), now()),
  ('70000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider-workbook@example.test', '', now(), now(), now());

insert into public.organisations (id, name, slug, created_by)
values ('71000000-0000-0000-0000-000000000001', 'Workbook Club', 'workbook-club', '70000000-0000-0000-0000-000000000001');
insert into public.organisation_memberships (organisation_id, user_id, role)
values
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'owner'),
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'organiser'),
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003', 'organiser'),
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000004', 'marshal'),
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000005', 'viewer');

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';

create temporary table workbook_result as
select public.save_meet_workbook(
  '71000000-0000-0000-0000-000000000001', null, null,
  '{"meet":{"name":"Championship","venue":"Main Track","meetDate":"2026-08-14","status":"setup","settings":{}},"brackets":[{"id":"72000000-0000-0000-0000-000000000001","name":"Qualifier A","stage":"qualifier","displayOrder":1,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000002","name":"Qualifier B","stage":"qualifier","displayOrder":2,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000003","name":"Final","stage":"final","displayOrder":3,"status":"setup","settings":{}}],"rules":[{"id":"73000000-0000-0000-0000-000000000001","sourceBracketId":"72000000-0000-0000-0000-000000000001","topN":3,"destinationCapacity":6,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000003","order":1}]},{"id":"73000000-0000-0000-0000-000000000002","sourceBracketId":"72000000-0000-0000-0000-000000000002","topN":3,"destinationCapacity":6,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000003","order":1}]}]}'::jsonb,
  '74000000-0000-0000-0000-000000000001'
) payload;

select is((select count(*) from public.meets where name = 'Championship'), 1::bigint, 'wizard creates one meet');
select is((select count(*) from public.brackets where meet_id = (select (payload->>'meet_id')::uuid from workbook_result)), 3::bigint, 'wizard creates all independent brackets');
select is((select count(*) from public.advancement_rules where meet_id = (select (payload->>'meet_id')::uuid from workbook_result)), 2::bigint, 'wizard creates complete progression rules');
select is((select count(*) from public.audit_events where request_id = '74000000-0000-0000-0000-000000000001' and action = 'meet.workbook_saved'), 1::bigint, 'wizard save has one atomic audit receipt');
select is((public.save_meet_workbook('71000000-0000-0000-0000-000000000001', null, null, '{}'::jsonb, '74000000-0000-0000-0000-000000000001')->>'meet_id'), (select payload->>'meet_id' from workbook_result), 'wizard request id is idempotent');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003';
select throws_ok($$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', (select (payload->>'meet_id')::uuid from workbook_result), 0, '{"meet":{},"brackets":[],"rules":[]}', '74000000-0000-0000-0000-000000000002') from workbook_result$$, 'MEET_VERSION_CONFLICT', 'second organiser loses stale workbook version');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004';
select throws_ok($$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', null, null, '{}'::jsonb, '74000000-0000-0000-0000-000000000003')$$, 'MEET_FORBIDDEN', 'marshal cannot save meet setup');
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000005';
select throws_ok($$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', null, null, '{}'::jsonb, '74000000-0000-0000-0000-000000000004')$$, 'MEET_FORBIDDEN', 'viewer cannot save meet setup');
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000006';
select throws_ok($$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', null, null, '{}'::jsonb, '74000000-0000-0000-0000-000000000005')$$, 'MEET_FORBIDDEN', 'outsider cannot save meet setup');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', null, null, '{"meet":{"name":"Cycle","venue":"","meetDate":"2026-08-14","status":"setup","settings":{}},"brackets":[{"id":"72000000-0000-0000-0000-000000000011","name":"Q","stage":"qualifier","displayOrder":1,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000012","name":"S","stage":"semifinal","displayOrder":2,"status":"setup","settings":{}}],"rules":[{"id":"73000000-0000-0000-0000-000000000011","sourceBracketId":"72000000-0000-0000-0000-000000000011","topN":1,"destinationCapacity":2,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000012","order":1}]},{"id":"73000000-0000-0000-0000-000000000012","sourceBracketId":"72000000-0000-0000-0000-000000000012","topN":1,"destinationCapacity":2,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000011","order":1}]}]}'::jsonb, '74000000-0000-0000-0000-000000000006')$$,
  'MEET_INVALID_STAGE_ORDER', 'invalid cyclic/backward graph is rejected'
);
select is((select count(*) from public.meets where name = 'Cycle'), 0::bigint, 'invalid graph rolls back without a partial meet');

select throws_ok(
  $$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', null, null, '{"meet":{"name":"Capacity","venue":"","meetDate":"2026-08-14","status":"setup","settings":{}},"brackets":[{"id":"72000000-0000-0000-0000-000000000021","name":"Q","stage":"qualifier","displayOrder":1,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000022","name":"F","stage":"final","displayOrder":2,"status":"setup","settings":{}}],"rules":[{"id":"73000000-0000-0000-0000-000000000021","sourceBracketId":"72000000-0000-0000-0000-000000000021","topN":3,"destinationCapacity":2,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000022","order":1}]}]}'::jsonb, '74000000-0000-0000-0000-000000000007')$$,
  'MEET_DESTINATION_CAPACITY', 'collective destination capacity is validated before insert'
);
select throws_ok(
  $$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', null, null, '{"meet":{"name":"Mixed Capacity","venue":"","meetDate":"2026-08-14","status":"setup","settings":{}},"brackets":[{"id":"72000000-0000-0000-0000-000000000031","name":"Q1","stage":"qualifier","displayOrder":1,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000032","name":"Q2","stage":"qualifier","displayOrder":2,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000033","name":"F","stage":"final","displayOrder":3,"status":"setup","settings":{}}],"rules":[{"id":"73000000-0000-0000-0000-000000000031","sourceBracketId":"72000000-0000-0000-0000-000000000031","topN":1,"destinationCapacity":9,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000033","order":1}]},{"id":"73000000-0000-0000-0000-000000000032","sourceBracketId":"72000000-0000-0000-0000-000000000032","topN":1,"destinationCapacity":6,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000033","order":1}]}]}'::jsonb, '74000000-0000-0000-0000-000000000027')$$,
  'MEET_INCONSISTENT_DESTINATION_CAPACITY', 'shared destination capacity cannot depend on source-rule order'
);
select is((select count(*) from public.meets where name = 'Mixed Capacity'), 0::bigint, 'mixed-capacity graph leaves no partial meet');

select public.save_registration_batch(
  '72000000-0000-0000-0000-000000000001', 1,
  '[{"participantId":"75000000-0000-0000-0000-000000000001","participantName":"Driver A","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000001","carNumber":7,"carName":"Rocket","active":true},{"participantId":"75000000-0000-0000-0000-000000000002","participantName":"Driver B","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000002","carNumber":8,"carName":"Comet","active":true}]'::jsonb,
  '74000000-0000-0000-0000-000000000008'
);
select is((select count(*) from public.cars where bracket_id = '72000000-0000-0000-0000-000000000001'), 2::bigint, 'registration batch commits all cars');
select is((select active from public.cars where id = '76000000-0000-0000-0000-000000000001'), true, 'registration creates active cars');
select is((select count(*) from public.audit_events where request_id = '74000000-0000-0000-0000-000000000008' and action = 'registration.batch_saved'), 1::bigint, 'registration batch has one audit receipt');
select lives_ok($$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 1, '[]', '74000000-0000-0000-0000-000000000008')$$, 'registration batch retry is idempotent');

select throws_ok(
  $$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 2, '[{"participantId":"75000000-0000-0000-0000-000000000003","participantName":"Driver C","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000003","carNumber":8,"carName":"Duplicate","active":true}]', '74000000-0000-0000-0000-000000000009')$$,
  'MEET_DUPLICATE_CAR_NUMBER', 'car number is unique inside one bracket'
);
select is((select count(*) from public.participants where id = '75000000-0000-0000-0000-000000000003'), 0::bigint, 'duplicate registration rolls back its participant too');
select lives_ok(
  $$select public.save_registration_batch('72000000-0000-0000-0000-000000000002', 1, '[{"participantId":"75000000-0000-0000-0000-000000000004","participantName":"Driver D","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000004","carNumber":7,"carName":"Other Seven","active":true}]', '74000000-0000-0000-0000-000000000010')$$,
  'the same car number is valid in another bracket'
);
select lives_ok(
  $$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 2, '[{"participantId":"75000000-0000-0000-0000-000000000001","participantName":"Driver A","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000001","carNumber":7,"carName":"Rocket","active":false}]', '74000000-0000-0000-0000-000000000011')$$,
  'registration batch can withdraw a car'
);
select is((select active from public.cars where id = '76000000-0000-0000-0000-000000000001'), false, 'withdrawal retains the car as inactive');
select is((select before_state->'car'->>'active' from public.audit_events where request_id = '74000000-0000-0000-0000-000000000011' and action = 'registration.row_saved.76000000-0000-0000-0000-000000000001'), 'true', 'registration row audit retains the prior active value');
select is((select after_state->'car'->>'active' from public.audit_events where request_id = '74000000-0000-0000-0000-000000000011' and action = 'registration.row_saved.76000000-0000-0000-0000-000000000001'), 'false', 'registration row audit retains the new active value');
select lives_ok(
  $$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 3, '[{"participantId":"75000000-0000-0000-0000-000000000001","participantName":"Driver A","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000001","carNumber":7,"carName":"Rocket","active":true}]', '74000000-0000-0000-0000-000000000012')$$,
  'registration batch can restore a withdrawn car'
);
select throws_ok(
  $$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 4, '[{"participantId":"75000000-0000-0000-0000-000000000001","participantName":"Driver A","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000001","carNumber":7,"carName":"Rocket","active":true,"sourceBracketId":"72000000-0000-0000-0000-000000000002"}]', '74000000-0000-0000-0000-000000000019')$$,
  'MEET_INVALID_REGISTRATION_ROW', 'registration payload cannot set advancement lineage'
);
select is((select source_bracket_id from public.cars where id = '76000000-0000-0000-0000-000000000001'), null::uuid, 'rejected registration leaves lineage untouched');

reset role;
insert into public.advancement_snapshots
  (id, organisation_id, meet_id, rule_id, source_bracket_id, source_result_version, confirmed_by, request_id)
select '78000000-0000-0000-0000-000000000001', organisation_id, meet_id,
  '73000000-0000-0000-0000-000000000001', id, version,
  '70000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-000000000002'
from public.brackets where id = '72000000-0000-0000-0000-000000000001';
insert into public.advancement_snapshots
  (id, organisation_id, meet_id, rule_id, source_bracket_id, source_result_version, confirmed_by, request_id)
select '78000000-0000-0000-0000-000000000003', organisation_id, meet_id,
  '73000000-0000-0000-0000-000000000002', id, version,
  '70000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-000000000004'
from public.brackets where id = '72000000-0000-0000-0000-000000000002';
insert into public.participants (id, organisation_id, bracket_id, name)
select '75000000-0000-0000-0000-000000000010', organisation_id, id, 'Advanced Driver'
from public.brackets where id = '72000000-0000-0000-0000-000000000003';
insert into public.cars
  (id, organisation_id, bracket_id, participant_id, car_number, name, source_bracket_id, source_car_id, rule_id, snapshot_id)
select '76000000-0000-0000-0000-000000000010', organisation_id, id,
  '75000000-0000-0000-0000-000000000010', 1, 'Advanced Car',
  '72000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-000000000001'
from public.brackets where id = '72000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';
select lives_ok(
  $$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', (select (payload->>'meet_id')::uuid from workbook_result), 5, '{"meet":{"name":"Championship","venue":"Updated Track","meetDate":"2026-08-14","status":"running","settings":{}},"brackets":[{"id":"72000000-0000-0000-0000-000000000001","name":"Qualifier A reviewed","stage":"qualifier","displayOrder":1,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000002","name":"Qualifier B","stage":"qualifier","displayOrder":2,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000003","name":"Final","stage":"final","displayOrder":3,"status":"setup","settings":{}}],"rules":[{"id":"73000000-0000-0000-0000-000000000001","sourceBracketId":"72000000-0000-0000-0000-000000000001","topN":3,"destinationCapacity":6,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000003","order":1}]},{"id":"73000000-0000-0000-0000-000000000002","sourceBracketId":"72000000-0000-0000-0000-000000000002","topN":3,"destinationCapacity":6,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000003","order":1}]}]}'::jsonb, '74000000-0000-0000-0000-000000000031') from workbook_result$$,
  'meet metadata remains editable after advancement without reallocating existing cars'
);
select is((select venue from public.meets where id = (select (payload->>'meet_id')::uuid from workbook_result)), 'Updated Track', 'post-advancement metadata save persists');
select throws_ok(
  $$select public.save_meet_workbook('71000000-0000-0000-0000-000000000001', (select (payload->>'meet_id')::uuid from workbook_result), 6, '{"meet":{"name":"Championship","venue":"Updated Track","meetDate":"2026-08-14","status":"running","settings":{}},"brackets":[{"id":"72000000-0000-0000-0000-000000000001","name":"Qualifier A reviewed","stage":"qualifier","displayOrder":1,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000002","name":"Qualifier B","stage":"qualifier","displayOrder":2,"status":"setup","settings":{}},{"id":"72000000-0000-0000-0000-000000000003","name":"Final","stage":"final","displayOrder":3,"status":"setup","settings":{}}],"rules":[{"id":"73000000-0000-0000-0000-000000000001","sourceBracketId":"72000000-0000-0000-0000-000000000001","topN":2,"destinationCapacity":6,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000003","order":1}]},{"id":"73000000-0000-0000-0000-000000000002","sourceBracketId":"72000000-0000-0000-0000-000000000002","topN":3,"destinationCapacity":6,"status":"active","destinations":[{"bracketId":"72000000-0000-0000-0000-000000000003","order":1}]}]}'::jsonb, '74000000-0000-0000-0000-000000000032') from workbook_result$$,
  'MEET_WORKBOOK_IN_USE', 'advancement freezes progression structure while metadata remains editable'
);
select is(
  (public.save_registration_batch('72000000-0000-0000-0000-000000000002', 2, '[{"participantId":"75000000-0000-0000-0000-000000000004","participantName":"Driver D","email":"","phone":"","notes":"Corrected after advancement","carId":"76000000-0000-0000-0000-000000000004","carNumber":9,"carName":"Other Nine","active":true}]', '74000000-0000-0000-0000-000000000033')->>'stale_advancement_count')::integer,
  1, 'registration correction reports the stale advancement warning count'
);
select is((select stale from public.advancement_snapshots where id = '78000000-0000-0000-0000-000000000003'), true, 'registration correction marks current source advancement stale');
select throws_ok(
  $$select public.save_registration_batch('72000000-0000-0000-0000-000000000003', 1, '[{"participantId":"75000000-0000-0000-0000-000000000010","participantName":"Rewritten Driver","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000011","carNumber":2,"carName":"Lineage Sibling","active":true}]', '74000000-0000-0000-0000-000000000028')$$,
  'MEET_REGISTRATION_LINEAGE_LOCKED', 'registration cannot mutate an advanced identity through a new sibling car ID'
);
select is((select name from public.participants where id = '75000000-0000-0000-0000-000000000010'), 'Advanced Driver', 'rejected sibling registration preserves advanced participant identity');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004';
select throws_ok($$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 4, '[]', '74000000-0000-0000-0000-000000000020')$$, 'MEET_FORBIDDEN', 'marshal cannot save registration');
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000005';
select throws_ok($$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 4, '[]', '74000000-0000-0000-0000-000000000021')$$, 'MEET_FORBIDDEN', 'viewer cannot save registration');
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000006';
select throws_ok($$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 4, '[]', '74000000-0000-0000-0000-000000000022')$$, 'MEET_FORBIDDEN', 'outsider cannot save registration');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004';
select throws_ok($$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 4, '{}'::jsonb, null, '74000000-0000-0000-0000-000000000023')$$, 'MEET_FORBIDDEN', 'marshal cannot activate a schedule');
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000005';
select throws_ok($$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 4, '{}'::jsonb, null, '74000000-0000-0000-0000-000000000024')$$, 'MEET_FORBIDDEN', 'viewer cannot activate a schedule');
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000006';
select throws_ok($$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 4, '{}'::jsonb, null, '74000000-0000-0000-0000-000000000025')$$, 'MEET_FORBIDDEN', 'outsider cannot activate a schedule');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';

select public.activate_bracket_schedule(
  '72000000-0000-0000-0000-000000000001', 4,
  '{"seed":"fixture-42","quality":{"opponentRepeatExcess":0,"lowerBound":0,"maxPairFrequency":1,"maxCarRepeatBurden":0,"laneSpread":1,"provenOptimal":true},"heats":[{"id":"77000000-0000-0000-0000-000000000001","roundNumber":1,"heatNumber":1,"phase":"preliminary","lanes":["76000000-0000-0000-0000-000000000001","76000000-0000-0000-0000-000000000002"]}]}'::jsonb,
  null, '74000000-0000-0000-0000-000000000013'
);
select is((select count(*) from public.heats where bracket_id = '72000000-0000-0000-0000-000000000001'), 1::bigint, 'schedule activation creates pending heats atomically');
select is((select settings->'activeSchedule'->>'seed' from public.brackets where id = '72000000-0000-0000-0000-000000000001'), 'fixture-42', 'deterministic seed is stored with the bracket');
select is((select count(*) from public.audit_events where request_id = '74000000-0000-0000-0000-000000000013' and action = 'schedule.activated'), 1::bigint, 'schedule activation has one audit receipt');
select lives_ok($$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 4, '{}'::jsonb, null, '74000000-0000-0000-0000-000000000013')$$, 'schedule retry is idempotent');
select throws_ok(
  $$select public.save_registration_batch('72000000-0000-0000-0000-000000000001', 5, '[{"participantId":"75000000-0000-0000-0000-000000000001","participantName":"Driver A","email":"","phone":"","notes":"","carId":"76000000-0000-0000-0000-000000000001","carNumber":7,"carName":"Rocket","active":false}]', '74000000-0000-0000-0000-000000000029')$$,
  'MEET_REGISTRATION_SCHEDULED', 'registration cannot deactivate a car referenced by a pending schedule'
);
select is((select active from public.cars where id = '76000000-0000-0000-0000-000000000001'), true, 'rejected scheduled withdrawal leaves the car active');
select lives_ok(
  $$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 5, '{"seed":"fixture-43","quality":{"opponentRepeatExcess":0,"lowerBound":0,"maxPairFrequency":1,"maxCarRepeatBurden":0,"laneSpread":1,"provenOptimal":true},"heats":[{"id":"77000000-0000-0000-0000-000000000002","roundNumber":1,"heatNumber":1,"phase":"preliminary","lanes":["76000000-0000-0000-0000-000000000001","76000000-0000-0000-0000-000000000002"]}]}', 'New published candidate', '74000000-0000-0000-0000-000000000030')$$,
  'reasoned pending schedule replacement succeeds'
);
select is((select before_state->>'id' from public.audit_events where request_id = '74000000-0000-0000-0000-000000000030' and action = 'schedule.heat_retired.77000000-0000-0000-0000-000000000001'), '77000000-0000-0000-0000-000000000001', 'schedule audit retains the retired heat lanes and identity');
select is((select after_state->>'id' from public.audit_events where request_id = '74000000-0000-0000-0000-000000000030' and action = 'schedule.heat_activated.77000000-0000-0000-0000-000000000002'), '77000000-0000-0000-0000-000000000002', 'schedule audit retains the activated heat lanes and identity');
select throws_ok(
  $$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 6, '{"seed":"false-quality","quality":{"opponentRepeatExcess":1,"lowerBound":0,"maxPairFrequency":1,"maxCarRepeatBurden":0,"laneSpread":1,"provenOptimal":false},"heats":[{"id":"77000000-0000-0000-0000-000000000010","roundNumber":1,"heatNumber":1,"phase":"preliminary","lanes":["76000000-0000-0000-0000-000000000001","76000000-0000-0000-0000-000000000002"]}]}', 'Replacing candidate', '74000000-0000-0000-0000-000000000026')$$,
  'MEET_SCHEDULE_QUALITY_MISMATCH', 'client-reported schedule quality is recomputed before activation'
);
select throws_ok(
  $$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 6, '{"seed":"bad-round","quality":{"opponentRepeatExcess":0,"lowerBound":0,"maxPairFrequency":1,"maxCarRepeatBurden":0,"laneSpread":1,"provenOptimal":true},"heats":[{"id":"77000000-0000-0000-0000-000000000011","roundNumber":1,"heatNumber":1,"phase":"preliminary","lanes":["76000000-0000-0000-0000-000000000001","76000000-0000-0000-0000-000000000002"]},{"id":"77000000-0000-0000-0000-000000000012","roundNumber":1,"heatNumber":2,"phase":"preliminary","lanes":["76000000-0000-0000-0000-000000000001","76000000-0000-0000-0000-000000000002"]}]}', 'Replacing candidate', '74000000-0000-0000-0000-000000000014')$$,
  'MEET_DUPLICATE_ROUND_APPEARANCE', 'one car cannot appear twice in a round'
);
select is((select count(*) from public.heats where bracket_id = '72000000-0000-0000-0000-000000000001'), 1::bigint, 'invalid schedule leaves the active schedule intact');

reset role;
update public.heats set status = 'confirmed', winner_car_id = lane_1_car_id, confirmed_by = '70000000-0000-0000-0000-000000000001', confirmed_at = now() where bracket_id = '72000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.activate_bracket_schedule('72000000-0000-0000-0000-000000000001', 6, '{"seed":"unsafe","quality":{"opponentRepeatExcess":0,"lowerBound":0,"maxPairFrequency":1,"maxCarRepeatBurden":0,"laneSpread":1,"provenOptimal":true},"heats":[{"id":"77000000-0000-0000-0000-000000000021","roundNumber":1,"heatNumber":1,"phase":"preliminary","lanes":["76000000-0000-0000-0000-000000000001","76000000-0000-0000-0000-000000000002"]}]}', 'Do not erase results', '74000000-0000-0000-0000-000000000015')$$,
  'MEET_CONFIRMED_RESULTS_EXIST', 'confirmed results can never be silently replaced'
);
select is((select count(*) from public.heats where status = 'confirmed' and bracket_id = '72000000-0000-0000-0000-000000000001'), 1::bigint, 'confirmed result guard preserves the official heat');

reset role;
insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order)
select '7a000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
  (payload->>'meet_id')::uuid, 'Audit reassignment fixture', 'qualifier', 4
from workbook_result;
insert into public.participants (id, organisation_id, bracket_id, name)
values
  ('7a000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 'Participant A'),
  ('7a000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 'Participant B');
insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
values ('7a000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000001',
  '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000002', 42, 'Reassigned car');
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';
select public.save_registration_batch(
  '7a000000-0000-0000-0000-000000000001', 1,
  '[{"participantId":"7a000000-0000-0000-0000-000000000003","participantName":"Participant B","email":"","phone":"","notes":"","carId":"7a000000-0000-0000-0000-000000000004","carNumber":42,"carName":"Reassigned car","active":true}]'::jsonb,
  '7a000000-0000-0000-0000-000000000005'
);
select is((select before_state->'participant'->>'id' from public.audit_events
  where request_id = '7a000000-0000-0000-0000-000000000005'
    and action = 'registration.row_saved.7a000000-0000-0000-0000-000000000004'),
  '7a000000-0000-0000-0000-000000000002', 'reassignment audit before participant is participant A');
select is((select before_state->'car'->>'participant_id' from public.audit_events
  where request_id = '7a000000-0000-0000-0000-000000000005'
    and action = 'registration.row_saved.7a000000-0000-0000-0000-000000000004'),
  '7a000000-0000-0000-0000-000000000002', 'reassignment audit before car still belongs to participant A');
select is((select after_state->'participant'->>'id' from public.audit_events
  where request_id = '7a000000-0000-0000-0000-000000000005'
    and action = 'registration.row_saved.7a000000-0000-0000-0000-000000000004'),
  '7a000000-0000-0000-0000-000000000003', 'reassignment audit after participant is participant B');
select is((select after_state->'car'->>'participant_id' from public.audit_events
  where request_id = '7a000000-0000-0000-0000-000000000005'
    and action = 'registration.row_saved.7a000000-0000-0000-0000-000000000004'),
  '7a000000-0000-0000-0000-000000000003', 'reassignment audit after car belongs to participant B');

reset role;
select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.audit_events'::regclass
    and conname = 'audit_events_bracket_id_fkey' and confdeltype = 'n'
), 'migration installs the named bracket audit FK with SET NULL deletion');
insert into public.meets (id, organisation_id, name, meet_date, created_by)
values ('79000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'Audit retention fixture', '2026-08-14', '70000000-0000-0000-0000-000000000001');
insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order)
values ('79000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', '79000000-0000-0000-0000-000000000001', 'Disposable bracket', 'qualifier', 1);
insert into public.audit_events
  (id, organisation_id, meet_id, bracket_id, actor_id, action, entity_type, entity_id, request_id)
values ('79000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', '79000000-0000-0000-0000-000000000001', '79000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'fixture.bracket_removed', 'bracket', '79000000-0000-0000-0000-000000000002', '79000000-0000-0000-0000-000000000004');
delete from public.brackets where id = '79000000-0000-0000-0000-000000000002';
select is((select count(*) from public.audit_events where id = '79000000-0000-0000-0000-000000000003'), 1::bigint, 'bracket deletion preserves its immutable audit event');
select is((select organisation_id from public.audit_events where id = '79000000-0000-0000-0000-000000000003'), '71000000-0000-0000-0000-000000000001'::uuid, 'bracket deletion preserves audit organisation ownership');
select is((select bracket_id from public.audit_events where id = '79000000-0000-0000-0000-000000000003'), null::uuid, 'bracket deletion clears only the audit bracket reference');

select is((private_meet.lane_times_from_milliseconds('{"lane1":10250,"lane2":10751}'::jsonb)->>'lane1')::numeric, 10.250::numeric, 'integer milliseconds convert exactly to three-decimal seconds');
select throws_ok($$select private_meet.lane_times_from_milliseconds('{"lane1":10.5}'::jsonb)$$, 'MEET_INVALID_LANE_TIMES', 'fractional milliseconds are rejected');

select * from finish();
rollback;
