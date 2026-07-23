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
import { getLivLeaderboard, normalizeLivParse, estimateHolesRemaining } from "../adapters/livGolf";
import { query } from "../db/client";

export async function syncTournamentScores(tournamentId: string, espnEventId: string | null) {
  if (!espnEventId) {
    throw new Error(
      `Tournament ${tournamentId} has no espn_event_id set - can't sync scores. ` +
        `Find the event id from ESPN's leaderboard URL (e.g. espn.com/golf/leaderboard?tournamentId=XXXXXX) ` +
        `and set it on the tournament.`
    );
  }

  // Check whether this is a LIV event - if so, use the LIV scraper
  // (livgolf.com) instead of ESPN, since ESPN does not provide live
  // scoring data for LIV events (their feed stays on STATUS_SCHEDULED
  // throughout the entire tournament, even after rounds are complete).
  const tournamentMeta = await query<{ tour: string | null; liv_event_slug: string | null }>(
    `select tour, liv_event_slug from tournaments where id = $1`,
    [tournamentId]
  );
  const tour = tournamentMeta.rows[0]?.tour ?? null;
  const livSlug = tournamentMeta.rows[0]?.liv_event_slug ?? null;

  let board: NormalizedLeaderboard;

  if (tour === "LIV" && livSlug) {
    // LIV path: scrape livgolf.com, match players by surname
    try {
      const players = await query<{ espn_player_id: string; full_name: string }>(
        `select espn_player_id, full_name from tournament_players where tournament_id = $1 and espn_player_id is not null`,
        [tournamentId]
      );
      const surnameMap = new Map<string, { espnPlayerId: string; fullName: string }>();
      for (const p of players.rows) {
        const surname = p.full_name.split(" ").slice(-1)[0].toLowerCase();
        surnameMap.set(surname, { espnPlayerId: p.espn_player_id, fullName: p.full_name });
      }
      const livParse = await getLivLeaderboard(livSlug);
      board = normalizeLivParse(livSlug, livParse, surnameMap);
      console.log(`[scoreSync] LIV scrape succeeded for tournament ${tournamentId}: ${board.players.length} player-rounds`);

      // Shotgun-start "holes remaining" estimate for the leaderboard
      // header - best-effort, never blocks the score sync.
      try {
        const holesRemaining = await estimateHolesRemaining(livSlug, livParse, surnameMap);
        await query(`update tournaments set holes_remaining = $1 where id = $2`, [holesRemaining, tournamentId]);
      } catch (err) {
        console.error(`[scoreSync] holes-remaining estimate failed (non-fatal):`, err);
      }
    } catch (err) {
      console.error(`[scoreSync] LIV scrape failed for tournament ${tournamentId}:`, err);
      throw err;
    }
  } else {
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
  }

  await writeScoresToDb(tournamentId, board);
  await query(`update tournaments set last_synced_at = now() where id = $1`, [tournamentId]);
  return board;
}

const MIN_SECONDS_BETWEEN_SYNCS = 90;

// In-memory guard against overlapping syncs for the same tournament -
// e.g. two page loads landing within the same second, before the DB's
// last_synced_at has even been updated by the first one's write.
const syncInFlight = new Set<string>();

/**
 * Fire-and-forget: called from GET routes that members hit routinely
 * (loading the pick screen, the leaderboard, etc). If it's been more
 * than MIN_SECONDS_BETWEEN_SYNCS since this tournament's last sync,
 * kicks off a real sync in the background WITHOUT making the caller
 * wait for it - the current request still returns immediately with
 * whatever data is already in the DB. The freshly-synced data shows
 * up on the NEXT request instead, which in practice is nearly
 * instant since syncs take well under a second.
 *
 * This means active use of the app (people actually loading pages)
 * keeps scores fresh on its own, without needing every single
 * request to wait on an ESPN round-trip, and without needing a
 * background cron/keep-alive ping to be the only thing keeping data
 * current.
 */
export function maybeSync(tournamentId: string, espnEventId: string | null, status: string) {
  if (status !== "live" || !espnEventId) return;
  if (syncInFlight.has(tournamentId)) return;

  query<{ last_synced_at: string | null }>(
    `select last_synced_at from tournaments where id = $1`,
    [tournamentId]
  )
    .then((result) => {
      const lastSynced = result.rows[0]?.last_synced_at;
      const staleEnough =
        !lastSynced || Date.now() - new Date(lastSynced).getTime() > MIN_SECONDS_BETWEEN_SYNCS * 1000;
      if (!staleEnough) return;

      syncInFlight.add(tournamentId);
      syncTournamentScores(tournamentId, espnEventId)
        .catch((err) => console.error(`[scoreSync] maybeSync failed for tournament ${tournamentId}:`, err))
        .finally(() => syncInFlight.delete(tournamentId));
    })
    .catch((err) => console.error(`[scoreSync] maybeSync last_synced_at lookup failed:`, err));
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

  // Track which tournament_players we've seen marked inactive this
  // sync (withdrawn or missed the cut), to avoid redundant updates
  // within the same pass.
  const deactivatedPlayerIds = new Set<string>();

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
         (tournament_player_id, round_id, score_to_par, thru, tee_time, start_position, current_position, status, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (tournament_player_id, round_id) do update
         set score_to_par = excluded.score_to_par,
             thru = excluded.thru,
             tee_time = excluded.tee_time,
             start_position = excluded.start_position,
             current_position = excluded.current_position,
             status = excluded.status,
             updated_at = now()
         where player_round_scores.manually_overridden = false`,
      [
        tournamentPlayerId,
        roundId,
        player.scoreToPar,
        player.thru,
        player.teeTime,
        player.startPosition,
        player.currentPosition,
        player.status,
      ]
    );

    // If a player is withdrawn or missed the cut, mark them inactive
    // so the pick UI can grey them out / prompt a swap for anyone who
    // picked them.
    if (
      (player.status === "withdrawn" || player.status === "missed_cut") &&
      !deactivatedPlayerIds.has(tournamentPlayerId)
    ) {
      deactivatedPlayerIds.add(tournamentPlayerId);
      await query(`update tournament_players set is_active = false, inactive_reason = $2 where id = $1`, [
        tournamentPlayerId,
        player.status,
      ]);
    }
  }
}
