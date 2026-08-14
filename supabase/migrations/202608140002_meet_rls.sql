create or replace function private_meet.is_org_member(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function private_meet.has_org_role(target_organisation_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role = any (allowed_roles)
  );
$$;

create or replace function private_meet.ensure_owner_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' or old.status <> 'active' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
    return null;
  end if;
  if not exists (
    select 1
    from public.organisation_memberships membership
    where membership.organisation_id = old.organisation_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'MEET_LAST_OWNER';
  end if;
  return null;
end;
$$;

create constraint trigger organisation_memberships_keep_owner
after delete or update of role, status on public.organisation_memberships
deferrable initially immediate
for each row execute function private_meet.ensure_owner_remains();

revoke all on all tables in schema public from anon, authenticated;
revoke all on schema private_meet from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on schema private_meet to authenticated;

grant select on table
  public.organisations,
  public.organisation_memberships,
  public.organisation_invitations,
  public.meets,
  public.brackets,
  public.participants,
  public.cars,
  public.heats,
  public.advancement_rules,
  public.advancement_rule_destinations,
  public.advancement_snapshots,
  public.advancement_selections,
  public.audit_events,
  public.security_events
to authenticated;

grant update (name, slug) on public.organisations to authenticated;
grant insert, delete on public.meets, public.brackets, public.participants, public.cars,
  public.heats, public.advancement_rules, public.advancement_rule_destinations to authenticated;
grant update (name, venue, meet_date, status, settings) on public.meets to authenticated;
grant update (name, stage, display_order, status, settings) on public.brackets to authenticated;
grant update (name, email, phone, notes) on public.participants to authenticated;
grant update (participant_id, car_number, name, active) on public.cars to authenticated;
grant update (round_number, heat_number, phase, lane_1_car_id, lane_2_car_id, lane_3_car_id) on public.heats to authenticated;
grant update (top_n, destination_capacity, status) on public.advancement_rules to authenticated;
grant update (destination_order) on public.advancement_rule_destinations to authenticated;

grant execute on function private_meet.is_org_member(uuid) to authenticated;
grant execute on function private_meet.has_org_role(uuid, text[]) to authenticated;
revoke execute on function private_meet.ensure_owner_remains() from public, anon, authenticated;

alter table public.organisations enable row level security;
alter table public.organisations force row level security;
alter table public.organisation_memberships enable row level security;
alter table public.organisation_memberships force row level security;
alter table public.organisation_invitations enable row level security;
alter table public.organisation_invitations force row level security;
alter table public.meets enable row level security;
alter table public.meets force row level security;
alter table public.brackets enable row level security;
alter table public.brackets force row level security;
alter table public.participants enable row level security;
alter table public.participants force row level security;
alter table public.cars enable row level security;
alter table public.cars force row level security;
alter table public.heats enable row level security;
alter table public.heats force row level security;
alter table public.advancement_rules enable row level security;
alter table public.advancement_rules force row level security;
alter table public.advancement_rule_destinations enable row level security;
alter table public.advancement_rule_destinations force row level security;
alter table public.advancement_snapshots enable row level security;
alter table public.advancement_snapshots force row level security;
alter table public.advancement_selections enable row level security;
alter table public.advancement_selections force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.security_events enable row level security;
alter table public.security_events force row level security;
alter table public.mutation_rate_limits enable row level security;
alter table public.mutation_rate_limits force row level security;

create policy "organisations_member_read"
on public.organisations for select
to authenticated
using (private_meet.is_org_member(id));

create policy "organisations_admin_update"
on public.organisations for update
to authenticated
using (private_meet.has_org_role(id, array['owner', 'admin']))
with check (private_meet.has_org_role(id, array['owner', 'admin']));

create policy "memberships_member_read"
on public.organisation_memberships for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "invitations_admin_read"
on public.organisation_invitations for select
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin']));

create policy "meets_member_read"
on public.meets for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "meets_organiser_insert"
on public.meets for insert
to authenticated
with check (
  private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser'])
  and created_by = auth.uid()
);

create policy "meets_organiser_update"
on public.meets for update
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']))
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "meets_organiser_delete"
on public.meets for delete
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "brackets_member_read"
on public.brackets for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "brackets_organiser_insert"
on public.brackets for insert
to authenticated
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "brackets_organiser_update"
on public.brackets for update
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']))
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "brackets_organiser_delete"
on public.brackets for delete
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "participants_member_read"
on public.participants for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "participants_organiser_insert"
on public.participants for insert
to authenticated
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "participants_organiser_update"
on public.participants for update
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']))
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "participants_organiser_delete"
on public.participants for delete
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "cars_member_read"
on public.cars for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "cars_organiser_insert"
on public.cars for insert
to authenticated
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "cars_organiser_update"
on public.cars for update
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']))
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "cars_organiser_delete"
on public.cars for delete
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "heats_member_read"
on public.heats for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "heats_organiser_insert"
on public.heats for insert
to authenticated
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "heats_organiser_update"
on public.heats for update
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']))
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "heats_organiser_delete"
on public.heats for delete
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "advancement_rules_member_read"
on public.advancement_rules for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "advancement_rules_organiser_insert"
on public.advancement_rules for insert
to authenticated
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "advancement_rules_organiser_update"
on public.advancement_rules for update
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']))
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "advancement_rules_organiser_delete"
on public.advancement_rules for delete
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "advancement_destinations_member_read"
on public.advancement_rule_destinations for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "advancement_destinations_organiser_insert"
on public.advancement_rule_destinations for insert
to authenticated
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "advancement_destinations_organiser_update"
on public.advancement_rule_destinations for update
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']))
with check (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "advancement_destinations_organiser_delete"
on public.advancement_rule_destinations for delete
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin', 'organiser']));

create policy "advancement_snapshots_member_read"
on public.advancement_snapshots for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "advancement_selections_member_read"
on public.advancement_selections for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "audit_events_member_read"
on public.audit_events for select
to authenticated
using (private_meet.is_org_member(organisation_id));

create policy "security_events_admin_read"
on public.security_events for select
to authenticated
using (private_meet.has_org_role(organisation_id, array['owner', 'admin']));

comment on schema private_meet is 'Unexposed fixed-search-path authorisation and transaction helpers for Meet Edition.';
