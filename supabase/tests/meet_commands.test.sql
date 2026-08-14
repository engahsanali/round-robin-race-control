begin;

create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'command-owner@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'command-admin@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'command-organiser@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'command-marshal@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'command-viewer@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'command-outsider@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'command-invitee@example.test', '', now(), now(), now());

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.create_organisation('Command Club', 'command-club', '30000000-0000-0000-0001-000000000001')$$,
  'authenticated user can create an organisation and owner membership atomically'
);

select is(
  (select count(*) from public.organisation_memberships where user_id = '30000000-0000-0000-0000-000000000001' and role = 'owner'),
  1::bigint,
  'organisation creator becomes owner'
);

select is(
  (public.create_organisation('Ignored Duplicate', 'ignored-duplicate', '30000000-0000-0000-0001-000000000001')->>'organisation_id'),
  (select id::text from public.organisations where slug = 'command-club'),
  'duplicate organisation request ID is idempotent'
);

reset role;
insert into public.organisation_memberships (organisation_id, user_id, role)
select id, '30000000-0000-0000-0000-000000000002', 'admin' from public.organisations where slug = 'command-club'
union all select id, '30000000-0000-0000-0000-000000000003', 'organiser' from public.organisations where slug = 'command-club'
union all select id, '30000000-0000-0000-0000-000000000004', 'marshal' from public.organisations where slug = 'command-club'
union all select id, '30000000-0000-0000-0000-000000000005', 'viewer' from public.organisations where slug = 'command-club';

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.create_invitation((select id from public.organisations where slug = 'command-club'), 'viewer', now() + interval '1 day', '30000000-0000-0000-0001-000000000002')$$,
  'MEET_FORBIDDEN',
  'organisers cannot create invitations'
);

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';
create temporary table invitation_result as
select public.create_invitation(
  (select id from public.organisations where slug = 'command-club'),
  'viewer', now() + interval '1 day', '30000000-0000-0000-0001-000000000003'
) as payload;

select ok(length(payload->>'code') >= 32, 'owner receives a high-entropy invitation code once') from invitation_result;
select ok(
  not exists (select 1 from public.organisation_invitations where code_digest = (select payload->>'code' from invitation_result)),
  'only the invitation digest is stored'
);

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000007';
select lives_ok(
  $$select public.redeem_invitation((select payload->>'code' from invitation_result), '30000000-0000-0000-0001-000000000004')$$,
  'an unexpired invitation is redeemable once'
);
select is(
  (select role from public.organisation_memberships where user_id = '30000000-0000-0000-0000-000000000007'),
  'viewer',
  'redemption creates the invited membership'
);
select lives_ok(
  $$select public.redeem_invitation((select payload->>'code' from invitation_result), '30000000-0000-0000-0001-000000000004')$$,
  'repeating the same redemption request is idempotent'
);

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000006';
select is(
  (public.redeem_invitation((select payload->>'code' from invitation_result), '30000000-0000-0000-0001-000000000005')->>'code'),
  'MEET_INVITATION_UNAVAILABLE',
  'a used invitation returns the same structured unavailable result as an invalid code'
);
do $$
begin
  for attempt in 2..10 loop
    perform public.redeem_invitation(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_random_uuid());
  end loop;
end;
$$;
select is(
  (public.redeem_invitation(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_random_uuid())->>'code'),
  'MEET_RATE_LIMITED',
  'committed failed redemption attempts reach the first-party rate limit'
);
select is((select count(*) from public.organisation_memberships where user_id = '30000000-0000-0000-0000-000000000006'), 0::bigint, 'failed invitation guesses never create membership');
select is((select used_by::text from public.organisation_invitations where id = (select (payload->>'invitation_id')::uuid from invitation_result)), '30000000-0000-0000-0000-000000000007', 'failed guesses never mutate the redeemed invitation');

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.remove_membership((select id from public.organisations where slug = 'command-club'), '30000000-0000-0000-0000-000000000005', null, '30000000-0000-0000-0001-000000000015')$$,
  'MEET_REASON_REQUIRED',
  'membership removal rejects a NULL reason'
);
select throws_ok(
  $$select public.remove_membership((select id from public.organisations where slug = 'command-club'), '30000000-0000-0000-0000-000000000001', 'Remove final owner', '30000000-0000-0000-0001-000000000006')$$,
  'MEET_LAST_OWNER',
  'the last owner cannot be removed'
);

reset role;
insert into public.meets (id, organisation_id, name, venue, meet_date, status, created_by)
select '31000000-0000-0000-0000-000000000001', id, 'Command Meet', 'Track', '2026-08-14', 'running', '30000000-0000-0000-0000-000000000001'
from public.organisations where slug = 'command-club';
insert into public.brackets (id, organisation_id, meet_id, name, stage, display_order, status)
select '31000000-0000-0000-0001-000000000001', organisation_id, id, 'Qualifier', 'qualifier', 1, 'running' from public.meets where id = '31000000-0000-0000-0000-000000000001'
union all select '31000000-0000-0000-0001-000000000002', organisation_id, id, 'Final', 'final', 2, 'setup' from public.meets where id = '31000000-0000-0000-0000-000000000001';
insert into public.participants (id, organisation_id, bracket_id, name)
select '31000000-0000-0000-0002-000000000001', organisation_id, id, 'Driver 1' from public.brackets where id = '31000000-0000-0000-0001-000000000001'
union all select '31000000-0000-0000-0002-000000000002', organisation_id, id, 'Driver 2' from public.brackets where id = '31000000-0000-0000-0001-000000000001'
union all select '31000000-0000-0000-0002-000000000003', organisation_id, id, 'Driver 3' from public.brackets where id = '31000000-0000-0000-0001-000000000001';
insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
select '31000000-0000-0000-0003-000000000001', organisation_id, bracket_id, id, 1, 'Car 1' from public.participants where id = '31000000-0000-0000-0002-000000000001'
union all select '31000000-0000-0000-0003-000000000002', organisation_id, bracket_id, id, 2, 'Car 2' from public.participants where id = '31000000-0000-0000-0002-000000000002'
union all select '31000000-0000-0000-0003-000000000003', organisation_id, bracket_id, id, 3, 'Car 3' from public.participants where id = '31000000-0000-0000-0002-000000000003';
insert into public.heats (id, organisation_id, bracket_id, round_number, heat_number, lane_1_car_id, lane_2_car_id, lane_3_car_id)
select '31000000-0000-0000-0004-000000000001', organisation_id, id, 1, 1,
  '31000000-0000-0000-0003-000000000001', '31000000-0000-0000-0003-000000000002', '31000000-0000-0000-0003-000000000003'
from public.brackets where id = '31000000-0000-0000-0001-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000004';
select lives_ok(
  $$select public.confirm_heat_winner('31000000-0000-0000-0004-000000000001', '31000000-0000-0000-0003-000000000001', '{"lane1": 10.25, "lane2": 10.75, "lane3": 11.0}', 1, '30000000-0000-0000-0001-000000000007')$$,
  'marshal confirms an assigned-lane winner transactionally'
);
select is((select version from public.heats where id = '31000000-0000-0000-0004-000000000001'), 2, 'winner confirmation increments the heat version');
select is((select count(*) from public.audit_events where request_id = '30000000-0000-0000-0001-000000000007'), 1::bigint, 'winner confirmation creates one same-request audit');
select lives_ok(
  $$select public.confirm_heat_winner('31000000-0000-0000-0004-000000000001', '31000000-0000-0000-0003-000000000001', '{"lane1": 10.25, "lane2": 10.75, "lane3": 11.0}', 1, '30000000-0000-0000-0001-000000000007')$$,
  'repeating a winner request ID is idempotent'
);
select is((select version from public.heats where id = '31000000-0000-0000-0004-000000000001'), 2, 'idempotent winner retry does not increment twice');
select throws_ok(
  $$select public.confirm_heat_winner('31000000-0000-0000-0004-000000000001', '31000000-0000-0000-0003-000000000002', null, 1, '30000000-0000-0000-0001-000000000008')$$,
  'MEET_VERSION_CONFLICT',
  'different stale winner request loses with a version conflict'
);
select throws_ok(
  $$select public.correct_heat_winner('31000000-0000-0000-0004-000000000001', '31000000-0000-0000-0003-000000000002', null, 2, ' ', '30000000-0000-0000-0001-000000000009')$$,
  'MEET_REASON_REQUIRED',
  'winner correction requires a bounded non-empty reason'
);
select throws_ok(
  $$select public.correct_heat_winner('31000000-0000-0000-0004-000000000001', '31000000-0000-0000-0003-000000000002', null, 2, null, '30000000-0000-0000-0001-000000000016')$$,
  'MEET_REASON_REQUIRED',
  'winner correction rejects a NULL reason'
);
select lives_ok(
  $$select public.correct_heat_winner('31000000-0000-0000-0004-000000000001', '31000000-0000-0000-0003-000000000002', '{"lane2": 10.1}', 2, 'Photo finish review', '30000000-0000-0000-0001-000000000010')$$,
  'authorised winner correction succeeds atomically'
);

reset role;
insert into public.advancement_rules (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
select '31000000-0000-0000-0005-000000000001', organisation_id, meet_id, id, 2, 6 from public.brackets where id = '31000000-0000-0000-0001-000000000001';
insert into public.participants (id, organisation_id, bracket_id, name)
select '31000000-0000-0000-0002-000000000010', organisation_id, id, 'Pre-registered Finalist'
from public.brackets where id = '31000000-0000-0000-0001-000000000002';
insert into public.advancement_rule_destinations (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
select organisation_id, meet_id, '31000000-0000-0000-0005-000000000001', '31000000-0000-0000-0001-000000000002', 1
from public.brackets where id = '31000000-0000-0000-0001-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.confirm_advancement('31000000-0000-0000-0005-000000000001', 3, 1, '[{"sourceCarId":"31000000-0000-0000-0003-000000000002","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":1},{"sourceCarId":"31000000-0000-0000-0003-000000000001","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":2}]', null, '30000000-0000-0000-0001-000000000017')$$,
  'MEET_REASON_REQUIRED',
  'automatic advancement rejects a NULL reason at an unresolved cutoff tie'
);
select throws_ok(
  $$select public.confirm_advancement('31000000-0000-0000-0005-000000000001', 3, 1, '[{"sourceCarId":"31000000-0000-0000-0003-000000000001","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":1}]', null, '30000000-0000-0000-0001-000000000011')$$,
  'MEET_SELECTION_COUNT',
  'advancement rolls back unless the exact top-N count is supplied'
);
select is((select count(*) from public.advancement_snapshots), 0::bigint, 'invalid advancement leaves no partial snapshot');

select lives_ok(
  $$select public.confirm_advancement('31000000-0000-0000-0005-000000000001', 3, 1, '[{"sourceCarId":"31000000-0000-0000-0003-000000000001","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":1},{"sourceCarId":"31000000-0000-0000-0003-000000000002","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":2}]', 'Resolved published standings', '30000000-0000-0000-0001-000000000012')$$,
  'organiser confirms exact advancement in one transaction'
);
select is((select count(*) from public.advancement_selections), 2::bigint, 'advancement stores immutable source selections');
select is((select count(*) from public.cars where bracket_id = '31000000-0000-0000-0001-000000000002'), 2::bigint, 'advancement copies two entrants into the destination');
select lives_ok(
  $$select public.confirm_advancement('31000000-0000-0000-0005-000000000001', 3, 1, '[]', null, '30000000-0000-0000-0001-000000000012')$$,
  'duplicate advancement request ID is idempotent'
);

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000004';
select lives_ok(
  $$select public.correct_heat_winner('31000000-0000-0000-0004-000000000001', '31000000-0000-0000-0003-000000000001', '{"lane1": 9.9}', 3, 'Timing appeal upheld', '30000000-0000-0000-0001-000000000013')$$,
  'later upstream correction remains atomic'
);
select is((select stale from public.advancement_snapshots where request_id = '30000000-0000-0000-0001-000000000012'), true, 'upstream correction marks the confirmed snapshot stale');

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.replace_advancement('31000000-0000-0000-0005-000000000001', 4, 2, '[{"sourceCarId":"31000000-0000-0000-0003-000000000001","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":1},{"sourceCarId":"31000000-0000-0000-0003-000000000002","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":2}]', null, '30000000-0000-0000-0001-000000000018')$$,
  'MEET_REASON_REQUIRED',
  'advancement replacement rejects a NULL reason'
);
select lives_ok(
  $$select public.replace_advancement('31000000-0000-0000-0005-000000000001', 4, 2, '[{"sourceCarId":"31000000-0000-0000-0003-000000000001","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":1},{"sourceCarId":"31000000-0000-0000-0003-000000000002","destinationBracketId":"31000000-0000-0000-0001-000000000002","rank":2}]', 'Reconfirmed after timing appeal', '30000000-0000-0000-0001-000000000014')$$,
  'organiser replaces stale advancement with a reasoned snapshot'
);
select is((select count(*) from public.cars where bracket_id = '31000000-0000-0000-0001-000000000002' and active), 2::bigint, 'replacement exposes only the new active destination copies');
select is((select count(*) from public.cars where bracket_id = '31000000-0000-0000-0001-000000000002'), 4::bigint, 'replacement retains historical destination cars for downstream lineage');
select is((select count(*) from public.cars where bracket_id = '31000000-0000-0000-0001-000000000002' and not active), 2::bigint, 'replacement retires prior destination cars without deleting history');
select is((select count(*) from public.participants where id = '31000000-0000-0000-0002-000000000010'), 1::bigint, 'replacement preserves unrelated destination registrations');

reset role;
insert into public.heats (id, organisation_id, bracket_id, round_number, heat_number, lane_1_car_id, lane_2_car_id)
select '31000000-0000-0000-0004-000000000002', organisation_id, id, 2, 1,
  '31000000-0000-0000-0003-000000000001', '31000000-0000-0000-0003-000000000002'
from public.brackets where id = '31000000-0000-0000-0001-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000004';
select throws_ok(
  $$select public.confirm_heat_winner('31000000-0000-0000-0004-000000000002', '31000000-0000-0000-0003-000000000001', '{"lane3":12.0}', 1, '30000000-0000-0000-0001-000000000019')$$,
  'MEET_INVALID_LANE_TIMES',
  'an unassigned lane accepts no non-null time'
);

select * from finish();
rollback;
