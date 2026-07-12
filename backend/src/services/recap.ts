import { query } from "../db/client";

export interface RecapAward {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

export interface TournamentRecap {
  available: boolean;
  tournamentName?: string;
  champion?: { teamName: string; total: number };
  awards: RecapAward[];
}

function scorePhrase(n: number): string {
  return n === 0 ? "even par" : n < 0 ? `${n}` : `+${n}`;
}

/**
 * "Awards ceremony" recap for a COMPLETED tournament - reuses the same
 * field-adjusted comparison philosophy as Hot Hand Score and the
 * headlines feed (a pick is judged relative to that day's field
 * average and that player's own other rounds, not raw numbers alone),
 * applied across the whole tournament instead of just the live round.
 *
 * Self-contained rather than sharing code with the leaderboard
 * endpoint's timing calculation - both compute similar things, but
 * keeping this isolated means building/tweaking the recap can't
 * accidentally regress the leaderboard's live Hot Hand Score, which
 * people are relying on mid-tournament.
 */
export async function generateRecap(leagueId: string): Promise<TournamentRecap> {
  const tournamentResult = await query<{ id: string; name: string; status: string }>(
    `select id, name, status from tournaments where league_id = $1 order by created_at desc limit 1`,
    [leagueId]
  );
  const tournament = tournamentResult.rows[0];
  if (!tournament || tournament.status !== "completed") {
    return { available: false, awards: [] };
  }
  const tournamentId = tournament.id;

  // Champion
  const standings = await query<{ team_name: string; total_to_par: string }>(
    `select team_name, total_to_par from tournament_standings where tournament_id = $1 order by total_to_par asc`,
    [tournamentId]
  );
  const champion = standings.rows[0]
    ? { teamName: standings.rows[0].team_name, total: Number(standings.rows[0].total_to_par) }
    : undefined;

  const awards: RecapAward[] = [];

  // Closest finish - fun fact if the top 2 were tight.
  if (standings.rows.length >= 2) {
    const margin = Number(standings.rows[1].total_to_par) - Number(standings.rows[0].total_to_par);
    if (margin <= 2) {
      awards.push({
        id: "closest-finish",
        emoji: "🤏",
        title: "Nail-Biter",
        description: `${standings.rows[0].team_name} held off ${standings.rows[1].team_name} by just ${margin} shot${
          margin === 1 ? "" : "s"
        }.`,
      });
    }
  }

  // All picks for the whole tournament, completed rounds only.
  const picksResult = await query<{
    member_id: string;
    team_name: string;
    player_name: string;
    round_number: number;
    score_to_par: number;
    effective_score_to_par: number;
    has_double_play: boolean;
    player_status: string;
  }>(
    `select ps.member_id, m.team_name, ps.player_name, ps.round_number, ps.score_to_par,
            ps.effective_score_to_par, ps.has_double_play, ps.player_status
       from pick_scores ps
       join members m on m.id = ps.member_id
      where ps.tournament_id = $1`,
    [tournamentId]
  );
  const picks = picksResult.rows;
  const completedPicks = picks.filter((p) => p.player_status === "completed");

  // Field average per round, for field-adjusted comparisons.
  const fieldAvgResult = await query<{ round_number: number; field_avg: string }>(
    `select r.round_number, avg(prs.score_to_par) as field_avg
       from player_round_scores prs
       join rounds r on r.id = prs.round_id
      where r.tournament_id = $1 and prs.score_to_par is not null
      group by r.round_number`,
    [tournamentId]
  );
  const fieldAvgByRound = new Map<number, number>(fieldAvgResult.rows.map((r) => [r.round_number, Number(r.field_avg)]));

  function fieldAdjusted(p: { round_number: number; score_to_par: number }): number {
    return p.score_to_par - (fieldAvgByRound.get(p.round_number) ?? 0);
  }

  // Best/worst single round among all picks, field-adjusted.
  if (completedPicks.length > 0) {
    const best = completedPicks.reduce((b, p) => (fieldAdjusted(p) < fieldAdjusted(b) ? p : b));
    awards.push({
      id: "best-round",
      emoji: "🌟",
      title: "Round of the Week",
      description: `${best.team_name}'s pick of ${best.player_name} shot ${scorePhrase(
        best.score_to_par
      )} in round ${best.round_number} - the best round anyone in the league captured.`,
    });

    const worst = completedPicks.reduce((w, p) => (fieldAdjusted(p) > fieldAdjusted(w) ? p : w));
    awards.push({
      id: "worst-round",
      emoji: "🪦",
      title: "Rough Beat",
      description: `${worst.team_name}'s pick of ${worst.player_name} shot ${scorePhrase(
        worst.score_to_par
      )} in round ${worst.round_number} - painful timing.`,
    });
  }

  // Double Play picks specifically - best and worst.
  const doublePlayPicks = completedPicks.filter((p) => p.has_double_play);
  if (doublePlayPicks.length > 0) {
    const bestDp = doublePlayPicks.reduce((b, p) => (p.score_to_par < b.score_to_par ? p : b));
    awards.push({
      id: "best-double-play",
      emoji: "🎰",
      title: "Best Gamble",
      description: `${bestDp.team_name} doubled up on ${bestDp.player_name}'s ${scorePhrase(
        bestDp.score_to_par
      )} in round ${bestDp.round_number} - the token that paid off biggest.`,
    });

    const worstDp = doublePlayPicks.reduce((w, p) => (p.score_to_par > w.score_to_par ? p : w));
    if (worstDp.score_to_par > 0) {
      awards.push({
        id: "worst-double-play",
        emoji: "💸",
        title: "Worst Gamble",
        description: `${worstDp.team_name} doubled up on ${worstDp.player_name}, who shot ${scorePhrase(
          worstDp.score_to_par
        )} in round ${worstDp.round_number} - a token they'd like back.`,
      });
    }
  }

  // Double Play + missed cut - worst possible timing, separate from
  // the general "worst gamble" since a cut is a different kind of
  // disaster than just a bad score.
  const dpCutDisaster = picks.find((p) => p.has_double_play && p.player_status === "missed_cut");
  if (dpCutDisaster) {
    awards.push({
      id: "dp-cut-disaster",
      emoji: "💀",
      title: "Worst Possible Timing",
      description: `${dpCutDisaster.team_name} played their Double Play token on ${dpCutDisaster.player_name}, who missed the cut.`,
    });
  }

  // Hot Hand Score champion/cold hand - same field-adjusted-rank
  // logic as the live leaderboard version, computed independently
  // here for the whole tournament.
  const roundsByPlayerKey = new Map<string, { round_number: number; score_to_par: number }[]>();
  for (const p of completedPicks) {
    const key = p.player_name; // player_name is unique enough within one tournament's field for this purpose
    const list = roundsByPlayerKey.get(key) ?? [];
    list.push({ round_number: p.round_number, score_to_par: p.score_to_par });
    roundsByPlayerKey.set(key, list);
  }
  const timingByTeam = new Map<string, { teamName: string; qualities: number[] }>();
  for (const p of completedPicks) {
    const rounds = roundsByPlayerKey.get(p.player_name);
    if (!rounds || rounds.length < 2) continue;
    const adjustedRounds = rounds.map((r) => fieldAdjusted(r));
    const best = Math.min(...adjustedRounds);
    const worst = Math.max(...adjustedRounds);
    const range = worst - best || 1;
    const quality = 1 - (fieldAdjusted(p) - best) / range;
    const entry = timingByTeam.get(p.member_id) ?? { teamName: p.team_name, qualities: [] };
    entry.qualities.push(quality);
    timingByTeam.set(p.member_id, entry);
  }
  const timingScores = Array.from(timingByTeam.values())
    .filter((t) => t.qualities.length >= 2)
    .map((t) => ({
      teamName: t.teamName,
      score: Math.round((t.qualities.reduce((s, q) => s + q, 0) / t.qualities.length) * 100),
    }));
  if (timingScores.length > 0) {
    const hottest = timingScores.reduce((b, t) => (t.score > b.score ? t : b));
    awards.push({
      id: "hot-hand",
      emoji: "🔥",
      title: "Hot Hand Champion",
      description: `${hottest.teamName} led the league with a ${hottest.score} Hot Hand Score - consistently catching players at the right time.`,
    });
    const coldest = timingScores.reduce((w, t) => (t.score < w.score ? t : w));
    if (coldest.teamName !== hottest.teamName) {
      awards.push({
        id: "cold-hand",
        emoji: "🥶",
        title: "Ice Cold",
        description: `${coldest.teamName} had the toughest timing in the league at a ${coldest.score} Hot Hand Score.`,
      });
    }
  }

  return {
    available: true,
    tournamentName: tournament.name,
    champion,
    awards: awards.sort((a, b) => (a.id === "champion" ? -1 : 0)),
  };
}
