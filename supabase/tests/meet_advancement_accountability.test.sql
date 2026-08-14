begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'accountability-owner@example.test', '', now(), now(), now()),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'accountability-organiser@example.test', '', now(), now(), now()),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'accountability-outsider@example.test', '', now(), now(), now());
insert into public.organisations (id, name, slug, created_by)
values ('51000000-0000-0000-0000-000000000001', 'Advancement Accountability Club', 'advancement-accountability-club', '50000000-0000-0000-0000-000000000001');
insert into public.organisation_memberships (organisation_id, user_id, role) values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'owner'),
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'organiser');

-- Reuse the deterministic organiser and organisation created by meet_advancement_review.test.sql.
select set_config('request.jwt.claims', json_build_object('sub', '50000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select has_function('public', 'list_security_events', array['uuid','integer','timestamptz','uuid'], 'security event pagination RPC exists');
select has_function('public', 'get_admin_overview', array['uuid','integer'], 'admin overview RPC exists');
select function_privs_are('public', 'list_security_events', array['uuid','integer','timestamptz','uuid'], 'authenticated', array['EXECUTE'], 'authenticated may call secured security event page');
select function_privs_are('public', 'get_admin_overview', array['uuid','integer'], 'authenticated', array['EXECUTE'], 'authenticated may call secured admin overview');

select throws_ok(
  $$select public.list_security_events('51000000-0000-0000-0000-000000000001', 101, null, null)$$,
  'P0001', 'MEET_INVALID_PAGE', 'security event page size is bounded'
);

select lives_ok(
  $$select public.list_security_events('51000000-0000-0000-0000-000000000001', 25, null, null)$$,
  'owner or admin can page organisation security events'
);

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '50000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.list_security_events('51000000-0000-0000-0000-000000000001', 25, null, null)$$, 'P0001', 'MEET_FORBIDDEN', 'organiser cannot page security events');
select throws_ok($$select public.get_admin_overview('51000000-0000-0000-0000-000000000001', 10)$$, 'P0001', 'MEET_FORBIDDEN', 'organiser cannot read admin overview');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '50000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.list_security_events('51000000-0000-0000-0000-000000000001', 25, null, null)$$, 'P0001', 'MEET_FORBIDDEN', 'outsider cannot page security events');
select throws_ok($$select public.get_admin_overview('51000000-0000-0000-0000-000000000001', 10)$$, 'P0001', 'MEET_FORBIDDEN', 'outsider cannot read admin overview');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '50000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

-- The fixture uses a fresh final destination and advanced car so replacement can
-- prove both the downstream-results block and safe pending-schedule retirement.
reset role;
do $$
declare
  source_id uuid := '81000000-0000-0000-0001-000000000001';
  destination_id uuid := '81000000-0000-0000-0001-000000000002';
  rule_id uuid := '81000000-0000-0000-0005-000000000001';
  participant_id uuid := '81000000-0000-0000-0002-000000000001';
  source_car_id uuid := '81000000-0000-0000-0003-000000000001';
begin
  insert into public.meets (id, organisation_id, name, meet_date, status)
  values ('81000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Accountability Meet', '2026-08-14', 'running');
  insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status) values
    (source_id, '51000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Qualifier', 'qualifier', 1, 'running'),
    (destination_id, '51000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Final', 'final', 2, 'running');
  insert into public.participants (id, organisation_id, bracket_id, name) values
    (participant_id, '51000000-0000-0000-0000-000000000001', source_id, 'Source Driver');
  insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
  values (source_car_id, '51000000-0000-0000-0000-000000000001', source_id, participant_id, 1, 'Source Car');
  insert into public.heats (id, organisation_id, bracket_id, round_number, heat_number, lane_1_car_id)
  values ('81000000-0000-0000-0004-000000000001', '51000000-0000-0000-0000-000000000001', source_id, 1, 1, source_car_id);
  insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
  values (rule_id, '51000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', source_id, 1, 4);
  insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
  values ('51000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', rule_id, destination_id, 1);
end $$;

set local role authenticated;
select public.confirm_heat_winner('81000000-0000-0000-0004-000000000001', '81000000-0000-0000-0003-000000000001', '{}', 1, '81000000-0000-0000-0008-000000000001');
-- Resolve generated IDs through the immutable selection row.
select lives_ok(
  $$select public.confirm_advancement('81000000-0000-0000-0005-000000000001', 2, 1,
    '[{"sourceCarId":"81000000-0000-0000-0003-000000000001","destinationBracketId":"81000000-0000-0000-0001-000000000002","rank":1}]', null,
    '81000000-0000-0000-0008-000000000002')$$,
  'initial advancement commits'
);

reset role;
insert into public.heats (id, organisation_id, bracket_id, round_number, heat_number, lane_1_car_id)
select '81000000-0000-0000-0004-000000000002', organisation_id, destination_bracket_id, 1, 1, destination_car_id
from public.advancement_selections where rule_id = '81000000-0000-0000-0005-000000000001';
set local role authenticated;

select throws_ok(
  $$select public.replace_advancement('81000000-0000-0000-0005-000000000001', 1, 2,
    '[{"sourceCarId":"81000000-0000-0000-0003-000000000001","destinationBracketId":"81000000-0000-0000-0001-000000000002","rank":1}]', 'Replace pending schedule',
    '81000000-0000-0000-0008-000000000003')$$,
  'P0001', 'MEET_VERSION_CONFLICT', 'source version mismatch remains explicit'
);

select lives_ok(
  $$select public.replace_advancement('81000000-0000-0000-0005-000000000001', 2, 2,
    '[{"sourceCarId":"81000000-0000-0000-0003-000000000001","destinationBracketId":"81000000-0000-0000-0001-000000000002","rank":1}]', 'Replace pending schedule',
    '81000000-0000-0000-0008-000000000004')$$,
  'safe replacement retires pending destination schedule references'
);
select is((select count(*) from public.heats where id = '81000000-0000-0000-0004-000000000002'), 0::bigint, 'pending heat referencing deactivated advancement car is removed');
select ok((select before_state ? 'selections' and after_state ? 'selections' from public.audit_events where request_id = '81000000-0000-0000-0008-000000000004'), 'replacement audit stores deterministic before and after selections');

reset role;
insert into public.heats (id, organisation_id, bracket_id, round_number, heat_number, status, lane_1_car_id, winner_car_id, confirmed_by, confirmed_at)
select '81000000-0000-0000-0004-000000000003', organisation_id, destination_bracket_id, 2, 1, 'confirmed', destination_car_id, destination_car_id,
  '50000000-0000-0000-0000-000000000001', statement_timestamp()
from public.advancement_selections where snapshot_id = (select id from public.advancement_snapshots where rule_id = '81000000-0000-0000-0005-000000000001' and replaced_by_snapshot_id is null);
set local role authenticated;

select throws_ok(
  $$select public.replace_advancement('81000000-0000-0000-0005-000000000001', 2, 3,
    '[{"sourceCarId":"81000000-0000-0000-0003-000000000001","destinationBracketId":"81000000-0000-0000-0001-000000000002","rank":1}]', 'Blocked downstream result',
    '81000000-0000-0000-0008-000000000005')$$,
  'P0001', 'MEET_DOWNSTREAM_RESULTS_EXIST', 'replacement is blocked after any destination result is confirmed'
);

reset role;
update public.cars set active = false where id = '81000000-0000-0000-0003-000000000001';
update public.heats set status = 'pending', winner_car_id = null, confirmed_by = null, confirmed_at = null where id = '81000000-0000-0000-0004-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.confirm_heat_winner('81000000-0000-0000-0004-000000000001', '81000000-0000-0000-0003-000000000001', '{}', 2, '81000000-0000-0000-0008-000000000006')$$,
  'P0001', 'MEET_INACTIVE_ASSIGNED_CAR', 'winner confirmation rejects an inactive assigned car'
);

-- Outsiders, organisers and viewers cannot read the two owner/admin operational RPCs.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '50000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(jsonb_typeof(public.get_admin_overview('51000000-0000-0000-0000-000000000001', 10)) = 'object', 'admin overview returns typed JSON');

reset role;
select * from finish();
rollback;
