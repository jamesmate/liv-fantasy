import { query } from "../db/client";

export interface Headline {
  id: string; // stable-ish key for the frontend list
  text: string;
  emoji: string;
  priority: number; // higher = more interesting, used for sort order
}

interface LivePick {
  memberId: string;
  teamName: string;
  playerName: string;
  scoreToPar: number;
  effectiveScoreToPar: number;
  hasDoublePlay: boolean;
  status: string;
  thru: number | null;
  roundNumber: number;
}

/**
 * Auto-generated headlines about what's happening in the CURRENT live
 * round of a tournament - double plays paying off or backfiring, who's
 * leading the field right now, missed-cut disasters, and which team's
 * currently having the best round. Regenerated fresh on every request
 * rather than stored, since it's entirely derived from data that's
 * already being synced from ESPN - there's nothing here that needs
 * persisting separately.
 *
 * Deliberately scoped to the picks THIS LEAGUE'S teams actually made
 * (not the whole ESPN field) - a league-specific news feed about their
 * own picks is more relevant than general tournament news they could
 * get from ESPN itself.
 */
export async function generateHeadlines(tournamentId: string): Promise<Headline[]> {
  // "Current round" = the highest round number that has ANY live score
  // data yet, used as a proxy for "the round actually being played
  // right now" - rounds.status isn't reliably updated, so this is a
  // steadier signal than trusting that column.
  const currentRoundResult = await query<{ current_round: number | null }>(
    `select max(r.round_number) as current_round
       from player_round_scores prs
       join rounds r on r.id = prs.round_id
      where r.tournament_id = $1 and prs.score_to_par is not null`,
    [tournamentId]
  );
  const currentRound = currentRoundResult.rows[0]?.current_round;
  if (!currentRound) return [];

  const picksResult = await query<{
    member_id: string;
    team_name: string;
    player_name: string;
    score_to_par: number;
    effective_score_to_par: number;
    has_double_play: boolean;
    player_status: string;
    thru: number | null;
    round_number: number;
  }>(
    `select ps.member_id, m.team_name, ps.player_name, ps.score_to_par, ps.effective_score_to_par,
            ps.has_double_play, ps.player_status, prs.thru, ps.round_number
       from pick_scores ps
       join members m on m.id = ps.member_id
       left join player_round_scores prs
         on prs.tournament_player_id = ps.tournament_player_id and prs.round_id = ps.round_id
      where ps.tournament_id = $1 and ps.round_number = $2`,
    [tournamentId, currentRound]
  );

  const picks: LivePick[] = picksResult.rows.map((r) => ({
    memberId: r.member_id,
    teamName: r.team_name,
    playerName: r.player_name,
    scoreToPar: r.score_to_par,
    effectiveScoreToPar: r.effective_score_to_par,
    hasDoublePlay: r.has_double_play,
    status: r.player_status,
    thru: r.thru,
    roundNumber: r.round_number,
  }));

  const headlines: Headline[] = [];

  function holesPhrase(thru: number | null): string {
    if (thru === null || thru <= 0) return "";
    if (thru >= 18) return "";
    return ` with ${18 - thru} holes to play`;
  }
  function scorePhrase(n: number): string {
    return n === 0 ? "even par" : n < 0 ? `${n}` : `+${n}`;
  }

  // Double Play paying off - in progress, currently well under par.
  for (const p of picks) {
    if (p.hasDoublePlay && p.status === "in_progress" && p.scoreToPar <= -3) {
      headlines.push({
        id: `dp-good-${p.memberId}-${p.roundNumber}`,
        emoji: "🔥",
        priority: 90 + Math.abs(p.scoreToPar),
        text: `${p.teamName} doubled up on ${p.playerName}, who's firing ${scorePhrase(
          p.scoreToPar
        )}${holesPhrase(p.thru)}!`,
      });
    }
  }

  // Double Play backfiring - in progress, currently well over par.
  for (const p of picks) {
    if (p.hasDoublePlay && p.status === "in_progress" && p.scoreToPar >= 3) {
      headlines.push({
        id: `dp-bad-${p.memberId}-${p.roundNumber}`,
        emoji: "😬",
        priority: 70 + p.scoreToPar,
        text: `Rough moment for ${p.teamName} - their doubled pick ${p.playerName} is at ${scorePhrase(
          p.scoreToPar
        )}${holesPhrase(p.thru)}.`,
      });
    }
  }

  // Double Play + missed cut - the worst possible timing.
  for (const p of picks) {
    if (p.hasDoublePlay && p.status === "missed_cut") {
      headlines.push({
        id: `dp-cut-${p.memberId}-${p.roundNumber}`,
        emoji: "💀",
        priority: 95,
        text: `Brutal - ${p.teamName} played their Double Play token on ${p.playerName}, who just missed the cut.`,
      });
    }
  }

  // Leading the (picked) field right now, live.
  const inProgress = picks.filter((p) => p.status === "in_progress");
  if (inProgress.length > 0) {
    const leader = inProgress.reduce((best, p) => (p.scoreToPar < best.scoreToPar ? p : best));
    headlines.push({
      id: `leader-${leader.memberId}-${leader.roundNumber}`,
      emoji: "⭐",
      priority: 60,
      text: `${leader.teamName}'s ${leader.playerName} leads the way among all picked players at ${scorePhrase(
        leader.scoreToPar
      )}${holesPhrase(leader.thru)}.`,
    });
  }

  // Which team currently has the best combined score for THIS round
  // (only counting picks that have actually started, so an empty
  // round doesn't produce a misleading "leader").
  const totalsByTeam = new Map<string, { teamName: string; total: number; count: number }>();
  for (const p of picks) {
    if (p.status === "not_started") continue;
    const entry = totalsByTeam.get(p.memberId) ?? { teamName: p.teamName, total: 0, count: 0 };
    entry.total += p.effectiveScoreToPar;
    entry.count += 1;
    totalsByTeam.set(p.memberId, entry);
  }
  const teamTotals = Array.from(totalsByTeam.values()).filter((t) => t.count > 0);
  if (teamTotals.length > 1) {
    const roundLeader = teamTotals.reduce((best, t) => (t.total < best.total ? t : best));
    headlines.push({
      id: `round-leader-${roundLeader.teamName}-${currentRound}`,
      emoji: "📈",
      priority: 50,
      text: `${roundLeader.teamName} currently has the best round ${currentRound} total among all teams at ${scorePhrase(
        roundLeader.total
      )}.`,
    });
  }

  return headlines.sort((a, b) => b.priority - a.priority).slice(0, 8);
}
