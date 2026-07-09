import { Router } from "express";
import { query } from "../db/client";
import {
  submitPicks,
  swapPick,
  getDoublePlayStatus,
  PickValidationError,
} from "../services/picks";
import { requireMember } from "../middleware/auth";

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

  const players = await query(
    `select tp.id, tp.full_name, tp.pro_team_name, tp.country_code, tp.is_active,
            exists (
              select 1 from picks p
              join rounds r on r.id = p.round_id
              where r.tournament_id = $1
                and p.member_id = $2
                and p.round_id != $3
                and p.tournament_player_id = tp.id
            ) as already_used
       from tournament_players tp
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
