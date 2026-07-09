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
create or replace function apply_double_play(score int)
returns int as $$
begin
  if score < 0 then
    return score * 2;
  elsif score > 0 then
    return ceil(score / 2.0)::int;
  else
    return 0;
  end if;
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
  tp.country_code
from picks p
join tournament_players tp on tp.id = p.tournament_player_id
join rounds r on r.id = p.round_id
left join player_round_scores s
  on s.tournament_player_id = p.tournament_player_id
  and s.round_id = p.round_id;

-- Convenience view: team total per round (sum of 4 picks' EFFECTIVE
-- scores, i.e. with Double Play already applied).
create or replace view team_round_totals as
select
  round_id,
  member_id,
  tournament_id,
  round_number,
  sum(effective_score_to_par) as round_total,
  count(*) as pick_count,
  bool_and(player_status = 'completed') as round_fully_scored,
  bool_or(has_double_play) as used_double_play_this_round
from pick_scores
group by round_id, member_id, tournament_id, round_number;

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
-- a final tiebreak.
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
  coalesce(sum(tr.total_to_par), 0) as career_total_to_par
from members m
left join tournament_results tr on tr.member_id = m.id
group by m.id, m.league_id, m.team_name, m.display_name;
