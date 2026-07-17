import { Router } from "express";
import { query, withTransaction } from "../db/client";
import { requireMember, requireOwner } from "../middleware/auth";
import { finalizeTournamentResults, overrideTournamentWin, ResultsError } from "../services/tournamentResults";
import { updateMemberCareerStats } from "../services/careerStats";
import { syncTournamentScores } from "../services/scoreSync";
import { pickRandomCategory } from "../services/bonusPickSync";
import { getLeaderboard } from "../adapters/espnGolf";
import { hashPasscode } from "../utils/passcode";
import DEFAULT_ROSTER from "../data/andalucia-roster.json";
import ANDALUCIA_ROUND_1_SCORES from "../data/andalucia-round1-scores.json";
import ANDALUCIA_ROUND_2_SCORES from "../data/andalucia-round2-scores.json";
import ANDALUCIA_ROUND_3_SCORES from "../data/andalucia-round3-scores.json";
import ANDALUCIA_ROUND_4_SCORES from "../data/andalucia-round4-scores.json";

export const adminRouter = Router();

adminRouter.use(requireMember, requireOwner);

// POST /admin/tournaments  { name, parTotal, totalRounds, espnEventId, startsAt }
// Creates a tournament for the owner's league and pre-creates its
// rounds (default 4, matching LIV's 2026 format) in one transaction.
adminRouter.post("/tournaments", async (req, res) => {
  const { name, parTotal, totalRounds, espnEventId, startsAt } = req.body;
  if (!name) return res.status(400).json({ error: "name is required." });

  const rounds = Number(totalRounds) > 0 ? Number(totalRounds) : 4;
  const par = Number(parTotal) > 0 ? Number(parTotal) : 72;

  try {
    const tournament = await withTransaction(async (client) => {
      const t = await client.query(
        `insert into tournaments (league_id, name, espn_event_id, par, total_rounds, status, starts_at)
         values ($1, $2, $3, $4, $5, 'upcoming', $6)
         returning *`,
        [req.member!.leagueId, name, espnEventId ?? null, par, rounds, startsAt ?? null]
      );
      const tournamentId = t.rows[0].id;

      for (let i = 1; i <= rounds; i++) {
        await client.query(
          `insert into rounds (tournament_id, round_number, status, bonus_category) values ($1, $2, 'upcoming', $3)`,
          [tournamentId, i, pickRandomCategory()]
        );
      }
      return t.rows[0];
    });

    res.status(201).json(tournament);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create tournament." });
  }
});

// PATCH /admin/tournaments/:id/status  { status: 'upcoming' | 'live' | 'completed' }
// Flips a tournament live/completed - the score sync loop only polls
// tournaments with status = 'live', so this is how syncing turns on.
// Flipping to 'completed' also finalizes results into the permanent
// tournament_results ledger (see services/tournamentResults.ts), which
// is what makes wins and career totals persist across tournaments.
adminRouter.patch("/tournaments/:id/status", async (req, res) => {
  const { status } = req.body;
  if (!["upcoming", "live", "completed"].includes(status)) {
    return res.status(400).json({ error: "status must be upcoming, live, or completed." });
  }

  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  await query(`update tournaments set status = $1 where id = $2`, [status, req.params.id]);

  if (status === "live") {
    // Don't wait on the 3-minute interval for the first scores to show
    // up - fire a sync immediately. Fire-and-forget: the status change
    // itself already succeeded, and a slow/failed ESPN call shouldn't
    // block or fail this response. The next interval tick will retry
    // anyway if this happens to fail.
    const tournamentRow = await query<{ espn_event_id: string | null }>(
      `select espn_event_id from tournaments where id = $1`,
      [req.params.id]
    );
    const espnEventId = tournamentRow.rows[0]?.espn_event_id ?? null;
    syncTournamentScores(req.params.id, espnEventId).catch((err) =>
      console.error(`Immediate sync on live-flip failed for tournament ${req.params.id}:`, err)
    );
  }

  if (status === "completed") {
    try {
      const result = await finalizeTournamentResults(req.params.id);
      // Best-effort: career stats (Hot Hand history, favourite player,
      // personal bests) shouldn't block finalization if something
      // about this specific computation fails - the win/placement
      // ledger finalizing correctly matters more.
      await updateMemberCareerStats(req.params.id).catch((err) =>
        console.error(`Career stats update failed for tournament ${req.params.id}:`, err)
      );
      return res.json({ success: true, ...result });
    } catch (err) {
      if (err instanceof ResultsError) {
        // Status change still happened, but flag that results couldn't
        // be finalized (e.g. nobody made any picks) so the owner knows
        // career stats won't reflect this tournament.
        return res.status(200).json({ success: true, finalizationWarning: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: "Status updated but finalization failed." });
    }
  }

  res.json({ success: true });
});

// POST /admin/tournaments/:id/sync-now
// Manually triggers an immediate ESPN score sync for this tournament,
// instead of waiting for the background interval. Useful because
// Render's free tier sleeps after 15 minutes idle, which can silently
// starve the interval-based sync loop in index.ts.
adminRouter.post("/tournaments/:id/sync-now", async (req, res) => {
  const tournament = await query<{ id: string; espn_event_id: string | null }>(
    `select id, espn_event_id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  try {
    const board = await syncTournamentScores(tournament.rows[0].id, tournament.rows[0].espn_event_id);
    res.json({ success: true, eventName: board.eventName, currentRound: board.currentRound, playerRounds: board.players.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed." });
  }
});


// POST /admin/tournaments/:id/backfill-career-stats
// Manually (re-)runs the career stats step in isolation, WITHOUT
// touching finalizeTournamentResults (which handles wins/placements
// and isn't safely re-runnable - calling it twice risks double
// counting a win). Exists specifically for tournaments that were
// marked completed BEFORE the member_career_stats migration was run:
// the career stats step fails silently in that case (by design, so a
// stats hiccup never blocks real finalization), and there's no
// automatic retry - this lets the owner manually fill in the gap for
// a specific already-completed tournament once the table exists.
adminRouter.post("/tournaments/:id/backfill-career-stats", async (req, res) => {
  const tournament = await query<{ id: string; status: string }>(
    `select id, status from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }
  if (tournament.rows[0].status !== "completed") {
    return res.status(400).json({ error: "Tournament isn't marked completed yet." });
  }

  try {
    await updateMemberCareerStats(tournament.rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Backfill failed." });
  }
});

// Owner override for a specific team's win credit on an already
// finalized (completed) tournament - e.g. correcting a tie-break.
adminRouter.patch("/tournaments/:id/results/:memberId/win", async (req, res) => {
  const { isWin } = req.body;
  if (typeof isWin !== "boolean") {
    return res.status(400).json({ error: "isWin must be a boolean." });
  }
  try {
    const result = await overrideTournamentWin(req.params.id, req.params.memberId, isWin);
    res.json(result);
  } catch (err) {
    if (err instanceof ResultsError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to override win." });
  }
});

// GET /admin/tournaments/:id/results - finalized per-team results for
// a completed tournament, used by the admin override UI.
adminRouter.get("/tournaments/:id/results", async (req, res) => {
  const result = await query(
    `select tr.* from tournament_results tr
       join tournaments t on t.id = tr.tournament_id
      where tr.tournament_id = $1 and t.league_id = $2
      order by tr.placement asc`,
    [req.params.id, req.member!.leagueId]
  );
  res.json(result.rows);
});

// PATCH /admin/rounds/:roundId/lock  { locksAt: ISO string | null }
// Sets (or clears, if locksAt is null) the time after which picks for
// this round can no longer be submitted or swapped. submitPicks() and
// swapPick() in services/picks.ts already enforce this - this endpoint
// is just how the owner sets it (e.g. to the round's tee time).
adminRouter.patch("/rounds/:roundId/lock", async (req, res) => {
  const { locksAt } = req.body;

  const round = await query(
    `select r.id from rounds r
       join tournaments t on t.id = r.tournament_id
      where r.id = $1 and t.league_id = $2`,
    [req.params.roundId, req.member!.leagueId]
  );
  if (round.rows.length === 0) {
    return res.status(404).json({ error: "Round not found." });
  }

  await query(`update rounds set locks_at = $1 where id = $2`, [
    locksAt ?? null,
    req.params.roundId,
  ]);
  res.json({ success: true });
});

// PATCH /admin/tournaments/:id/espn-event-id  { espnEventId: string | null }
// Lets the owner set or correct the ESPN event id after a tournament
// has already been created (e.g. they didn't have it on hand yet, or
// ESPN's id needs correcting). syncTournamentScores() requires this to
// be set before live scores can sync.
adminRouter.patch("/tournaments/:id/espn-event-id", async (req, res) => {
  const { espnEventId } = req.body;
  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }
  await query(`update tournaments set espn_event_id = $1 where id = $2`, [
    espnEventId || null,
    req.params.id,
  ]);
  res.json({ success: true });
});

// DELETE /admin/tournaments/:id
// Permanently deletes a tournament and everything tied to it (rounds,
// player pool, picks, scores, results) - the schema's foreign keys are
// all "on delete cascade", so this one query cleans up everything.
// Meant for removing leftover test tournaments, not for real ones with
// picks people care about - there's no undo.
adminRouter.delete("/tournaments/:id", async (req, res) => {
  const result = await query(
    `delete from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }
  res.json({ success: true });
});


// Manually adds a player to a tournament's pool. Used both for the
// initial bulk population and for one-off additions (e.g. a late
// wild-card replacement) that the ESPN scrape might miss.
adminRouter.post("/tournaments/:id/players", async (req, res) => {
  const { fullName, proTeamName, espnPlayerId, countryCode } = req.body;
  if (!fullName) return res.status(400).json({ error: "fullName is required." });

  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  const result = await query(
    `insert into tournament_players (tournament_id, espn_player_id, full_name, pro_team_name, country_code)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [req.params.id, espnPlayerId ?? null, fullName, proTeamName ?? null, countryCode ?? null]
  );
  res.status(201).json(result.rows[0]);
});

// POST /admin/tournaments/:id/players/bulk  { players: [{ fullName, proTeamName?, countryCode? }] }
// Convenience endpoint for populating a whole field at once (e.g.
// pasting in the 54-player LIV field at the start of an event).
adminRouter.post("/tournaments/:id/players/bulk", async (req, res) => {
  const { players } = req.body;
  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: "players must be a non-empty array." });
  }

  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  const inserted = await withTransaction(async (client) => {
    const rows = [];
    for (const p of players) {
      if (!p.fullName) continue;
      const r = await client.query(
        `insert into tournament_players (tournament_id, espn_player_id, full_name, pro_team_name, country_code)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [req.params.id, p.espnPlayerId ?? null, p.fullName, p.proTeamName ?? null, p.countryCode ?? null]
      );
      rows.push(r.rows[0]);
    }
    return rows;
  });

  res.status(201).json(inserted);
});

// POST /admin/tournaments/:id/players/seed-default
// Populates the tournament's player pool from the bundled LIV Golf
// Andalucia 2026 roster (57 real players with ESPN ids and country
// codes) - a convenient starting point that's still fully editable
// afterward via the regular add/withdraw endpoints. Skips any player
// whose espn_player_id already exists in this tournament, so calling
// this more than once (e.g. after also adding a few manually) doesn't
// create duplicates.
adminRouter.post("/tournaments/:id/players/seed-default", async (req, res) => {
  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  const inserted = await withTransaction(async (client) => {
    const rows = [];
    for (const p of DEFAULT_ROSTER) {
      const existing = await client.query(
        `select 1 from tournament_players where tournament_id = $1 and espn_player_id = $2`,
        [req.params.id, p.espnPlayerId]
      );
      if (existing.rows.length > 0) continue;

      const r = await client.query(
        `insert into tournament_players (tournament_id, espn_player_id, full_name, country_code, pro_team_name)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [req.params.id, p.espnPlayerId, p.fullName, p.countryCode, p.proTeamName ?? null]
      );
      rows.push(r.rows[0]);
    }
    return rows;
  });

  res.status(201).json({ added: inserted.length, skipped: DEFAULT_ROSTER.length - inserted.length });
});

// POST /admin/tournaments/:id/players/populate-from-espn
// Pulls the CURRENT field directly from ESPN using this tournament's
// stored espn_event_id and bulk-adds every player found - the
// button-driven equivalent of running seed-tournament.ts by hand.
// Safe to call more than once (e.g. re-run a few days into the event
// to pick up any late entries) - skips any player whose espn_player_id
// already exists in this tournament's pool, same dedupe as seed-default.
adminRouter.post("/tournaments/:id/players/populate-from-espn", async (req, res) => {
  const tournament = await query<{ id: string; espn_event_id: string | null }>(
    `select id, espn_event_id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }
  const espnEventId = tournament.rows[0].espn_event_id;
  if (!espnEventId) {
    return res.status(400).json({
      error: "Set an ESPN event ID on this tournament first, then populate players.",
    });
  }

  let board;
  try {
    board = await getLeaderboard(espnEventId);
  } catch (err) {
    console.error(err);
    return res.status(502).json({
      error: err instanceof Error ? `Couldn't fetch ESPN field: ${err.message}` : "Couldn't fetch ESPN field.",
    });
  }

  // Collapse the one-row-per-round shape ESPN returns down to one row
  // per player before inserting.
  const byId = new Map<string, { espnPlayerId: string; fullName: string }>();
  for (const p of board.players) {
    if (!byId.has(p.espnPlayerId)) {
      byId.set(p.espnPlayerId, { espnPlayerId: p.espnPlayerId, fullName: p.fullName });
    }
  }
  const players = Array.from(byId.values());

  const inserted = await withTransaction(async (client) => {
    const rows = [];
    for (const p of players) {
      const existing = await client.query(
        `select 1 from tournament_players where tournament_id = $1 and espn_player_id = $2`,
        [req.params.id, p.espnPlayerId]
      );
      if (existing.rows.length > 0) continue;

      const r = await client.query(
        `insert into tournament_players (tournament_id, espn_player_id, full_name)
         values ($1, $2, $3)
         returning *`,
        [req.params.id, p.espnPlayerId, p.fullName]
      );
      rows.push(r.rows[0]);
    }
    return rows;
  });

  res.status(201).json({
    eventName: board.eventName,
    fieldSize: players.length,
    added: inserted.length,
    skipped: players.length - inserted.length,
  });
});

interface SimulatedRoundScore {
  espnPlayerId: string;
  scoreToPar: number | null;
  status: string;
}

// Real LIV Golf Andalucia 2026 results, one file per round, all
// matched by espn_player_id. Used by both the single-round and
// all-rounds simulate endpoints below.
const ANDALUCIA_ROUND_SCORES: Record<number, SimulatedRoundScore[]> = {
  1: ANDALUCIA_ROUND_1_SCORES,
  2: ANDALUCIA_ROUND_2_SCORES,
  3: ANDALUCIA_ROUND_3_SCORES,
  4: ANDALUCIA_ROUND_4_SCORES,
};

/**
 * Writes one round's worth of real Andalucia scores into
 * player_round_scores for the given tournament/round, matching players
 * by espn_player_id. Shared by the single-round and all-rounds
 * simulate endpoints. Returns counts rather than throwing on a partial
 * match, since "some players in this tournament weren't in the seeded
 * roster" is an expected, non-fatal case (e.g. the owner added extra
 * manual players who have no espn_player_id to match against).
 */
async function applySimulatedRoundScores(
  tournamentId: string,
  roundId: string,
  roundNumber: number
) {
  const scores = ANDALUCIA_ROUND_SCORES[roundNumber];
  if (!scores) {
    return { applied: 0, skipped: 0, total: 0 };
  }

  let applied = 0;
  let skipped = 0;
  const withdrawnPlayerIds: string[] = [];

  await withTransaction(async (client) => {
    for (const scoreRow of scores) {
      const tp = await client.query<{ id: string }>(
        `select id from tournament_players where tournament_id = $1 and espn_player_id = $2`,
        [tournamentId, scoreRow.espnPlayerId]
      );
      if (tp.rows.length === 0) {
        skipped++;
        continue;
      }
      const tournamentPlayerId = tp.rows[0].id;

      await client.query(
        `insert into player_round_scores
           (tournament_player_id, round_id, score_to_par, thru, status, updated_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (tournament_player_id, round_id) do update
           set score_to_par = excluded.score_to_par,
               thru = excluded.thru,
               status = excluded.status,
               updated_at = now()`,
        [
          tournamentPlayerId,
          roundId,
          scoreRow.scoreToPar,
          scoreRow.status === "completed" ? 18 : 0,
          scoreRow.status,
        ]
      );

      if (scoreRow.status === "withdrawn") {
        withdrawnPlayerIds.push(tournamentPlayerId);
      }
      applied++;
    }

    for (const id of withdrawnPlayerIds) {
      await client.query(`update tournament_players set is_active = false where id = $1`, [id]);
    }
  });

  return { applied, skipped, total: scores.length };
}

// POST /admin/tournaments/:id/simulate-round/:roundNumber
// Loads the REAL LIV Golf Andalucia 2026 results for one specific
// round (1-4) into the matching round of this tournament - useful for
// testing scoring/standings/Double Play math against known real-world
// numbers without waiting for an actual live round. Only affects
// players matched by ESPN ID (i.e. players added via "Load Andalucía
// Roster") - silently skips any it can't match.
adminRouter.post("/tournaments/:id/simulate-round/:roundNumber", async (req, res) => {
  const roundNumber = Number(req.params.roundNumber);
  if (!ANDALUCIA_ROUND_SCORES[roundNumber]) {
    return res.status(400).json({ error: "roundNumber must be 1, 2, 3, or 4." });
  }

  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  const round = await query<{ id: string }>(
    `select id from rounds where tournament_id = $1 and round_number = $2`,
    [req.params.id, roundNumber]
  );
  if (round.rows.length === 0) {
    return res.status(400).json({ error: `This tournament has no round ${roundNumber}.` });
  }

  const result = await applySimulatedRoundScores(req.params.id, round.rows[0].id, roundNumber);
  res.json(result);
});

// POST /admin/tournaments/:id/simulate-all-rounds
// Loads all 4 rounds of real Andalucia results in one go, in round
// order. Useful for quickly getting a tournament to a fully-scored
// state to test completion/career-standings/podium logic, rather than
// simulating one round at a time.
adminRouter.post("/tournaments/:id/simulate-all-rounds", async (req, res) => {
  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  const rounds = await query<{ id: string; round_number: number }>(
    `select id, round_number from rounds where tournament_id = $1 order by round_number asc`,
    [req.params.id]
  );

  const results: Record<number, { applied: number; skipped: number; total: number }> = {};
  for (const round of rounds.rows) {
    if (!ANDALUCIA_ROUND_SCORES[round.round_number]) continue;
    results[round.round_number] = await applySimulatedRoundScores(
      req.params.id,
      round.id,
      round.round_number
    );
  }

  res.json({ rounds: results });
});

// PATCH /admin/players/:playerId/withdraw
// Manually marks a player withdrawn (in case the ESPN scrape doesn't
// catch it promptly). Mirrors what scoreSync.ts does automatically
// when ESPN reports a withdrawn status.
adminRouter.patch("/players/:playerId/withdraw", async (req, res) => {
  await query(
    `update tournament_players tp
        set is_active = false
       from tournaments t
      where tp.id = $1
        and tp.tournament_id = t.id
        and t.league_id = $2`,
    [req.params.playerId, req.member!.leagueId]
  );
  res.json({ success: true });
});

// DELETE /admin/tournaments/:id/players
// Removes every player from this tournament's pool - used to clean up
// duplicates or a partial/incorrect seed before re-running it. Also
// removes any picks referencing those players (cascades via the
// tournament_player_id foreign key), so this should only be used
// before real picks have been made for the tournament.
adminRouter.delete("/tournaments/:id/players", async (req, res) => {
  const tournament = await query(
    `select id from tournaments where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(404).json({ error: "Tournament not found." });
  }

  const result = await query(
    `delete from tournament_players where tournament_id = $1`,
    [req.params.id]
  );
  res.json({ deleted: result.rowCount });
});

// GET /admin/tournaments/:id/players - full pool, including inactive,
// for the admin's "manage players" screen (unlike the picks-facing
// /rounds/.../available-players endpoint, this isn't filtered per member).
// Includes each player's per-round scores (joined from
// player_round_scores) so sync issues can be diagnosed directly from
// this one response instead of querying the DB by hand.
adminRouter.get("/tournaments/:id/players", async (req, res) => {
  const result = await query(
    `select tp.*,
            coalesce(
              (select json_agg(
                        json_build_object(
                          'round_number', r.round_number,
                          'score_to_par', prs.score_to_par,
                          'thru', prs.thru,
                          'status', prs.status,
                          'synced_at', prs.updated_at
                        ) order by r.round_number
                      )
                 from player_round_scores prs
                 join rounds r on r.id = prs.round_id
                where prs.tournament_player_id = tp.id),
              '[]'
            ) as round_scores
       from tournament_players tp
       join tournaments t on t.id = tp.tournament_id
      where tp.tournament_id = $1 and t.league_id = $2
      order by tp.full_name asc`,
    [req.params.id, req.member!.leagueId]
  );
  res.json(result.rows);
});

// POST /admin/members/:memberId/passcode  { passcode }
// Owner-only escape hatch: lets the league owner set (or reset) ANY
// teammate's passcode, not just their own. Needed because a member
// who never set their own passcode has no way to prove it's them if
// their session ever dies (e.g. after a backend migration invalidates
// old tokens) - normally /leagues/passcode requires already being
// logged in, which is exactly what they've lost. The owner can run
// this, then tell that person the passcode out of band (text, chat,
// in person) so they can log back in via /leagues/login.
adminRouter.post("/members/:memberId/passcode", async (req, res) => {
  const { passcode } = req.body;
  if (!passcode || typeof passcode !== "string" || passcode.length < 4) {
    return res.status(400).json({ error: "Passcode must be at least 4 characters." });
  }

  const member = await query<{ id: string; team_name: string }>(
    `select id, team_name from members where id = $1 and league_id = $2`,
    [req.params.memberId, req.member!.leagueId]
  );
  if (member.rows.length === 0) {
    return res.status(404).json({ error: "No member with that id in this league." });
  }

  const passcodeHash = hashPasscode(passcode);
  await query(`update members set passcode_hash = $1 where id = $2`, [passcodeHash, req.params.memberId]);

  res.json({ success: true, teamName: member.rows[0].team_name });
});

// POST /admin/schedule  { name, tour, startDate, endDate?, espnEventId? }
// Adds an event to the league's schedule preview. Doesn't create a
// real `tournaments` row or touch player pools - that still happens
// separately via the seed script/admin page once the event actually
// starts, same as always. This is purely "what's coming up".
adminRouter.post("/schedule", async (req, res) => {
  const { name, tour, startDate, endDate, espnEventId } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required." });
  }
  if (!tour || typeof tour !== "string") {
    return res.status(400).json({ error: "tour is required." });
  }
  if (!startDate) {
    return res.status(400).json({ error: "startDate is required." });
  }

  const result = await query<{ id: string }>(
    `insert into schedule_events (league_id, name, tour, start_date, end_date, espn_event_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [req.member!.leagueId, name, tour, startDate, endDate || null, espnEventId || null]
  );
  res.status(201).json({ id: result.rows[0].id });
});

// DELETE /admin/schedule/:id
adminRouter.delete("/schedule/:id", async (req, res) => {
  const result = await query(
    `delete from schedule_events where id = $1 and league_id = $2`,
    [req.params.id, req.member!.leagueId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Schedule event not found." });
  }
  res.json({ success: true });
});

// POST /admin/bonus-picks/:id/set-points  { points }
// Also registered as GET with a ?points= query param - a plain POST
// can't be triggered by just opening a URL in a phone browser (no
// terminal/app needed), so this needs a GET-friendly path too for
// the manual-fallback workflow to actually be usable from a phone.
async function setPointsHandler(req: any, res: any) {
  const rawPoints = req.body?.points ?? req.query?.points;
  const points = typeof rawPoints === "string" ? Number(rawPoints) : rawPoints;
  if (typeof points !== "number" || !Number.isFinite(points)) {
    return res.status(400).json({ error: "points must be a number." });
  }

  const result = await query<{ id: string }>(
    `update bonus_picks bp
        set points = $1, manually_overridden = true, last_synced_at = now()
       from rounds r, tournaments t
      where bp.id = $2
        and bp.round_id = r.id
        and r.tournament_id = t.id
        and t.league_id = $3
      returning bp.id`,
    [points, req.params.id, req.member!.leagueId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Bonus pick not found." });
  }
  res.json({ success: true, points });
}
adminRouter.post("/bonus-picks/:id/set-points", setPointsHandler);
adminRouter.get("/bonus-picks/:id/set-points", setPointsHandler);

// GET /admin/bonus-picks?roundId=xxx
// Lists bonus picks for a round with enough context (player name,
// team name, category) to know which id to target with the manual
// set-points override above, without needing to hunt through the DB
// directly.
adminRouter.get("/bonus-picks", async (req, res) => {
  const { roundId } = req.query;
  if (!roundId || typeof roundId !== "string") {
    return res.status(400).json({ error: "roundId query param is required." });
  }
  const result = await query(
    `select bp.id, m.team_name, tp.full_name as player_name, tp.espn_player_id,
            bp.points, r.round_number, r.bonus_category
       from bonus_picks bp
       join members m on m.id = bp.member_id
       join tournament_players tp on tp.id = bp.tournament_player_id
       join rounds r on r.id = bp.round_id
       join tournaments t on t.id = r.tournament_id
      where bp.round_id = $1 and t.league_id = $2`,
    [roundId, req.member!.leagueId]
  );
  res.json(result.rows);
});

// GET /admin/members - team_name/display_name list, for admin UI
// dropdowns (e.g. picking who to send an interview question to).
adminRouter.get("/members", async (req, res) => {
  const result = await query(
    `select id, team_name, display_name from members where league_id = $1 order by team_name asc`,
    [req.member!.leagueId]
  );
  res.json(result.rows);
});

// POST /admin/interview-questions  { memberId, questionText }
// Sends a new "Jamdog Interview" question to one team for the
// league's current tournament. The member sees a popup prompting
// them to answer next time they open the app (see
// GET /leagues/:id/my-pending-interview).
adminRouter.post("/interview-questions", async (req, res) => {
  const { memberId, questionText } = req.body;
  if (!memberId || typeof memberId !== "string") {
    return res.status(400).json({ error: "memberId is required." });
  }
  if (!questionText || typeof questionText !== "string" || !questionText.trim()) {
    return res.status(400).json({ error: "questionText is required." });
  }

  const member = await query<{ id: string }>(`select id from members where id = $1 and league_id = $2`, [
    memberId,
    req.member!.leagueId,
  ]);
  if (member.rows.length === 0) {
    return res.status(404).json({ error: "No member with that id in this league." });
  }

  const tournament = await query<{ id: string }>(
    `select id from tournaments where league_id = $1 order by created_at desc limit 1`,
    [req.member!.leagueId]
  );
  if (tournament.rows.length === 0) {
    return res.status(400).json({ error: "No tournament exists yet for this league." });
  }

  const result = await query<{ id: string }>(
    `insert into interview_questions (league_id, tournament_id, member_id, question_text)
     values ($1, $2, $3, $4)
     returning id`,
    [req.member!.leagueId, tournament.rows[0].id, memberId, questionText.trim()]
  );
  res.status(201).json({ id: result.rows[0].id });
});
