import { PickQualityDot, MAX_RING_REACH } from "./PickQualityDot";
import { LeaderboardTeam } from "../api/client";

interface TeamTimingSummaryProps {
  team: LeaderboardTeam;
  variant?: "light" | "dark";
  size?: number;
  gap?: number;
}

/**
 * ALL of a team's picks across the whole tournament, flattened into
 * one row of dots (up to 16: 4 rounds x 4 picks each) - a single
 * at-a-glance view of how good this team's timing has been overall,
 * without needing to expand every round individually. Each dot uses
 * the exact same field-adjusted quality logic as the per-round
 * sparkline, normalized against THAT dot's own player's other rounds
 * (not against the other dots in this row) - the pick ring itself is
 * skipped here since every dot already represents an actual pick, but
 * the Double Play ring and best-in-field star still apply.
 */
export function TeamTimingSummary({ team, variant = "light", size = 16, gap = 3 }: TeamTimingSummaryProps) {
  const dots = team.rounds.flatMap((round) =>
    round.picks.map((pick) => {
      const own = pick.playerRoundScores;
      const thisRound = own.find((r) => r.roundNumber === round.roundNumber);
      const siblingMagnitudes = own.map((r) => r.scoreToPar - (r.fieldAvg ?? 0));
      return {
        key: `${round.roundNumber}-${pick.playerName}`,
        scoreToPar: pick.scoreToPar,
        fieldAvg: thisRound?.fieldAvg ?? null,
        fieldBest: thisRound?.fieldBest ?? null,
        siblingMagnitudes: siblingMagnitudes.length > 0 ? siblingMagnitudes : [0],
        hasDoublePlay: pick.hasDoublePlay,
      };
    })
  );

  if (dots.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap, padding: `${MAX_RING_REACH}px 0` }}>
      {dots.map((d) => (
        <PickQualityDot
          key={d.key}
          scoreToPar={d.scoreToPar}
          fieldAvg={d.fieldAvg}
          fieldBest={d.fieldBest}
          siblingMagnitudes={d.siblingMagnitudes}
          showDoublePlayRing={d.hasDoublePlay}
          size={size}
          variant={variant}
        />
      ))}
    </div>
  );
}
