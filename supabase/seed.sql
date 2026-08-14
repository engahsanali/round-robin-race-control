-- Deterministic local demo data. The invalid.example user has no usable password
-- and is not a production credential. Recreated by `supabase db reset`.
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('de000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'meet-demo-owner@invalid.example', '', now(), now(), now());

insert into public.organisations (id, name, slug, created_by)
values ('de000000-0000-0000-0000-000000000010', 'Meet Edition Demo Club', 'meet-edition-demo',
  'de000000-0000-0000-0000-000000000001');

insert into public.organisation_memberships (organisation_id, user_id, role)
values ('de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000001', 'owner');

insert into public.meets
  (id, organisation_id, name, venue, meet_date, status, settings, created_by)
values
  ('de000000-0000-0000-0000-000000000020', 'de000000-0000-0000-0000-000000000010',
   'Deterministic Demo Meet', 'Demo Track', '2026-08-14', 'running',
   '{"laneCount":3,"rankingMode":"competition"}', 'de000000-0000-0000-0000-000000000001');

insert into public.brackets
  (id, organisation_id, meet_id, name, stage, display_order, status)
values
  ('de000000-0000-0000-0000-000000000031', 'de000000-0000-0000-0000-000000000010',
   'de000000-0000-0000-0000-000000000020', 'Demo Qualifier', 'qualifier', 1, 'running'),
  ('de000000-0000-0000-0000-000000000032', 'de000000-0000-0000-0000-000000000010',
   'de000000-0000-0000-0000-000000000020', 'Demo Final', 'final', 2, 'setup');

insert into public.participants (id, organisation_id, bracket_id, name)
values
  ('de000000-0000-0000-0000-000000000041', 'de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000031', 'Demo Driver One'),
  ('de000000-0000-0000-0000-000000000042', 'de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000031', 'Demo Driver Two'),
  ('de000000-0000-0000-0000-000000000043', 'de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000031', 'Demo Driver Three');

insert into public.cars (id, organisation_id, bracket_id, participant_id, car_number, name)
values
  ('de000000-0000-0000-0000-000000000051', 'de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000031', 'de000000-0000-0000-0000-000000000041', 7, 'Demo Seven'),
  ('de000000-0000-0000-0000-000000000052', 'de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000031', 'de000000-0000-0000-0000-000000000042', 12, 'Demo Twelve'),
  ('de000000-0000-0000-0000-000000000053', 'de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000031', 'de000000-0000-0000-0000-000000000043', 15, 'Demo Fifteen');

insert into public.heats
  (id, organisation_id, bracket_id, round_number, heat_number, lane_1_car_id, lane_2_car_id, lane_3_car_id)
values
  ('de000000-0000-0000-0000-000000000060', 'de000000-0000-0000-0000-000000000010',
   'de000000-0000-0000-0000-000000000031', 1, 1,
   'de000000-0000-0000-0000-000000000051', 'de000000-0000-0000-0000-000000000052',
   'de000000-0000-0000-0000-000000000053');

insert into public.advancement_rules
  (id, organisation_id, meet_id, source_bracket_id, top_n, destination_capacity)
values
  ('de000000-0000-0000-0000-000000000070', 'de000000-0000-0000-0000-000000000010',
   'de000000-0000-0000-0000-000000000020', 'de000000-0000-0000-0000-000000000031', 2, 6);

insert into public.advancement_rule_destinations
  (organisation_id, meet_id, rule_id, destination_bracket_id, destination_order)
values
  ('de000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000020',
   'de000000-0000-0000-0000-000000000070',
   'de000000-0000-0000-0000-000000000032', 1);
