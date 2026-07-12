import { query } from "../db/client";

export interface TeamHotHandScore {
  memberId: string;
  teamName: string;
  score: number; // 0-100
  qualifyingPicks: number;
}

/**
 * Computes each team's Hot Hand Score for ONE tournament - same
 * field-adjusted-rank logic used everywhere else this concept
 * appears (the live leaderboard, the recap): a pick is compared to
 * that round's field average, then ranked against that SAME player's
 * other rounds in the tournament. Extracted here as a shared function
 * since three different places now need this (live leaderboard,
 * end-of-tournament recap, and persistent career stats) - keeping one
 * source of truth means they can't quietly drift out of agreement
 * with each other.
 */
export async function computeTournamentHotHandScores(tournamentId: string): Promise<TeamHotHandScore[]> {
  const picksResult = await query<{
    member_id: string;
    team_name: string;
    player_name: string;
    round_number: number;
    score_to_par: number;
    player_status: string;
  }>(
    `select ps.member_id, m.team_name, ps.player_name, ps.round_number, ps.score_to_par, ps.player_status
       from pick_scores ps
       join members m on m.id = ps.member_id
      where ps.tournament_id = $1`,
    [tournamentId]
  );
  const completedPicks = picksResult.rows.filter((p) => p.player_status === "completed");
  if (completedPicks.length === 0) return [];

  const fieldAvgResult = await query<{ round_number: number; field_avg: string }>(
    `select r.round_number, avg(prs.score_to_par) as field_avg
       from player_round_scores prs
       join rounds r on r.id = prs.round_id
      where r.tournament_id = $1 and prs.score_to_par is not null
      group by r.round_number`,
    [tournamentId]
  );
  const fieldAvgByRound = new Map<number, number>(fieldAvgResult.rows.map((r) => [r.round_number, Number(r.field_avg)]));
  const fieldAdjusted = (p: { round_number: number; score_to_par: number }) =>
    p.score_to_par - (fieldAvgByRound.get(p.round_number) ?? 0);

  const roundsByPlayer = new Map<string, { round_number: number; score_to_par: number }[]>();
  for (const p of completedPicks) {
    const list = roundsByPlayer.get(p.player_name) ?? [];
    list.push({ round_number: p.round_number, score_to_par: p.score_to_par });
    roundsByPlayer.set(p.player_name, list);
  }

  const byTeam = new Map<string, { teamName: string; qualities: number[] }>();
  for (const p of completedPicks) {
    const rounds = roundsByPlayer.get(p.player_name);
    if (!rounds || rounds.length < 2) continue;
    const adjustedRounds = rounds.map(fieldAdjusted);
    const best = Math.min(...adjustedRounds);
    const worst = Math.max(...adjustedRounds);
    const range = worst - best || 1;
    const quality = 1 - (fieldAdjusted(p) - best) / range;
    const entry = byTeam.get(p.member_id) ?? { teamName: p.team_name, qualities: [] };
    entry.qualities.push(quality);
    byTeam.set(p.member_id, entry);
  }

  return Array.from(byTeam.entries())
    .filter(([, t]) => t.qualities.length >= 2)
    .map(([memberId, t]) => ({
      memberId,
      teamName: t.teamName,
      score: Math.round((t.qualities.reduce((s, q) => s + q, 0) / t.qualities.length) * 100),
      qualifyingPicks: t.qualities.length,
    }));
}
