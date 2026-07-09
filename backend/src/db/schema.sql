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

create index if not exists idx_tournament_results_league on tournament_results(league_id);
create index if not exists idx_tournament_results_member on tournament_results(member_id);

create index if not exists idx_members_league on members(league_id);
create index if not exists idx_tournament_players_tournament on tournament_players(tournament_id);
create index if not exists idx_rounds_tournament on rounds(tournament_id);
create index if not exists idx_picks_round_member on picks(round_id, member_id);
create index if not exists idx_scores_round on player_round_scores(round_id);
