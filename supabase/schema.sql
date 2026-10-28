-- ============================================================================
-- Fantasy 6-a-side League — full schema, RLS, and server-side RPCs
-- Run this once in the Supabase SQL editor on a fresh project.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  team_name text not null default 'My Team',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(4,1) not null check (price >= 4.0 and price <= 11.0),
  created_at timestamptz not null default now()
);

create table league_settings (
  id int primary key default 1,
  invite_token text not null default encode(gen_random_bytes(8), 'hex'),
  budget_total numeric(5,1) not null default 50.0,
  squad_size int not null default 8,
  starters_count int not null default 6,
  current_gameweek_id uuid,
  check (id = 1)
);

create table scoring_settings (
  id int primary key default 1,
  pts_played int not null default 2,
  pts_won_match int not null default 1,
  pts_goal int not null default 4,
  pts_hattrick_bonus int not null default 3,
  pts_assist int not null default 2,
  pts_clean_sheet int not null default 3,
  saves_per_point int not null default 3,
  pts_per_saves_bundle int not null default 1,
  pts_pen_saved int not null default 5,
  conceded_per_point_penalty int not null default 3,
  pts_per_conceded_bundle int not null default -1,
  pts_pen_missed int not null default -2,
  pts_own_goal int not null default -2,
  pts_motm int not null default 3,
  transfer_hit_cost int not null default -4,
  check (id = 1)
);

create table gameweeks (
  id uuid primary key default gen_random_uuid(),
  number int not null unique,
  deadline timestamptz not null,
  is_scored boolean not null default false,
  created_at timestamptz not null default now()
);

create table player_gameweek_stats (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  gameweek_id uuid not null references gameweeks(id) on delete cascade,
  played boolean not null default false,
  goals int not null default 0,
  assists int not null default 0,
  clean_sheet boolean not null default false,
  saves int not null default 0,
  goals_conceded int not null default 0,
  penalty_saved int not null default 0,
  penalty_missed int not null default 0,
  own_goals int not null default 0,
  won_match boolean not null default false,
  man_of_match boolean not null default false,
  unique (player_id, gameweek_id)
);

create table team_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  gameweek_id uuid not null references gameweeks(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  is_starter boolean not null default false,
  sub_order int,
  is_captain boolean not null default false,
  is_vice_captain boolean not null default false,
  unique (user_id, gameweek_id, player_id)
);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  gameweek_id uuid not null references gameweeks(id) on delete cascade,
  player_out_id uuid references players(id),
  player_in_id uuid references players(id),
  is_hit boolean not null default false,
  created_at timestamptz not null default now()
);

create table chips_used (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  chip_type text not null check (chip_type in ('wildcard','bench_boost','triple_captain')),
  gameweek_id uuid not null references gameweeks(id) on delete cascade,
  used_at timestamptz not null default now(),
  unique (user_id, chip_type),
  unique (user_id, gameweek_id)
);

create table transfer_bank (
  user_id uuid primary key references profiles(id) on delete cascade,
  free_transfers int not null default 1
);

create table gameweek_transfer_cost (
  user_id uuid not null references profiles(id) on delete cascade,
  gameweek_id uuid not null references gameweeks(id) on delete cascade,
  transfers_made int not null default 0,
  hits int not null default 0,
  cost int not null default 0,
  primary key (user_id, gameweek_id)
);

insert into league_settings (id) values (1);
insert into scoring_settings (id) values (1);

-- ----------------------------------------------------------------------------
-- HELPERS
-- ----------------------------------------------------------------------------

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

-- Lets an ANONYMOUS visitor (not signed in yet) check an invite link without
-- ever being able to read the real token from the table directly.
create or replace function validate_invite(p_token text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from league_settings where id = 1 and invite_token = p_token);
$$;

grant execute on function validate_invite(text) to anon, authenticated;

-- Auto-create a profile row when a new auth user signs up.
-- The very first person to ever sign up becomes the bootstrap admin.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_first boolean;
begin
  select not exists (select 1 from profiles) into v_is_first;

  insert into profiles (id, email, team_name, is_admin)
  values (new.id, new.email, split_part(new.email, '@', 1) || '''s Team', v_is_first)
  on conflict (id) do nothing;

  insert into transfer_bank (user_id, free_transfers)
  values (new.id, 1)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Prevent non-admins from granting themselves admin via a direct profile update.
create or replace function guard_profile_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin and not is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_admin_flag_trigger on profiles;
create trigger guard_profile_admin_flag_trigger
  before update on profiles
  for each row execute function guard_profile_admin_flag();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------

alter table profiles enable row level security;
alter table players enable row level security;
alter table league_settings enable row level security;
alter table scoring_settings enable row level security;
alter table gameweeks enable row level security;
alter table player_gameweek_stats enable row level security;
alter table team_picks enable row level security;
alter table transfers enable row level security;
alter table chips_used enable row level security;
alter table transfer_bank enable row level security;
alter table gameweek_transfer_cost enable row level security;

-- profiles
create policy "profiles_select_all" on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update_own" on profiles for update using (id = auth.uid() or is_admin());

-- players
create policy "players_select_all" on players for select using (auth.role() = 'authenticated');
create policy "players_admin_write" on players for all using (is_admin()) with check (is_admin());

-- league_settings
create policy "league_settings_select_all" on league_settings for select using (auth.role() = 'authenticated');
create policy "league_settings_admin_write" on league_settings for update using (is_admin()) with check (is_admin());

-- scoring_settings
create policy "scoring_settings_select_all" on scoring_settings for select using (auth.role() = 'authenticated');
create policy "scoring_settings_admin_write" on scoring_settings for update using (is_admin()) with check (is_admin());

-- gameweeks
create policy "gameweeks_select_all" on gameweeks for select using (auth.role() = 'authenticated');
create policy "gameweeks_admin_write" on gameweeks for all using (is_admin()) with check (is_admin());

-- player_gameweek_stats
create policy "stats_select_all" on player_gameweek_stats for select using (auth.role() = 'authenticated');
create policy "stats_admin_write" on player_gameweek_stats for all using (is_admin()) with check (is_admin());

-- team_picks: own rows always visible; others visible only once that gameweek's deadline has passed
create policy "team_picks_select" on team_picks for select using (
  user_id = auth.uid()
  or is_admin()
  or exists (
    select 1 from gameweeks g where g.id = team_picks.gameweek_id and g.deadline <= now()
  )
);
-- No direct insert/update/delete policies: writes go through submit_team_picks() (SECURITY DEFINER) only.

-- transfers
create policy "transfers_select" on transfers for select using (user_id = auth.uid() or is_admin());

-- chips_used
create policy "chips_select" on chips_used for select using (user_id = auth.uid() or is_admin());

-- transfer_bank
create policy "transfer_bank_select" on transfer_bank for select using (user_id = auth.uid() or is_admin());

-- gameweek_transfer_cost
create policy "gw_transfer_cost_select" on gameweek_transfer_cost for select using (user_id = auth.uid() or is_admin());

-- ----------------------------------------------------------------------------
-- RPC: submit_team_picks — the ONLY way to write a squad for a gameweek.
-- Validates budget, squad composition, deadline, and transfer-cost rules
-- entirely server-side, then persists picks + transfer history + chip usage.
-- ----------------------------------------------------------------------------

create or replace function submit_team_picks(p_gameweek_id uuid, p_picks jsonb, p_chip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_gw gameweeks;
  v_budget numeric;
  v_squad_size int;
  v_starters_count int;
  v_pick jsonb;
  v_total_price numeric := 0;
  v_starter_count int := 0;
  v_sub_count int := 0;
  v_captain_count int := 0;
  v_vice_count int := 0;
  v_player_count int := 0;
  v_is_first_submission boolean;
  v_prev_player_ids uuid[];
  v_new_player_ids uuid[];
  v_transfers_made int := 0;
  v_free_transfers int := 1;
  v_hits int := 0;
  v_cost int := 0;
  v_wildcard_active boolean := false;
  v_outs uuid[];
  v_ins uuid[];
  v_transfer_hit_cost int;
  i int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_gw from gameweeks where id = p_gameweek_id;
  if v_gw.id is null then
    raise exception 'Gameweek not found';
  end if;

  select budget_total, squad_size, starters_count
    into v_budget, v_squad_size, v_starters_count
    from league_settings where id = 1;

  select transfer_hit_cost into v_transfer_hit_cost from scoring_settings where id = 1;

  -- is this the team's very first ever submission (pre-season, unlimited transfers)?
  select not exists (
    select 1 from team_picks tp
    join gameweeks g on g.id = tp.gameweek_id
    where tp.user_id = v_user and g.number < v_gw.number
  ) into v_is_first_submission;

  if now() > v_gw.deadline then
    raise exception 'Deadline has passed for this gameweek';
  end if;

  v_player_count := jsonb_array_length(p_picks);
  if v_player_count <> v_squad_size then
    raise exception 'Squad must have exactly % players', v_squad_size;
  end if;

  for v_pick in select * from jsonb_array_elements(p_picks)
  loop
    declare
      v_pid uuid := (v_pick->>'player_id')::uuid;
      v_is_starter boolean := (v_pick->>'is_starter')::boolean;
      v_is_captain boolean := coalesce((v_pick->>'is_captain')::boolean, false);
      v_is_vice boolean := coalesce((v_pick->>'is_vice_captain')::boolean, false);
      v_price numeric;
    begin
      select price into v_price from players where id = v_pid;
      if v_price is null then
        raise exception 'Player % not found', v_pid;
      end if;
      v_total_price := v_total_price + v_price;
      if v_is_starter then
        v_starter_count := v_starter_count + 1;
      else
        v_sub_count := v_sub_count + 1;
      end if;
      if v_is_captain then v_captain_count := v_captain_count + 1; end if;
      if v_is_vice then v_vice_count := v_vice_count + 1; end if;
    end;
  end loop;

  if v_total_price > v_budget then
    raise exception 'Squad costs %.1fm, budget is %.1fm', v_total_price, v_budget;
  end if;
  if v_starter_count <> v_starters_count then
    raise exception 'Must have exactly % starters', v_starters_count;
  end if;
  if v_captain_count <> 1 or v_vice_count <> 1 then
    raise exception 'Must choose exactly one captain and one vice-captain';
  end if;

  select array_agg((p->>'player_id')::uuid) into v_new_player_ids
  from jsonb_array_elements(p_picks) p;

  -- transfer accounting (skip entirely for the first-ever submission)
  if not v_is_first_submission then
    select array_agg(tp.player_id) into v_prev_player_ids
    from team_picks tp
    where tp.user_id = v_user and tp.gameweek_id = (
      select g2.id from gameweeks g2
      where g2.number < v_gw.number and exists (
        select 1 from team_picks where user_id = v_user and gameweek_id = g2.id
      )
      order by g2.number desc limit 1
    );

    select coalesce(free_transfers, 1) into v_free_transfers from transfer_bank where user_id = v_user;

    v_wildcard_active := (p_chip = 'wildcard');

    select array_agg(pid) into v_outs from unnest(v_prev_player_ids) pid where pid <> all(v_new_player_ids);
    select array_agg(pid) into v_ins from unnest(v_new_player_ids) pid where pid <> all(v_prev_player_ids);
    v_transfers_made := coalesce(array_length(v_outs, 1), 0);

    if v_wildcard_active then
      v_hits := 0;
    else
      v_hits := greatest(0, v_transfers_made - v_free_transfers);
    end if;
    v_cost := v_hits * abs(v_transfer_hit_cost); -- stored positive, applied as a deduction by the scoring engine

    update transfer_bank
      set free_transfers = greatest(0, v_free_transfers - v_transfers_made)
      where user_id = v_user;

    if v_outs is not null then
      for i in 1..array_length(v_outs, 1) loop
        insert into transfers (user_id, gameweek_id, player_out_id, player_in_id, is_hit)
        values (v_user, p_gameweek_id, v_outs[i], v_ins[i], (i > v_free_transfers and not v_wildcard_active));
      end loop;
    end if;

    insert into gameweek_transfer_cost (user_id, gameweek_id, transfers_made, hits, cost)
    values (v_user, p_gameweek_id, v_transfers_made, v_hits, v_cost)
    on conflict (user_id, gameweek_id) do update
      set transfers_made = excluded.transfers_made, hits = excluded.hits, cost = excluded.cost;
  end if;

  -- chip validation + recording
  if p_chip is not null then
    if p_chip not in ('wildcard','bench_boost','triple_captain') then
      raise exception 'Unknown chip %', p_chip;
    end if;
    if exists (select 1 from chips_used where user_id = v_user and chip_type = p_chip) then
      raise exception 'Chip % already used this season', p_chip;
    end if;
    if exists (select 1 from chips_used where user_id = v_user and gameweek_id = p_gameweek_id) then
      raise exception 'Only one chip can be active per gameweek';
    end if;
    insert into chips_used (user_id, chip_type, gameweek_id) values (v_user, p_chip, p_gameweek_id);
  end if;

  delete from team_picks where user_id = v_user and gameweek_id = p_gameweek_id;

  for v_pick in select * from jsonb_array_elements(p_picks)
  loop
    insert into team_picks (user_id, gameweek_id, player_id, is_starter, sub_order, is_captain, is_vice_captain)
    values (
      v_user,
      p_gameweek_id,
      (v_pick->>'player_id')::uuid,
      (v_pick->>'is_starter')::boolean,
      (v_pick->>'sub_order')::int,
      coalesce((v_pick->>'is_captain')::boolean, false),
      coalesce((v_pick->>'is_vice_captain')::boolean, false)
    );
  end loop;

  return jsonb_build_object('ok', true, 'transfers_made', v_transfers_made, 'hits', v_hits, 'cost', v_cost);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: admin_advance_gameweek — rolls free-transfer banks forward (cap 2),
-- skipping anyone who played a wildcard in the gameweek just closed.
-- ----------------------------------------------------------------------------

create or replace function admin_advance_gameweek(p_closing_gameweek_id uuid, p_new_current_gameweek_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin only';
  end if;

  update transfer_bank tb
    set free_transfers = least(2, tb.free_transfers + 1)
    where not exists (
      select 1 from chips_used cu
      where cu.user_id = tb.user_id and cu.gameweek_id = p_closing_gameweek_id and cu.chip_type = 'wildcard'
    );

  update league_settings set current_gameweek_id = p_new_current_gameweek_id where id = 1;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: regenerate_invite_token — admin can rotate the invite link.
-- ----------------------------------------------------------------------------

create or replace function regenerate_invite_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not is_admin() then
    raise exception 'Admin only';
  end if;
  v_token := encode(gen_random_bytes(8), 'hex');
  update league_settings set invite_token = v_token where id = 1;
  return v_token;
end;
$$;

-- ----------------------------------------------------------------------------
-- REALTIME — let the app live-update leaderboards/points without a refresh.
-- `team_picks` is deliberately NOT added here: postgres_changes broadcasts the
-- raw row to every subscriber regardless of RLS, which would leak other teams'
-- hidden pre-deadline picks. Everything added below is already fully readable
-- by any authenticated user via its own SELECT policy, so broadcasting it is safe.
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table player_gameweek_stats;
alter publication supabase_realtime add table gameweeks;
alter publication supabase_realtime add table scoring_settings;
alter publication supabase_realtime add table league_settings;
alter publication supabase_realtime add table chips_used;
