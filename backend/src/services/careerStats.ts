import { query, withTransaction } from "../db/client";
import { computeTournamentHotHandScores } from "./hotHandScore";

/**
 * Updates each member's PERSISTENT career stats after a tournament is
 * finalized (status -> completed). Called alongside
 * finalizeTournamentResults, not instead of it - that function
 * handles wins/placements, this one handles the "fun stats" (Hot
 * Hand Score history, favourite player, personal bests).
 *
 * Deliberately a running sum+count for the average (not a stored
 * average) so each new tournament just adds to the existing totals
 * rather than needing to re-derive history. "Best ever" fields only
 * update when this tournament's result actually beats the standing
 * record, so they naturally persist across a team's whole history in
 * the league.
 *
 * Favourite player is the one exception that IS fully recomputed each
 * time, since it depends on the member's ENTIRE pick history (not
 * just this tournament) and there's no cheap way to update a
 * running tally without re-scanning anyway - `picks` stays small
 * enough for a small friends' league that this isn't a concern.
 */
export async function updateMemberCareerStats(tournamentId: string) {
  const tournament = await query<{ name: string }>(`select name from tournaments where id = $1`, [tournamentId]);
  const tournamentName = tournament.rows[0]?.name ?? "Unknown tournament";

  const hotHandScores = await computeTournamentHotHandScores(tournamentId);

  const bestRoundResult = await query<{ member_id: string; best_round_score: number; round_number: number }>(
    `select member_id, min(score_to_par) as best_round_score,
            (array_agg(round_number order by score_to_par asc))[1] as round_number
       from pick_scores
      where tournament_id = $1 and player_status = 'completed'
      group by member_id`,
    [tournamentId]
  );

  const memberIds = new Set<string>([
    ...hotHandScores.map((h) => h.memberId),
    ...bestRoundResult.rows.map((r) => r.member_id),
  ]);

  await withTransaction(async (client) => {
    for (const memberId of memberIds) {
      // Favourite player: recomputed from this member's ENTIRE pick
      // history (all tournaments), not just this one. Tie-broken by
      // whichever tied player contributed the better (lower)
      // cumulative effective score - "scored them the most points".
      const favourite = await client.query<{ player_name: string; use_count: string; total_effective: string }>(
        `select player_name, count(*) as use_count, sum(effective_score_to_par) as total_effective
           from pick_scores
          where member_id = $1
          group by player_name
          order by count(*) desc, sum(effective_score_to_par) asc
          limit 1`,
        [memberId]
      );

      const hotHand = hotHandScores.find((h) => h.memberId === memberId);
      const bestRound = bestRoundResult.rows.find((r) => r.member_id === memberId);

      const existing = await client.query<{
        tournaments_with_hot_hand: number;
        hot_hand_score_sum: number;
        best_hot_hand_score: number | null;
        best_round_score: number | null;
      }>(`select tournaments_with_hot_hand, hot_hand_score_sum, best_hot_hand_score, best_round_score
            from member_career_stats where member_id = $1`, [memberId]);
      const prev = existing.rows[0];

      const newTournamentsWithHotHand = (prev?.tournaments_with_hot_hand ?? 0) + (hotHand ? 1 : 0);
      const newHotHandSum = (prev?.hot_hand_score_sum ?? 0) + (hotHand?.score ?? 0);

      const isBestHotHand =
        hotHand && (prev?.best_hot_hand_score === null || prev?.best_hot_hand_score === undefined || hotHand.score > prev.best_hot_hand_score);
      const isBestRound =
        bestRound &&
        (prev?.best_round_score === null || prev?.best_round_score === undefined || bestRound.best_round_score < prev.best_round_score);

      await client.query(
        `insert into member_career_stats
           (member_id, tournaments_with_hot_hand, hot_hand_score_sum,
            best_hot_hand_score, best_hot_hand_tournament_name,
            best_round_score, best_round_tournament_name, best_round_number,
            favourite_player_name, favourite_player_use_count, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         on conflict (member_id) do update set
           tournaments_with_hot_hand = excluded.tournaments_with_hot_hand,
           hot_hand_score_sum = excluded.hot_hand_score_sum,
           best_hot_hand_score = coalesce(excluded.best_hot_hand_score, member_career_stats.best_hot_hand_score),
           best_hot_hand_tournament_name = coalesce(excluded.best_hot_hand_tournament_name, member_career_stats.best_hot_hand_tournament_name),
           best_round_score = coalesce(excluded.best_round_score, member_career_stats.best_round_score),
           best_round_tournament_name = coalesce(excluded.best_round_tournament_name, member_career_stats.best_round_tournament_name),
           best_round_number = coalesce(excluded.best_round_number, member_career_stats.best_round_number),
           favourite_player_name = excluded.favourite_player_name,
           favourite_player_use_count = excluded.favourite_player_use_count,
           updated_at = now()`,
        [
          memberId,
          newTournamentsWithHotHand,
          newHotHandSum,
          isBestHotHand ? hotHand!.score : null,
          isBestHotHand ? tournamentName : null,
          isBestRound ? bestRound!.best_round_score : null,
          isBestRound ? tournamentName : null,
          isBestRound ? bestRound!.round_number : null,
          favourite.rows[0]?.player_name ?? null,
          favourite.rows[0] ? Number(favourite.rows[0].use_count) : null,
        ]
      );
    }
  });
}
