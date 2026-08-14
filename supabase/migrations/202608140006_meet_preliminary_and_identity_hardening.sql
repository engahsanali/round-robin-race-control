-- REVIEW HARDENING V6

create or replace function public.list_organisation_members(target_organisation_id uuid)
returns table (user_id uuid, role text, display_name text, email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private_meet.is_org_member(target_organisation_id) then
    raise exception using message = 'MEET_FORBIDDEN';
  end if;
  return query
  select membership.user_id, membership.role,
    case
      when nullif(btrim(identity.raw_user_meta_data->>'display_name'), '') is not null
        and char_length(btrim(identity.raw_user_meta_data->>'display_name')) between 1 and 80
        and btrim(identity.raw_user_meta_data->>'display_name') !~ '[[:cntrl:]<>@]'
      then btrim(identity.raw_user_meta_data->>'display_name')
      else 'Member ' || left(replace(membership.user_id::text, '-', ''), 8)
    end as display_name,
    case when private_meet.has_org_role(target_organisation_id, array['owner', 'admin'])
      then identity.email else null end as email
  from public.organisation_memberships membership
  join auth.users identity on identity.id = membership.user_id
  where membership.organisation_id = target_organisation_id and membership.status = 'active'
  order by membership.role, membership.user_id;
end;
$$;

create or replace function private_meet.advancement_ranking(target_source_bracket_id uuid)
returns table (
  source_car_id uuid,
  competitive_rank integer,
  group_size integer,
  display_order integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  ranking_mode text;
  tie_break_order jsonb;
  tie_break_key text;
  official_results integer;
begin
  select coalesce(bracket.settings->>'rankingMode', 'competition'),
    coalesce(bracket.settings->'tieBreakOrder', '["totalWins"]'::jsonb)
  into ranking_mode, tie_break_order
  from public.brackets bracket where bracket.id = target_source_bracket_id;
  if not found or ranking_mode not in ('competition', 'dense', 'ordinal')
     or jsonb_typeof(tie_break_order) <> 'array' then
    raise exception using message = 'MEET_INVALID_RANKING_CONFIG';
  end if;

  create temporary table if not exists pg_temp.meet_advancement_rank_work (
    car_id uuid primary key,
    group_no integer not null,
    completed_heats integer not null,
    sort_metric numeric
  ) on commit drop;
  truncate table pg_temp.meet_advancement_rank_work;
  insert into pg_temp.meet_advancement_rank_work (car_id, group_no, completed_heats)
  select car.id, 1,
    count(heat.id) filter (where heat.phase = 'preliminary' and heat.status = 'confirmed'
      and car.id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))::integer
  from public.cars car
  left join public.heats heat on heat.bracket_id = car.bracket_id and heat.phase = 'preliminary'
  where car.bracket_id = target_source_bracket_id and car.active
  group by car.id;
  select coalesce(sum(work.completed_heats), 0) into official_results from pg_temp.meet_advancement_rank_work work;
  if official_results = 0 then
    return query select work.car_id, null::integer, count(*) over ()::integer,
      row_number() over (order by work.car_id)::integer
    from pg_temp.meet_advancement_rank_work work order by work.car_id;
    return;
  end if;

  for tie_break_key in select value from jsonb_array_elements_text(tie_break_order)
  loop
    if tie_break_key not in ('totalWins', 'headToHead', 'matchesWon', 'averageTime', 'bestTime', 'laneBalance', 'carNumber', 'playoff') then
      raise exception using message = 'MEET_INVALID_RANKING_CONFIG';
    end if;
    with metric as (
      select work.car_id,
        case tie_break_key
          when 'totalWins' then -(select count(*)::numeric from public.heats heat
            where heat.bracket_id = target_source_bracket_id and heat.phase = 'preliminary'
              and heat.status = 'confirmed' and heat.winner_car_id = work.car_id)
          when 'headToHead' then -(select coalesce(sum(case when heat.winner_car_id = work.car_id then
              (select count(*)
               from unnest(array[heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id]) as lanes(opponent_id)
               join pg_temp.meet_advancement_rank_work opponent on opponent.car_id = lanes.opponent_id
                 and opponent.group_no = work.group_no
               where lanes.opponent_id is distinct from work.car_id) else 0 end), 0)::numeric
            from public.heats heat where heat.bracket_id = target_source_bracket_id
              and heat.phase = 'preliminary' and heat.status = 'confirmed'
              and work.car_id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
          when 'matchesWon' then -(select count(distinct heat.round_number)::numeric from public.heats heat
            where heat.bracket_id = target_source_bracket_id and heat.phase = 'preliminary'
              and heat.status = 'confirmed' and heat.winner_car_id = work.car_id)
          when 'averageTime' then (select avg(case when heat.lane_1_car_id = work.car_id then heat.lane_1_time
              when heat.lane_2_car_id = work.car_id then heat.lane_2_time else heat.lane_3_time end)
            from public.heats heat where heat.bracket_id = target_source_bracket_id
              and heat.phase = 'preliminary' and heat.status = 'confirmed'
              and work.car_id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
          when 'bestTime' then (select min(case when heat.lane_1_car_id = work.car_id then heat.lane_1_time
              when heat.lane_2_car_id = work.car_id then heat.lane_2_time else heat.lane_3_time end)
            from public.heats heat where heat.bracket_id = target_source_bracket_id
              and heat.phase = 'preliminary' and heat.status = 'confirmed'
              and work.car_id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
          when 'laneBalance' then (select greatest(lane_1_count, lane_2_count, lane_3_count)
              - least(lane_1_count, lane_2_count, lane_3_count)
            from (select count(*) filter (where heat.lane_1_car_id = work.car_id)::numeric lane_1_count,
              count(*) filter (where heat.lane_2_car_id = work.car_id)::numeric lane_2_count,
              count(*) filter (where heat.lane_3_car_id = work.car_id)::numeric lane_3_count
              from public.heats heat where heat.bracket_id = target_source_bracket_id
                and heat.phase = 'preliminary' and heat.status = 'confirmed') lane_counts)
          when 'carNumber' then (select car.car_number::numeric from public.cars car where car.id = work.car_id)
          else null::numeric
        end as sort_metric
      from pg_temp.meet_advancement_rank_work work
    )
    update pg_temp.meet_advancement_rank_work work set sort_metric = metric.sort_metric
    from metric where metric.car_id = work.car_id;
    with next_group as (
      select work.car_id,
        dense_rank() over (order by work.group_no, work.sort_metric nulls last)::integer as group_no
      from pg_temp.meet_advancement_rank_work work
    )
    update pg_temp.meet_advancement_rank_work work set group_no = next_group.group_no
    from next_group where next_group.car_id = work.car_id;
  end loop;

  if ranking_mode = 'ordinal' and exists (
    select 1 from pg_temp.meet_advancement_rank_work work group by work.group_no having count(*) > 1
  ) then raise exception using message = 'MEET_ORDINAL_TIE_UNRESOLVED'; end if;

  return query
  with ordered as (
    select work.car_id, work.group_no,
      count(*) over (partition by work.group_no)::integer as tied_count,
      row_number() over (order by work.group_no, work.car_id)::integer as position
    from pg_temp.meet_advancement_rank_work work
  )
  select ordered.car_id,
    case ranking_mode when 'dense' then dense_rank() over (order by ordered.group_no)::integer
      when 'ordinal' then ordered.position
      else min(ordered.position) over (partition by ordered.group_no)::integer end,
    ordered.tied_count, ordered.position
  from ordered order by ordered.group_no, ordered.car_id;
end;
$$;

create or replace function private_meet.preliminary_source_is_complete(target_source_bracket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.heats heat
      where heat.bracket_id = target_source_bracket_id and heat.phase = 'preliminary'
    )
    and not exists (
      select 1 from public.heats heat
      where heat.bracket_id = target_source_bracket_id and heat.phase = 'preliminary'
        and heat.status <> 'confirmed'
    )
    and not exists (
      select 1 from public.cars source_car
      where source_car.bracket_id = target_source_bracket_id and source_car.active
        and not exists (
          select 1 from public.heats heat
          where heat.bracket_id = target_source_bracket_id and heat.phase = 'preliminary'
            and source_car.id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id)
        )
    );
$$;

do $migration$
declare
  definition text;
  patched_definition text;
  previous_check constant text := $old$
  select exists (select 1 from public.heats heat where heat.bracket_id = rule.source_bracket_id)
    and not exists (select 1 from public.heats heat where heat.bracket_id = rule.source_bracket_id and heat.status <> 'confirmed')
    and not exists (
      select 1 from public.cars source_car
      where source_car.bracket_id = rule.source_bracket_id and source_car.active
        and not exists (select 1 from public.heats heat where heat.bracket_id = rule.source_bracket_id
          and source_car.id in (heat.lane_1_car_id, heat.lane_2_car_id, heat.lane_3_car_id))
    )
  into source_is_complete;
$old$;
  preliminary_check constant text := $new$
  select private_meet.preliminary_source_is_complete(rule.source_bracket_id)
  into source_is_complete;
$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'private_meet.write_advancement(uuid,integer,integer,jsonb,text,uuid,boolean)'::regprocedure
  ) into definition;
  patched_definition := replace(definition, previous_check, preliminary_check);
  if patched_definition = definition then
    raise exception using message = 'MEET_V6_ADVANCEMENT_PATCH_NOT_APPLIED';
  end if;
  execute patched_definition;
end;
$migration$;

revoke execute on function private_meet.advancement_ranking(uuid) from public, anon, authenticated;
revoke execute on function private_meet.preliminary_source_is_complete(uuid) from public, anon, authenticated;
revoke execute on function private_meet.write_advancement(uuid, integer, integer, jsonb, text, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.list_organisation_members(uuid) from public, anon;
grant execute on function public.list_organisation_members(uuid) to authenticated;

comment on function private_meet.advancement_ranking(uuid) is
  'Server-authoritative Meet domain ranking over preliminary-phase results only.';
comment on function public.list_organisation_members(uuid) is
  'Lists active same-organisation identities using safe explicit metadata or a neutral stable-ID label; email is owner/admin only.';
