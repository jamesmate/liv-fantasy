/**
 * Tournament Results Service
 * ---------------------------
 * Called when a tournament's status transitions to 'completed'.
 * Snapshots each member's final score from `tournament_standings` into
 * the permanent `tournament_results` ledger, which is what
 * `career_standings` aggregates across a team's whole history in the
 * league. This is what makes wins/career totals survive even though
 * `picks` and `player_round_scores` stay tournament-scoped.
 *
 * Idempotent: re-running for an already-finalized tournament replaces
 * its rows rather than duplicating them, so accidentally toggling a
 * tournament's status back and forth doesn't double-count results.
 */

import { query, withTransaction } from "../db/client";

export class ResultsError extends Error {}

const WIN_POINTS = 500;
const POINTS_CURVE_EXPONENT = 1.5; // higher = more top-heavy; 1 = linear spread
const PARTICIPATION_FLOOR = 20; // nobody who finished gets a literal zero

/**
 * Field-size-scaled points for a given placement, out of a given
 * field size. 1st always earns WIN_POINTS regardless of how many
 * teams played - a fixed lookup table (1st=500, 2nd=300...) breaks
 * down as the league's team count changes over time, either running
 * out of entries for a bigger field or rewarding beating 5 teams the
 * same as beating 9. Scaling by field size means the points system
 * works the same whether the league has 4 teams or 40, with no table
 * to maintain as it grows.
 */
function calculatePoints(placement: number, fieldSize: number): number {
  if (fieldSize <= 1) return WIN_POINTS;
  const raw = WIN_POINTS * Math.pow((fieldSize - placement) / (fieldSize - 1), POINTS_CURVE_EXPONENT);
  return Math.max(PARTICIPATION_FLOOR, Math.round(raw));
}

export async function finalizeTournamentResults(tournamentId: string) {
  const standings = await query<{
    member_id: string;
    team_name: string;
    total_to_par: number;
  }>(
    `select member_id, team_name, total_to_par
       from tournament_standings
      where tournament_id = $1
      order by total_to_par asc`,
    [tournamentId]
  );

  if (standings.rows.length === 0) {
    throw new ResultsError(
      "No standings found for this tournament - make sure picks were made and scores recorded before completing it."
    );
  }

  const tournament = await query<{ league_id: string }>(
    `select league_id from tournaments where id = $1`,
    [tournamentId]
  );
  const leagueId = tournament.rows[0]?.league_id;
  if (!leagueId) throw new ResultsError("Tournament not found.");

  const bestScore = standings.rows[0].total_to_par;

  // Bonus pick points earned across the WHOLE tournament (all rounds
  // summed), per member - these get ADDED on top of placement points,
  // not blended into total_to_par/placement itself (see the "how
  // should bonus points affect your score" decision: they only affect
  // league standings points, never actual strokes/placement).
  const bonusPointsResult = await query<{ member_id: string; bonus_total: string }>(
    `select bp.member_id, sum(bp.points) as bonus_total
       from bonus_picks bp
       join rounds r on r.id = bp.round_id
      where r.tournament_id = $1
      group by bp.member_id`,
    [tournamentId]
  );
  const bonusPointsByMember = new Map<string, number>(
    bonusPointsResult.rows.map((r) => [r.member_id, Number(r.bonus_total)])
  );

  await withTransaction(async (client) => {
    // Clear any prior finalization for this tournament so re-running is safe.
    await client.query(`delete from tournament_results where tournament_id = $1`, [tournamentId]);

    // Standard competition ranking: tied scores share the same
    // placement (e.g. two teams tied for best score are both placement
    // 1), and the next distinct score jumps to the row count so far
    // + 1 (e.g. 1, 1, 3 - not 1, 1, 2). Without this, a tie for 1st
    // would have one team correctly marked is_win=true but recorded
    // with placement=2, putting them in "2nd place" on the podium
    // standings despite having won - placement and is_win need to
    // agree with each other.
    let previousScore: number | null = null;
    let previousPlacement = 0;
    let rowsSeen = 0;

    for (const row of standings.rows) {
      rowsSeen++;
      const placement =
        previousScore !== null && row.total_to_par === previousScore
          ? previousPlacement
          : rowsSeen;
      previousScore = row.total_to_par;
      previousPlacement = placement;

      const isWin = row.total_to_par === bestScore;
      const placementPoints = calculatePoints(placement, standings.rows.length);
      const bonusPoints = bonusPointsByMember.get(row.member_id) ?? 0;
      const points = placementPoints + bonusPoints;
      await client.query(
        `insert into tournament_results
           (tournament_id, league_id, member_id, team_name, total_to_par, placement, is_win, points)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tournamentId, leagueId, row.member_id, row.team_name, row.total_to_par, placement, isWin, points]
      );
    }
  });

  return { finalized: standings.rows.length };
}

/**
 * Lets the league owner override which team(s) are credited with the
 * win for an already-finalized tournament (e.g. correcting a manual
 * scoring dispute or a tie-break decision). Setting isWin=true on one
 * team does NOT automatically unset others - ties are allowed to both
 * be wins unless the owner explicitly unsets one.
 */
export async function overrideTournamentWin(
  tournamentId: string,
  memberId: string,
  isWin: boolean
) {
  const result = await query(
    `update tournament_results
        set is_win = $1, win_overridden_by_owner = true
      where tournament_id = $2 and member_id = $3
      returning *`,
    [isWin, tournamentId, memberId]
  );
  if (result.rows.length === 0) {
    throw new ResultsError("No result found for this member in this tournament.");
  }
  return result.rows[0];
}
