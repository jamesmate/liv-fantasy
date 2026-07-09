/**
 * Picks Service
 * -------------
 * Owns the core pieces of game logic:
 *
 *  1. A member's 4 picks for a round must not include any player they've
 *     already picked in an EARLIER round of the SAME tournament (picks
 *     reset to zero used players at the start of each new tournament).
 *
 *  2. A swap (replacing a withdrawn/no-show player after picks are
 *     locked) does not count the original withdrawn player as a played
 *     pick - they never actually played, so the swap itself does not
 *     consume an extra "used player" slot beyond the original pick's
 *     slot in this round. Swaps preserve has_double_play automatically
 *     (the UPDATE changes tournament_player_id on the same pick row,
 *     not the flag), satisfying "the token transfers to the swapped-in
 *     player".
 *
 *  3. Each member gets exactly one Double Play token per TOURNAMENT
 *     (not per round) - they may flag one of their picks, in any one
 *     round, to have its score doubled (if under par) or halved-and-
 *     rounded-up (if over par). See apply_double_play() in
 *     triggers_and_views.sql for the actual scoring math. Once spent
 *     in a round, it cannot be moved to a different round (only
 *     transferred via swap within the same round/pick, per #2 above).
 */

import { query } from "../db/client";

export class PickValidationError extends Error {}

interface SubmitPicksInput {
  memberId: string;
  roundId: string;
  tournamentPlayerIds: string[]; // expects exactly 4
  doublePlayTournamentPlayerId?: string | null; // one of the 4, or null/omitted
}

export async function submitPicks({
  memberId,
  roundId,
  tournamentPlayerIds,
  doublePlayTournamentPlayerId,
}: SubmitPicksInput) {
  if (tournamentPlayerIds.length !== 4) {
    throw new PickValidationError("Exactly 4 players must be picked per round.");
  }
  if (new Set(tournamentPlayerIds).size !== 4) {
    throw new PickValidationError("Cannot pick the same player twice in one round.");
  }
  if (doublePlayTournamentPlayerId && !tournamentPlayerIds.includes(doublePlayTournamentPlayerId)) {
    throw new PickValidationError("Double Play must be assigned to one of this round's 4 picks.");
  }

  const roundRes = await query<{ tournament_id: string; status: string; locks_at: string | null }>(
    `select tournament_id, status, locks_at from rounds where id = $1`,
    [roundId]
  );
  const round = roundRes.rows[0];
  if (!round) throw new PickValidationError("Round not found.");
  if (round.locks_at && new Date(round.locks_at) < new Date()) {
    throw new PickValidationError("Picks are locked for this round.");
  }

  const previouslyUsed = await getPreviouslyUsedPlayers({
    memberId,
    tournamentId: round.tournament_id,
    excludingRoundId: roundId,
  });

  const conflicts = tournamentPlayerIds.filter((id) => previouslyUsed.has(id));
  if (conflicts.length > 0) {
    throw new PickValidationError(
      `You've already picked ${conflicts.length} of these players earlier in this tournament.`
    );
  }

  if (doublePlayTournamentPlayerId) {
    const alreadyUsedToken = await hasUsedDoublePlayThisTournament({
      memberId,
      tournamentId: round.tournament_id,
      excludingRoundId: roundId,
    });
    if (alreadyUsedToken) {
      throw new PickValidationError(
        "Your Double Play token has already been used in another round this tournament."
      );
    }
  }

  // Clear any existing picks for this member/round, then insert fresh.
  // (Simplifies "edit my picks before lock" flows into one operation.)
  await query(`delete from picks where round_id = $1 and member_id = $2`, [roundId, memberId]);

  for (const playerId of tournamentPlayerIds) {
    const hasDoublePlay = playerId === doublePlayTournamentPlayerId;
    await query(
      `insert into picks (round_id, member_id, tournament_player_id, has_double_play)
       values ($1, $2, $3, $4)`,
      [roundId, memberId, playerId, hasDoublePlay]
    );
  }

  return { success: true, roundId, memberId, picks: tournamentPlayerIds };
}

/**
 * Swap a single picked player for another, within the same round.
 * Used when a picked player withdraws/doesn't start. The new player
 * must not be in the member's previously-used set for this tournament
 * (excluding the player being swapped out, who is being replaced
 * precisely because they didn't play).
 */
export async function swapPick({
  memberId,
  roundId,
  outgoingTournamentPlayerId,
  incomingTournamentPlayerId,
}: {
  memberId: string;
  roundId: string;
  outgoingTournamentPlayerId: string;
  incomingTournamentPlayerId: string;
}) {
  const existing = await query<{ id: string }>(
    `select id from picks where round_id = $1 and member_id = $2 and tournament_player_id = $3`,
    [roundId, memberId, outgoingTournamentPlayerId]
  );
  if (existing.rows.length === 0) {
    throw new PickValidationError("Original pick not found for this round.");
  }

  const roundRes = await query<{ tournament_id: string }>(
    `select tournament_id from rounds where id = $1`,
    [roundId]
  );
  const tournamentId = roundRes.rows[0]?.tournament_id;

  const previouslyUsed = await getPreviouslyUsedPlayers({
    memberId,
    tournamentId,
    excludingRoundId: roundId,
  });
  if (previouslyUsed.has(incomingTournamentPlayerId)) {
    throw new PickValidationError("You've already used this player earlier in the tournament.");
  }

  await query(
    `update picks
       set tournament_player_id = $1, is_swap = true, swapped_from_id = $2
     where round_id = $3 and member_id = $4 and tournament_player_id = $5`,
    [incomingTournamentPlayerId, outgoingTournamentPlayerId, roundId, memberId, outgoingTournamentPlayerId]
  );

  return { success: true };
}

/**
 * Whether this member has already assigned their Double Play token to
 * a pick in any OTHER round of this tournament. Used to block
 * assigning it again - the token is once-per-tournament, not
 * once-per-round.
 */
async function hasUsedDoublePlayThisTournament({
  memberId,
  tournamentId,
  excludingRoundId,
}: {
  memberId: string;
  tournamentId: string;
  excludingRoundId: string;
}): Promise<boolean> {
  const res = await query(
    `select 1 from picks p
       join rounds r on r.id = p.round_id
      where r.tournament_id = $1
        and p.member_id = $2
        and p.round_id != $3
        and p.has_double_play = true
      limit 1`,
    [tournamentId, memberId, excludingRoundId]
  );
  return res.rows.length > 0;
}

/**
 * Public status check for the frontend: has this member used their
 * Double Play token anywhere in this tournament yet, and if so, on
 * which player/round? Used to grey out the Double Play option once
 * spent, and to show where it was used.
 */
export async function getDoublePlayStatus(memberId: string, tournamentId: string) {
  const res = await query<{
    round_number: number;
    full_name: string;
    round_id: string;
    tournament_player_id: string;
  }>(
    `select r.round_number, tp.full_name, p.round_id, p.tournament_player_id
       from picks p
       join rounds r on r.id = p.round_id
       join tournament_players tp on tp.id = p.tournament_player_id
      where r.tournament_id = $1
        and p.member_id = $2
        and p.has_double_play = true
      limit 1`,
    [tournamentId, memberId]
  );
  if (res.rows.length === 0) {
    return { used: false as const };
  }
  return { used: true as const, ...res.rows[0] };
}

/**
 * Returns the set of tournament_player_ids this member has used in any
 * OTHER round of the same tournament. A player swapped OUT (replaced
 * before they recorded a score) is excluded from this set, since they
 * never actually played for the member.
 */
async function getPreviouslyUsedPlayers({
  memberId,
  tournamentId,
  excludingRoundId,
}: {
  memberId: string;
  tournamentId: string;
  excludingRoundId: string;
}): Promise<Set<string>> {
  const res = await query<{ tournament_player_id: string; swapped_from_id: string | null }>(
    `select p.tournament_player_id, p.swapped_from_id
       from picks p
       join rounds r on r.id = p.round_id
      where r.tournament_id = $1
        and p.member_id = $2
        and p.round_id != $3`,
    [tournamentId, memberId, excludingRoundId]
  );

  const used = new Set<string>();
  for (const row of res.rows) {
    used.add(row.tournament_player_id);
    // Note: swapped_from_id (the withdrawn original) is intentionally
    // NOT added here - it was never actually played, so it stays
    // unavailable only via tournament_players.is_active, not via this
    // "used" history.
  }
  return used;
}
