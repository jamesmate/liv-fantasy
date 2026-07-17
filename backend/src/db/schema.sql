-- LIV Fantasy schema
-- Postgres (Supabase free tier)

-- Required for gen_random_uuid(). Supabase enables this by default,
-- but declaring it explicitly keeps this schema portable to any
-- Postgres host.
create extension if not exists pgcrypto;

-- A "league" is your private group, created with a join code.
create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

-- A colleague who joined a league. They pick their team name here.
-- Identified by a long-lived session token, no password.
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  display_name text not null,
  team_name text not null,
  session_token text not null unique,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (league_id, team_name)
);

-- Safe to re-run: adds is_owner to a pre-existing members table that
-- predates this column (no-op if it already exists).
alter table members add column if not exists is_owner boolean not null default false;

-- Optional passcode a member sets themselves, letting them log back
-- into this exact team from any device (join code + team name +
-- passcode), instead of being stuck to whichever device holds the
-- original session token. Null until the member sets one.
alter table members add column if not exists passcode_hash text;

-- Why a player was marked is_active = false - "withdrawn" or
-- "missed_cut" - so the pick UI can show the right badge instead of
-- always saying "Withdrawn" regardless of the actual reason.
alter table tournament_players add column if not exists inactive_reason text;

-- When this tournament's scores were last pulled from ESPN. Used to
-- throttle the "sync on page load" behaviour - see maybeSync() in
-- services/scoreSync.ts - so a burst of page loads from several
-- members within a few seconds of each other triggers one ESPN call,
-- not one per request.
alter table tournaments add column if not exists last_synced_at timestamptz;

-- Persistent, cross-tournament stats per member - deliberately NOT
-- recomputed live on every page load. Updated once, at the moment a
-- tournament is finalized (status -> completed), by
-- services/careerStats.ts. Running averages are stored as a
-- sum+count pair rather than a precomputed average, so each new
-- tournament can just add to the sum/count rather than needing to
-- know every past tournament's individual score.
create table if not exists member_career_stats (
  member_id uuid primary key references members(id) on delete cascade,
  tournaments_with_hot_hand int not null default 0,
  hot_hand_score_sum int not null default 0,
  best_hot_hand_score int,
  best_hot_hand_tournament_name text,
  best_round_score int,
  best_round_tournament_name text,
  best_round_number int,
  favourite_player_name text,
  favourite_player_use_count int,
  updated_at timestamptz not null default now()
);

-- Upcoming/past events preview for a league - deliberately separate
-- from `tournaments` (which represents an event actually wired up for
-- picking, with an ESPN event id, player pool, rounds, etc). This
-- table is just a calendar: "what's coming up", filled in manually by
-- the owner ahead of time, independent of whether that event has
-- actually been seeded into the app yet. `tour` is a plain text field
-- (not a DB enum) so new tours can be added without a migration -
-- the frontend is what constrains it to a known set of options via a
-- dropdown, and is also what a future per-tour points system would
-- group by.
create table if not exists schedule_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  name text not null,
  tour text not null, -- 'LIV' | 'PGA_TOUR' | 'DP_WORLD' | 'OTHER'
  start_date date not null,
  end_date date,
  espn_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_schedule_events_league on schedule_events(league_id, start_date);

-- The old model stored a single session_token directly on the member
-- row, which meant logging in on a second device silently invalidated
-- the first one (only one token could ever be valid at once). This
-- table lets a member have multiple simultaneously-valid sessions -
-- laptop, phone, etc - without kicking each other out.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_sessions_token on sessions(token);

-- Carry forward everyone's CURRENTLY valid token into the new table,
-- so this migration doesn't force-logout the whole league. Safe to
-- re-run - "on conflict do nothing" skips tokens already carried over.
insert into sessions (member_id, token)
select id, session_token from members
where session_token is not null
on conflict (token) do nothing;

-- session_token on members is no longer written to or read from for
-- auth (sessions table above replaces it) - loosened rather than
-- dropped, so this migration stays additive-only and reversible.
alter table members alter column session_token drop not null;

-- A LIV Golf event, e.g. "LIV Golf Andalucia 2026".
-- espn_event_id is the identifier used to query the ESPN adapter.
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  name text not null,
  espn_event_id text,
  par int not null default 72,
  total_rounds int not null default 4,
  status text not null default 'upcoming', -- upcoming | live | completed
  starts_at date,
  created_at timestamptz not null default now()
);

-- The pool of real golfers eligible to be picked for a tournament.
-- Populated by the ESPN adapter, manually editable by the league owner.
create table if not exists tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  espn_player_id text,
  full_name text not null,
  pro_team_name text, -- LIV's real pro team (e.g. "4Aces GC") - informational only
  country_code text, -- e.g. "USA", "England" - used to show a flag next to the player's name
  is_active boolean not null default true, -- false if withdrawn before tournament start
  created_at timestamptz not null default now(),
  unique (tournament_id, espn_player_id)
);

-- Safe to re-run: adds country_code to a pre-existing tournament_players
-- table that predates this column.
alter table tournament_players add column if not exists country_code text;

-- One row per round of a tournament (4 rounds per LIV event).
create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_number int not null check (round_number between 1 and 4),
  status text not null default 'upcoming', -- upcoming | in_progress | completed
  locks_at timestamptz, -- picks can't change after this (e.g. tee time)
  unique (tournament_id, round_number)
);

-- A member's 4 player picks for a given round.
-- The "no repeat within tournament" rule is enforced at the application layer
-- (checked against all of this member's picks across earlier rounds in the
-- same tournament before insert), not purely via a DB constraint, because
-- swapped-out picks should not count against that history.
create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  tournament_player_id uuid not null references tournament_players(id) on delete cascade,
  is_swap boolean not null default false, -- true if this replaced a withdrawn pick
  swapped_from_id uuid references tournament_players(id), -- original pick, if swapped
  has_double_play boolean not null default false, -- this pick carries the member's once-per-tournament Double Play token
  created_at timestamptz not null default now(),
  unique (round_id, member_id, tournament_player_id)
);

-- Safe to re-run: adds has_double_play to a pre-existing picks table
-- that predates this column (no-op if it already exists). Placed here,
-- AFTER the picks table is created above, since on a brand-new
-- database this statement would otherwise fail with
-- "relation picks does not exist" - it only makes sense as a no-op
-- guard for databases that already had picks from before this column
-- was added.
alter table picks add column if not exists has_double_play boolean not null default false;

-- Safe to re-run: ensures tournament_player_id cascades on delete,
-- for databases created before "on delete cascade" was added to the
-- table definition above. Without this, deleting a player that has
-- any picks against them fails with a foreign key violation instead
-- of cleanly cascading.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'picks_tournament_player_id_fkey'
      and table_name = 'picks'
  ) then
    alter table picks drop constraint picks_tournament_player_id_fkey;
  end if;
  alter table picks
    add constraint picks_tournament_player_id_fkey
    foreign key (tournament_player_id) references tournament_players(id) on delete cascade;
end $$;

-- Enforces the "one Double Play token per member per TOURNAMENT" rule
-- (not per round) - at most one pick across all of a member's rounds
-- in a tournament may have has_double_play = true. Implemented as a
-- partial unique index rather than a simple unique constraint, since
-- it only needs to be unique among rows where the flag is actually set.
-- Scoped per (member, tournament) via a join is awkward in a plain
-- index, so this is enforced in services/picks.ts at the application
-- layer instead - see assertSingleDoublePlayToken().

-- Cap of 4 picks per member per round enforced at the application layer
-- (Postgres can't easily express "count of rows per group <= 4" as a
-- table constraint without a trigger; a trigger is added in 002_triggers.sql).

-- Live/raw scores per player per round, scraped from ESPN.
-- score_to_par follows golf convention: negative = under par (good).
create table if not exists player_round_scores (
  id uuid primary key default gen_random_uuid(),
  tournament_player_id uuid not null references tournament_players(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  score_to_par int, -- null until the player has started/has a score
  thru int, -- holes completed this round, 0-18
  status text not null default 'not_started', -- not_started | in_progress | completed | withdrawn
  updated_at timestamptz not null default now(),
  unique (tournament_player_id, round_id)
);

-- Added after player_round_scores already existed in production -
-- CREATE TABLE IF NOT EXISTS is a no-op against an existing table, so
-- this column needs its own ALTER TABLE (same reason every other
-- post-launch column addition in this file uses this pattern instead
-- of being added inline above).
alter table player_round_scores add column if not exists tee_time timestamptz;

-- Leaderboard position at the start and current point of THIS round
-- specifically - used for the Positions Gained/Lost bonus categories.
-- Sourced from the same main leaderboard sync that's already working
-- reliably (see espnGolf.ts), NOT the competitorsummary endpoint,
-- which ESPN's CDN was found to serve stripped/empty responses to
-- when called from this server (confirmed via side-by-side testing -
-- identical requests worked fine from a normal machine but came back
-- empty from here, even with full browser-style headers added).
alter table player_round_scores add column if not exists start_position int;
alter table player_round_scores add column if not exists current_position int;

-- Cached last-known-good snapshot of the raw ESPN response, per tournament.
-- Used as a fallback if ESPN's endpoint is unreachable when a refresh runs.
create table if not exists espn_snapshot_cache (
  tournament_id uuid primary key references tournaments(id) on delete cascade,
  raw_payload jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Permanent record of a team's final result in a completed tournament.
-- This is the historical ledger - it survives even though picks/scores
-- are tournament-scoped, because team identity (league_id + team_name)
-- persists across tournaments while a member's picks do not.
--
-- One row is written per member when a tournament is marked completed
-- (see services/tournamentResults.ts). is_win is auto-calculated as
-- "lowest total_to_par in this tournament" but can be overridden by the
-- league owner (e.g. to correct a tie-break or scoring dispute).
create table if not exists tournament_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  team_name text not null, -- snapshot at time of completion, in case a member later renames
  total_to_par int not null,
  placement int not null, -- 1 = best score in that tournament
  is_win boolean not null default false,
  win_overridden_by_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tournament_id, member_id)
);

-- Points earned for this specific tournament, using a field-size-
-- scaled formula rather than a fixed lookup table (see
-- services/tournamentResults.ts for the actual formula and reasoning)
-- - a fixed table like "1st=500, 2nd=300..." breaks down as the
-- league's team count changes over time, either running out of
-- entries or giving the same reward for beating 5 teams as beating 9.
alter table tournament_results add column if not exists points int not null default 0;

create index if not exists idx_tournament_results_league on tournament_results(league_id);
create index if not exists idx_tournament_results_member on tournament_results(member_id);

create index if not exists idx_members_league on members(league_id);
create index if not exists idx_tournament_players_tournament on tournament_players(tournament_id);
create index if not exists idx_rounds_tournament on rounds(tournament_id);
create index if not exists idx_picks_round_member on picks(round_id, member_id);
create index if not exists idx_scores_round on player_round_scores(round_id);

-- ============================================================
-- 5th "Bonus Pick" - a daily-category side bet, separate from the
-- normal 4 no-repeat picks. See services/bonusPickSync.ts for the
-- live scoring logic. Every round gets ONE randomly assigned
-- category (same for the whole league, picked once, not per-member)
-- from a fixed set of live-ticking categories - see BONUS_CATEGORIES
-- in bonusPickSync.ts for the canonical list, kept in application
-- code rather than a DB enum so the category set can evolve without
-- a migration.
-- ============================================================

alter table rounds add column if not exists bonus_category text;

-- Which ESPN "league" slug (pga | liv | eur | ...) to use when
-- fetching the per-athlete competitorsummary endpoint for bonus pick
-- scoring - the main leaderboard sync uses league=all and doesn't
-- need this, but the competitorsummary endpoint requires a specific
-- league in its URL path. Defaults to 'pga' (confirmed working for
-- PGA/DP World co-sanctioned events) - override per-tournament if a
-- pure LIV event turns out to need a different slug.
alter table tournaments add column if not exists espn_league_slug text not null default 'pga';

-- One bonus pick per member per round - unlike `picks`, there is
-- deliberately NO no-repeat constraint here and no is_swap concept;
-- any player in the pool is fair game every round regardless of
-- whether they (or another team) already used them as a normal pick.
create table if not exists bonus_picks (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  tournament_player_id uuid not null references tournament_players(id) on delete cascade,
  points int not null default 0,
  -- Small breakdown of how the points were earned, for showing "2
  -- birdies, 1 bogey" style detail in the UI rather than just a bare
  -- number - purely informational, not used in the points math itself
  -- (which is recomputed fresh from ESPN data on every sync).
  breakdown jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (round_id, member_id)
);
create index if not exists idx_bonus_picks_round on bonus_picks(round_id);

-- Set when the owner manually corrects a bonus pick's points (e.g.
-- via the /admin/bonus-picks/:id/set-points fallback workflow, needed
-- while the hole-based categories can't be reliably auto-synced from
-- this server - see bonusPickSync.ts). The automated sync MUST skip
-- any row with this flag set, or it'll silently overwrite the manual
-- fix back to 0/stale on its next run - which is exactly what
-- happened before this flag existed.
alter table bonus_picks add column if not exists manually_overridden boolean not null default false;
