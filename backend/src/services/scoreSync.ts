/**
 * Score Sync Service
 * -------------------
 * Pulls live scores from the ESPN adapter and writes them into
 * `player_round_scores`. Designed to be called on a schedule (e.g. every
 * 2-5 minutes during a live round) by a cron-style job on the host
 * (Render supports scheduled jobs / a simple setInterval in the app
 * process is also fine at this scale).
 *
 * On ESPN failure, falls back to the last cached snapshot in
 * `espn_snapshot_cache` so the app keeps showing the most recent known
 * scores instead of erroring out mid-round.
 */

import { getLeaderboard, NormalizedLeaderboard } from "../adapters/espnGolf";
import { query } from "../db/client";

export async function syncTournamentScores(tournamentId: string, espnEventId: string | null) {
  if (!espnEventId) {
    throw new Error(
      `Tournament ${tournamentId} has no espn_event_id set - can't sync scores. ` +
        `Find the event id from ESPN's leaderboard URL (e.g. espn.com/golf/leaderboard?tournamentId=XXXXXX) ` +
        `and set it on the tournament.`
    );
  }

  let board: NormalizedLeaderboard;

  try {
    board = await getLeaderboard(espnEventId);
    // Cache the good result for fallback use.
    await query(
      `insert into espn_snapshot_cache (tournament_id, raw_payload, fetched_at)
       values ($1, $2, now())
       on conflict (tournament_id) do update
         set raw_payload = excluded.raw_payload, fetched_at = excluded.fetched_at`,
      [tournamentId, JSON.stringify(board)]
    );
  } catch (err) {
    console.error(`[scoreSync] ESPN fetch failed for tournament ${tournamentId}:`, err);
    const cached = await query<{ raw_payload: NormalizedLeaderboard }>(
      `select raw_payload from espn_snapshot_cache where tournament_id = $1`,
      [tournamentId]
    );
    if (cached.rows.length === 0) {
      throw new Error(
        `No live data and no cached snapshot available for tournament ${tournamentId}`
      );
    }
    board = cached.rows[0].raw_payload;
    console.warn(`[scoreSync] Falling back to cached snapshot for tournament ${tournamentId}`);
  }

  await writeScoresToDb(tournamentId, board);
  return board;
}

async function writeScoresToDb(tournamentId: string, board: NormalizedLeaderboard) {
  // board.players is now a flat list of one row per player PER ROUND
  // (the adapter emits one NormalizedPlayerRound per linescore entry),
  // not just the current round - so look up all of this tournament's
  // rounds once and write each row to its matching round_number.
  const roundsResult = await query<{ id: string; round_number: number }>(
    `select id, round_number from rounds where tournament_id = $1`,
    [tournamentId]
  );
  const roundIdByNumber = new Map(roundsResult.rows.map((r) => [r.round_number, r.id]));

  // Track which tournament_players we've seen marked withdrawn this
  // sync, to avoid redundant updates within the same pass.
  const withdrawnPlayerIds = new Set<string>();

  for (const player of board.players) {
    const roundId = roundIdByNumber.get(player.roundNumber);
    if (!roundId) {
      console.warn(
        `[scoreSync] No round row found for tournament ${tournamentId} round ${player.roundNumber} - skipping`
      );
      continue;
    }

    const tp = await query<{ id: string }>(
      `select id from tournament_players where tournament_id = $1 and espn_player_id = $2`,
      [tournamentId, player.espnPlayerId]
    );
    if (tp.rows.length === 0) {
      // Player not in our pool yet (e.g. late addition / wild card) - skip.
      // Could auto-insert here if desired; left manual per the original brief.
      continue;
    }
    const tournamentPlayerId = tp.rows[0].id;

    await query(
      `insert into player_round_scores
         (tournament_player_id, round_id, score_to_par, thru, status, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (tournament_player_id, round_id) do update
         set score_to_par = excluded.score_to_par,
             thru = excluded.thru,
             status = excluded.status,
             updated_at = now()`,
      [tournamentPlayerId, roundId, player.scoreToPar, player.thru, player.status]
    );

    // If a player is withdrawn, mark them inactive so the pick UI can
    // surface a "needs swap" prompt to anyone who picked them.
    if (player.status === "withdrawn" && !withdrawnPlayerIds.has(tournamentPlayerId)) {
      withdrawnPlayerIds.add(tournamentPlayerId);
      await query(`update tournament_players set is_active = false where id = $1`, [
        tournamentPlayerId,
      ]);
    }
  }
}
