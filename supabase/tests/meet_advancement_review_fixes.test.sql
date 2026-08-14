begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('52000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-owner@example.test', '', now(), now(), now());
insert into public.organisations (id, name, slug, created_by) values
  ('52000000-0000-0000-0001-000000000001', 'Review Source Club', 'review-source-club', '52000000-0000-0000-0000-000000000001'),
  ('52000000-0000-0000-0001-000000000002', 'Review Decoy Club', 'review-decoy-club', '52000000-0000-0000-0000-000000000001');
insert into public.organisation_memberships (organisation_id, user_id, role) values
  ('52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0000-000000000001', 'owner'),
  ('52000000-0000-0000-0001-000000000002', '52000000-0000-0000-0000-000000000001', 'owner');
insert into public.meets (id, organisation_id, name, meet_date, status) values
  ('52000000-0000-0000-0002-000000000001', '52000000-0000-0000-0001-000000000001', 'Review Meet', '2026-08-14', 'running'),
  ('52000000-0000-0000-0002-000000000002', '52000000-0000-0000-0001-000000000002', 'Decoy Meet', '2026-08-14', 'running');
insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status) values
  ('52000000-0000-0000-0003-000000000001', '52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0002-000000000001', 'Qualifier', 'qualifier', 1, 'running'),
  ('52000000-0000-0000-0003-000000000002', '52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0002-000000000001', 'Final', 'final', 2, 'running');
insert into public.participants (id, organisation_id, bracket_id, name)
values ('52000000-0000-0000-0004-000000000001', '52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0003-000000000001', 'Review Driver');
insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
values ('52000000-0000-0000-0005-000000000001', '52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0003-000000000001', '52000000-0000-0000-0004-000000000001', 1, 'Review Car');
insert into public.heats (id, organisation_id, bracket_id, round_number, heat_number, lane_1_car_id)
values ('52000000-0000-0000-0006-000000000001', '52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0003-000000000001', 1, 1, '52000000-0000-0000-0005-000000000001');
insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
values ('52000000-0000-0000-0007-000000000001', '52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0002-000000000001', '52000000-0000-0000-0003-000000000001', 1, 1);
insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
values ('52000000-0000-0000-0001-000000000001', '52000000-0000-0000-0002-000000000001', '52000000-0000-0000-0007-000000000001', '52000000-0000-0000-0003-000000000002', 1);

select set_config('request.jwt.claims', json_build_object('sub', '52000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$select public.confirm_heat_winner('52000000-0000-0000-0006-000000000001', '52000000-0000-0000-0005-000000000001', '{}', 1, '52000000-0000-0000-0008-000000000001')$$,
  'winner confirmation commits before the car later becomes inactive'
);

reset role;
insert into public.audit_events
  (organisation_id, meet_id, actor_id, action, entity_type, entity_id, before_state, after_state, request_id)
values
  ('52000000-0000-0000-0001-000000000002', '52000000-0000-0000-0002-000000000002', '52000000-0000-0000-0000-000000000001',
   'advancement.confirmed', 'advancement_snapshot', '52000000-0000-0000-0009-000000000001', '{"decoy":"before"}', '{"decoy":"after"}',
   '52000000-0000-0000-0008-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.confirm_advancement('52000000-0000-0000-0007-000000000001', 2, 1,
    '[{"sourceCarId":"52000000-0000-0000-0005-000000000001","destinationBracketId":"52000000-0000-0000-0003-000000000002","rank":1}]', null,
    '52000000-0000-0000-0008-000000000002')$$,
  'advancement confirmation enriches only its own organisation snapshot audit'
);
select ok(not (select before_state ? 'selections' from public.audit_events where organisation_id = '52000000-0000-0000-0001-000000000002' and request_id = '52000000-0000-0000-0008-000000000002'), 'same-request audit in another organisation keeps its before value');
select ok(not (select after_state ? 'selections' from public.audit_events where organisation_id = '52000000-0000-0000-0001-000000000002' and request_id = '52000000-0000-0000-0008-000000000002'), 'same-request audit in another organisation keeps its after value');

reset role;
update public.cars set active = false where id = '52000000-0000-0000-0005-000000000001';
set local role authenticated;
select lives_ok(
  $$select public.confirm_heat_winner('52000000-0000-0000-0006-000000000001', '52000000-0000-0000-0005-000000000001', '{}', 1, '52000000-0000-0000-0008-000000000001')$$,
  'idempotent winner retry returns its original receipt before active-car validation'
);
select throws_ok(
  $$select public.save_registration_batch('52000000-0000-0000-0003-000000000001', 2,
    '[{"participantId":"52000000-0000-0000-0004-000000000001","participantName":"Review Driver","email":"","phone":"","notes":"","carId":"52000000-0000-0000-0005-000000000001","carNumber":1,"carName":"Review Car","active":true}]',
    '52000000-0000-0000-0008-000000000003')$$,
  'P0001', 'MEET_REASON_REQUIRED', 'restoring an existing car requires a reason'
);
select throws_ok(
  $$select public.save_registration_batch('52000000-0000-0000-0003-000000000001', 2,
    '[{"participantId":"52000000-0000-0000-0004-000000000001","participantName":"Review Driver","email":"","phone":"","notes":"","carId":"52000000-0000-0000-0005-000000000001","carNumber":1,"carName":"Review Car","active":true,"reason":"   "}]',
    '52000000-0000-0000-0008-000000000004')$$,
  'P0001', 'MEET_REASON_REQUIRED', 'whitespace-only registration status reason is rejected'
);
select throws_ok(
  $$select public.save_registration_batch('52000000-0000-0000-0003-000000000001', 2,
    jsonb_build_array(jsonb_build_object('participantId','52000000-0000-0000-0004-000000000001','participantName','Review Driver','email','','phone','','notes','','carId','52000000-0000-0000-0005-000000000001','carNumber',1,'carName','Review Car','active',true,'reason',repeat('x',501))),
    '52000000-0000-0000-0008-000000000005')$$,
  'P0001', 'MEET_REASON_REQUIRED', 'registration status reason over 500 characters is rejected'
);
select lives_ok(
  $$select public.save_registration_batch('52000000-0000-0000-0003-000000000001', 2,
    '[{"participantId":"52000000-0000-0000-0004-000000000001","participantName":"Review Driver","email":"","phone":"","notes":"","carId":"52000000-0000-0000-0005-000000000001","carNumber":1,"carName":"Review Car","active":true,"reason":"Marshal verified repair"}]',
    '52000000-0000-0000-0008-000000000006')$$,
  'a bounded reason permits an existing car status change'
);
select is(
  (select reason from public.audit_events where request_id = '52000000-0000-0000-0008-000000000006' and action = 'registration.row_saved.52000000-0000-0000-0005-000000000001'),
  'Marshal verified repair',
  'registration status audit persists the bounded reason'
);
select throws_ok($$select public.list_security_events('52000000-0000-0000-0001-000000000001', null, null, null)$$, 'P0001', 'MEET_INVALID_PAGE', 'NULL security-event page size is rejected');
select throws_ok($$select public.get_admin_overview('52000000-0000-0000-0001-000000000001', null)$$, 'P0001', 'MEET_INVALID_PAGE', 'NULL admin recent limit is rejected');

reset role;
select * from finish();
rollback;
