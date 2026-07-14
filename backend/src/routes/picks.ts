import { Router } from "express";
import { query } from "../db/client";
import {
  submitPicks,
  swapPick,
  getDoublePlayStatus,
  PickValidationError,
} from "../services/picks";
import { requireMember } from "../middleware/auth";
import { maybeSync } from "../services/scoreSync";
import { syncBonusPicksForRound } from "../services/bonusPickSync";

export const picksRouter = Router();

// GET /rounds/:roundId - basic round info (lock status, tournament link)
picksRouter.get("/:roundId", requireMember, async (req, res) => {
  const result = await query(
    `select r.*, t.name as tournament_name, t.total_rounds from rounds r
       join tournaments t on t.id = r.tournament_id
      where r.id = $1`,
    [req.params.roundId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Round not found." });
  res.json(result.rows[0]);
});

// GET /rounds/:roundId/available-players
// Returns the full tournament player pool, flagging which ones this
// member has already used in an earlier round of the same tournament.
picksRouter.get("/:roundId/available-players", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const memberId = req.member!.id;

  const roundRes = await query<{ tournament_id: string }>(
    `select tournament_id from rounds where id = $1`,
    [roundId]
  );
  const tournamentId = roundRes.rows[0]?.tournament_id;
  if (!tournamentId) return res.status(404).json({ error: "Round not found." });

  const tournamentRow = await query<{ espn_event_id: string | null; status: string }>(
    `select espn_event_id, status from tournaments where id = $1`,
    [tournamentId]
  );
  maybeSync(tournamentId, tournamentRow.rows[0]?.espn_event_id ?? null, tournamentRow.rows[0]?.status ?? "");

  const players = await query(
    `with field_avg as (
       select r.round_number, avg(prs.score_to_par) as avg_score, min(prs.score_to_par) as best_score
         from player_round_scores prs
         join rounds r on r.id = prs.round_id
        where r.tournament_id = $1
          and prs.score_to_par is not null
        group by r.round_number
     )
     select tp.id, tp.full_name, tp.pro_team_name, tp.country_code, tp.is_active, tp.inactive_reason,
            exists (
              select 1 from picks p
              join rounds r on r.id = p.round_id
              where r.tournament_id = $1
                and p.member_id = $2
                and p.round_id != $3
                and p.tournament_player_id = tp.id
            ) as already_used,
            totals.total_to_par,
            totals.rounds_played,
            case when totals.total_to_par is null then null
                 else rank() over (order by totals.total_to_par asc)
            end as leaderboard_position,
            coalesce(
              (select json_agg(
                        json_build_object(
                          'round_number', r.round_number,
                          'score_to_par', prs.score_to_par,
                          'field_avg', fa.avg_score,
                          'field_best', fa.best_score
                        )
                        order by r.round_number
                      )
                 from player_round_scores prs
                 join rounds r on r.id = prs.round_id
                 left join field_avg fa on fa.round_number = r.round_number
                where prs.tournament_player_id = tp.id
                  and prs.score_to_par is not null),
              '[]'
            ) as round_scores
       from tournament_players tp
       left join (
         select prs.tournament_player_id,
                sum(prs.score_to_par) as total_to_par,
                count(*) as rounds_played
           from player_round_scores prs
           join rounds r on r.id = prs.round_id
          where r.tournament_id = $1
            and prs.score_to_par is not null
          group by prs.tournament_player_id
       ) totals on totals.tournament_player_id = tp.id
      where tp.tournament_id = $1
      order by tp.full_name asc`,
    [tournamentId, memberId, roundId]
  );

  res.json(players.rows);
});

// GET /rounds/:roundId/needs-swap
// Returns this member's picks for the round that are for a player now
// marked inactive (withdrawn) - the frontend uses this to surface an
// active "swap required" prompt rather than relying on the member to
// notice a badge in the player list themselves.
picksRouter.get("/:roundId/needs-swap", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const memberId = req.member!.id;

  const result = await query(
    `select p.id as pick_id, tp.id as tournament_player_id, tp.full_name
       from picks p
       join tournament_players tp on tp.id = p.tournament_player_id
      where p.round_id = $1
        and p.member_id = $2
        and tp.is_active = false`,
    [roundId, memberId]
  );

  res.json(result.rows);
});

// GET /rounds/:roundId/my-picks-with-scores
// This member's picks for the round, each joined with its live score
// (via the pick_scores view) - used by the Pick tab's round selector
// to show actual scores once a round is locked/live, not just the
// raw pick list.
picksRouter.get("/:roundId/my-picks-with-scores", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const memberId = req.member!.id;

  const result = await query(
    `select tournament_player_id, player_name, score_to_par, effective_score_to_par,
            has_double_play, player_status
       from pick_scores
      where round_id = $1 and member_id = $2`,
    [roundId, memberId]
  );
  res.json(result.rows);
});

// GET /rounds/:roundId/my-picks
// This member's current picks for the round, if any, including which
// one (if any) carries the Double Play token. Used to restore prior
// selections when re-opening the pick page before lock.
picksRouter.get("/:roundId/my-picks", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const memberId = req.member!.id;

  const result = await query(
    `select tournament_player_id, has_double_play
       from picks
      where round_id = $1 and member_id = $2`,
    [roundId, memberId]
  );
  res.json(result.rows);
});

// GET /rounds/:roundId/double-play-status
// Tells this member whether they've already spent their once-per-
// tournament Double Play token, and if so, where.
picksRouter.get("/:roundId/double-play-status", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const memberId = req.member!.id;

  const roundRes = await query<{ tournament_id: string }>(
    `select tournament_id from rounds where id = $1`,
    [roundId]
  );
  const tournamentId = roundRes.rows[0]?.tournament_id;
  if (!tournamentId) return res.status(404).json({ error: "Round not found." });

  const status = await getDoublePlayStatus(memberId, tournamentId);
  res.json(status);
});

// POST /rounds/:roundId/picks  { tournamentPlayerIds: [4 ids], doublePlayTournamentPlayerId?: string }
picksRouter.post("/:roundId/picks", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const { tournamentPlayerIds, doublePlayTournamentPlayerId } = req.body;
  const memberId = req.member!.id;

  try {
    const result = await submitPicks({
      memberId,
      roundId,
      tournamentPlayerIds,
      doublePlayTournamentPlayerId,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof PickValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to submit picks." });
  }
});

// POST /rounds/:roundId/swap  { outgoingTournamentPlayerId, incomingTournamentPlayerId }
picksRouter.post("/:roundId/swap", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const { outgoingTournamentPlayerId, incomingTournamentPlayerId } = req.body;
  const memberId = req.member!.id;

  try {
    const result = await swapPick({
      memberId,
      roundId,
      outgoingTournamentPlayerId,
      incomingTournamentPlayerId,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof PickValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to swap pick." });
  }
});

// GET /rounds/:roundId/bonus-eligible-players
// Same player pool as available-players, but WITHOUT the no-repeat
// exclusion - the bonus pick is exempt from that rule entirely, any
// player in the tournament is fair game every round.
picksRouter.get("/:roundId/bonus-eligible-players", requireMember, async (req, res) => {
  const { roundId } = req.params;

  const roundRes = await query<{ tournament_id: string }>(
    `select tournament_id from rounds where id = $1`,
    [roundId]
  );
  const tournamentId = roundRes.rows[0]?.tournament_id;
  if (!tournamentId) return res.status(404).json({ error: "Round not found." });

  const players = await query(
    `select tp.id, tp.full_name, tp.pro_team_name, tp.country_code, tp.is_active, tp.inactive_reason
       from tournament_players tp
      where tp.tournament_id = $1
      order by tp.full_name asc`,
    [tournamentId]
  );
  res.json(players.rows);
});

// GET /rounds/:roundId/my-bonus-pick
// This member's bonus pick for this round (if any), the round's
// assigned category, and live points. Triggers a throttled sync (same
// maybeSync pattern as normal scores) so viewing the pick screen keeps
// bonus points fresh without needing a dedicated poll.
picksRouter.get("/:roundId/my-bonus-pick", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const memberId = req.member!.id;

  const roundRes = await query<{ bonus_category: string | null }>(
    `select bonus_category from rounds where id = $1`,
    [roundId]
  );
  if (roundRes.rows.length === 0) return res.status(404).json({ error: "Round not found." });

  syncBonusPicksForRound(roundId).catch((err) =>
    console.error(`[my-bonus-pick] background sync failed for round ${roundId}:`, err)
  );

  const pick = await query<{
    id: string;
    tournament_player_id: string;
    full_name: string;
    points: number;
    breakdown: Record<string, number> | null;
    last_synced_at: string | null;
  }>(
    `select bp.id, bp.tournament_player_id, tp.full_name, bp.points, bp.breakdown, bp.last_synced_at
       from bonus_picks bp
       join tournament_players tp on tp.id = bp.tournament_player_id
      where bp.round_id = $1 and bp.member_id = $2`,
    [roundId, memberId]
  );

  res.json({
    category: roundRes.rows[0].bonus_category,
    pick: pick.rows[0] ?? null,
  });
});

// POST /rounds/:roundId/bonus-pick  { tournamentPlayerId }
// Sets (or changes) this member's bonus pick for the round. No
// no-repeat validation - any player is always eligible. Respects the
// round's lock time same as normal picks.
picksRouter.post("/:roundId/bonus-pick", requireMember, async (req, res) => {
  const { roundId } = req.params;
  const { tournamentPlayerId } = req.body;
  const memberId = req.member!.id;
  if (!tournamentPlayerId) {
    return res.status(400).json({ error: "tournamentPlayerId is required." });
  }

  const round = await query<{ locks_at: string | null }>(`select locks_at from rounds where id = $1`, [roundId]);
  if (round.rows.length === 0) return res.status(404).json({ error: "Round not found." });
  if (round.rows[0].locks_at && new Date(round.rows[0].locks_at) < new Date()) {
    return res.status(400).json({ error: "This round is locked - bonus pick can no longer be changed." });
  }

  await query(
    `insert into bonus_picks (round_id, member_id, tournament_player_id)
     values ($1, $2, $3)
     on conflict (round_id, member_id) do update set tournament_player_id = excluded.tournament_player_id`,
    [roundId, memberId, tournamentPlayerId]
  );

  res.json({ success: true });
});
