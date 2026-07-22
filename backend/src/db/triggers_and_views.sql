-- Enforce: a member may have at most 4 picks per round.
create or replace function check_max_picks_per_round()
returns trigger as $$
declare
  pick_count int;
begin
  select count(*) into pick_count
  from picks
  where round_id = new.round_id
    and member_id = new.member_id;

  if pick_count >= 4 then
    raise exception 'Member already has 4 picks for this round';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_max_picks_per_round on picks;
create trigger trg_max_picks_per_round
  before insert on picks
  for each row
  execute function check_max_picks_per_round();

-- Applies the Double Play scoring rule to a single round score:
--   negative (under par, good)  -> doubled        e.g. -3 becomes -6
--   positive (over par, bad)    -> halved, ceiling e.g. +7 becomes +4
--   zero (par)                  -> unchanged
-- Ceiling on the positive half is what makes +4 -> +2 (exact) and
-- +7 -> +4 (3.5 rounded up) - the player-favorable rounding direction.
-- Double Play always multiplies by 2, in both directions - a good
-- round (-2) becomes -4, a bad round (+2) becomes +4. This used to
-- soften a bad round instead (halving the penalty rather than
-- doubling it), which was a deliberate earlier design choice, but has
-- been changed to a straightforward flat x2 either way per updated
-- rules.
create or replace function apply_double_play(score int)
returns int as $$
begin
  return score * 2;
end;
$$ language plpgsql immutable;

-- Convenience view: each pick joined with its current round score.
-- Exposes both the raw score_to_par (what the golfer actually shot)
-- and effective_score_to_par (after Double Play doubling/halving is
-- applied, if this pick carries the token) - team_round_totals below
-- sums the effective column, so the token actually affects standings.
create or replace view pick_scores as
select
  p.id as pick_id,
  p.round_id,
  p.member_id,
  p.tournament_player_id,
  p.is_swap,
  p.has_double_play,
  tp.full_name as player_name,
  r.round_number,
  r.tournament_id,
  coalesce(s.score_to_par, 0) as score_to_par,
  case
    when p.has_double_play then apply_double_play(coalesce(s.score_to_par, 0))
    else coalesce(s.score_to_par, 0)
  end as effective_score_to_par,
  s.status as player_status,
  tp.pro_team_name,
  tp.country_code,
  -- thru/tee_time appended at the END of the column list deliberately -
  -- Postgres's CREATE OR REPLACE VIEW only allows adding new columns
  -- at the end; inserting them earlier shifts every column after them
  -- and Postgres reads that as renaming those columns, which it
  -- refuses ("cannot change name of view column X to Y").
  s.thru,
  s.tee_time
from picks p
join tournament_players tp on tp.id = p.tournament_player_id
join rounds r on r.id = p.round_id
left join player_round_scores s
  on s.tournament_player_id = p.tournament_player_id
  and s.round_id = p.round_id;

-- Convenience view: team total per round (sum of 4 picks' EFFECTIVE
-- scores, i.e. with Double Play already applied).
-- Every round gets a row for every member of the league, not just
-- ones who actually made picks - the old version of this view only
-- had a row when pick_scores had matching data, which meant a team
-- that made ZERO picks for a round simply didn't appear at all. That
-- silently read as "no penalty" downstream (their tournament total
-- just skipped that round entirely), which was actually BETTER than
-- picking and having a bad round - a real incentive problem where
-- doing nothing could beat trying and doing poorly.
--
-- Now: if a round has locked (its locks_at has passed) and a member
-- made no picks at all, their round_total is set to that round's
-- FIELD AVERAGE + 5 - contextual (a brutal weather day penalizes
-- more than an easy scoring day, same as everything else in this app
-- that compares against field average) rather than an arbitrary fixed
-- number, and always clearly worse than doing nothing used to be.
-- Rounds that haven't locked yet still show null (no penalty - they
-- still have time to pick).
create or replace view team_round_totals as
select
  r.id as round_id,
  m.id as member_id,
  t.id as tournament_id,
  r.round_number,
  coalesce(
    ps.round_total,
    case
      when r.locks_at is not null and r.locks_at < now() then (
        select (coalesce(round(avg(prs.score_to_par)), 0) + 5)::int
          from player_round_scores prs
         where prs.round_id = r.id and prs.score_to_par is not null
      )
      else null
    end
  ) as round_total,
  coalesce(ps.pick_count, 0) as pick_count,
  coalesce(ps.round_fully_scored, false) as round_fully_scored,
  coalesce(ps.used_double_play_this_round, false) as used_double_play_this_round
from rounds r
join tournaments t on t.id = r.tournament_id
join members m on m.league_id = t.league_id
left join (
  select round_id, member_id,
         sum(effective_score_to_par) as round_total,
         count(*) as pick_count,
         -- A player who missed the cut or withdrew is DONE playing
         -- this round just as much as one who completed it - they
         -- won't score any further. Only checking for literal
         -- 'completed' meant a team with 3 finished picks and 1 who
         -- missed the cut never showed as fully scored, even though
         -- nothing was left to happen for any of their 4 picks.
         bool_and(player_status in ('completed', 'missed_cut', 'withdrawn')) as round_fully_scored,
         bool_or(has_double_play) as used_double_play_this_round
    from pick_scores
   group by round_id, member_id
) ps on ps.round_id = r.id and ps.member_id = m.id;

-- Convenience view: running tournament total per member across all rounds played so far.
create or replace view tournament_standings as
select
  m.id as member_id,
  m.team_name,
  m.display_name,
  t.tournament_id,
  sum(t.round_total) as total_to_par,
  bool_or(t.used_double_play_this_round) as used_double_play
from team_round_totals t
join members m on m.id = t.member_id
group by m.id, m.team_name, m.display_name, t.tournament_id;

-- Career view: aggregates every completed tournament's result per team,
-- across the team's whole history in this league. Wins/totals are
-- summed from tournament_results (the permanent per-tournament ledger),
-- while the displayed team name is joined live from members so it
-- always reflects the team's current name, even if they've renamed
-- since their last tournament.
create or replace view career_standings as
select
  m.id as member_id,
  m.league_id,
  m.team_name as current_team_name,
  m.display_name,
  count(tr.id) filter (where tr.is_win) as career_wins,
  count(tr.id) as tournaments_played,
  coalesce(sum(tr.total_to_par), 0) as career_total_to_par,
  min(tr.total_to_par) as best_tournament_to_par
from members m
left join tournament_results tr on tr.member_id = m.id
group by m.id, m.league_id, m.team_name, m.display_name;

-- Podium standings: ranks teams by count of 1st/2nd/3rd place finishes
-- across every completed tournament in the league - "how many times
-- have you finished on the podium", not a points/score total. Sort
-- order (in application code, not this view) should be: most 1sts,
-- then most 2nds, then most 3rds, then lowest career_total_to_par as
-- a final tiebreak. total_points is the field-size-scaled points
-- system (see services/tournamentResults.ts calculatePoints) shown
-- ALONGSIDE the win counts, not replacing them.
-- total_points already combines placement points AND bonus points
-- together (see calculatePoints + bonusPoints in
-- tournamentResults.ts, which sums them before storing a single
-- points value) - bonus_points here is DERIVED separately by
-- re-summing bonus_picks directly, rather than stored redundantly, so
-- it's automatically correct for every tournament ever finalized
-- without needing a backfill. "League points" (placement-only) is
-- just total_points - bonus_points, computed by the caller rather
-- than stored a third time here.
create or replace view podium_standings as
select
  m.id as member_id,
  m.league_id,
  m.team_name as current_team_name,
  m.display_name,
  count(tr.id) filter (where tr.placement = 1) as firsts,
  count(tr.id) filter (where tr.placement = 2) as seconds,
  count(tr.id) filter (where tr.placement = 3) as thirds,
  count(tr.id) as tournaments_played,
  coalesce(sum(tr.total_to_par), 0) as career_total_to_par,
  coalesce(sum(tr.points), 0) as total_points,
  coalesce(max(bp.bonus_points), 0) as bonus_points
from members m
left join tournament_results tr on tr.member_id = m.id
left join (
  select bpk.member_id, sum(bpk.points) as bonus_points
    from bonus_picks bpk
    join rounds r on r.id = bpk.round_id
    join tournaments t on t.id = r.tournament_id
   where t.status = 'completed'
   group by bpk.member_id
) bp on bp.member_id = m.id
group by m.id, m.league_id, m.team_name, m.display_name;
