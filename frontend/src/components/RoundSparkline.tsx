import { PickQualityDot, MAX_RING_REACH } from "./PickQualityDot";

interface RoundScoreEntry {
  roundNumber: number;
  scoreToPar: number;
  fieldAvg?: number | null;
  fieldBest?: number | null;
}

interface RoundSparklineProps {
  /** This player's round-by-round scores for the WHOLE tournament so far. */
  roundScores: RoundScoreEntry[];
  /** Which round to ring as "the one this pick was actually for". */
  highlightRound?: number;
  /** Was the DOUBLE PLAY token used on the highlighted round - shows a second, outer ring when true. */
  highlightHasDoublePlay?: boolean;
  /** Fixed width/height of each round's SLOT - the actual filled circle is centered within this and may be smaller, but the slot itself (and therefore every circle's center point) never moves. */
  size?: number;
  gap?: number;
  /** "dark" for the app's dark forest-green backgrounds, "light" for the pale expanded-row background on the leaderboard. */
  variant?: "light" | "dark";
}

/**
 * Round-by-round history as a row of filled circles rather than a
 * line graph - each circle's SIZE and OPACITY both scale with how
 * good that round was FIELD-ADJUSTED (relative to the whole field's
 * average that day), so a gritty round on a brutal scoring day reads
 * as big/vivid, and a hollow-looking score on a day everyone shot low
 * reads as small/faint. Same field-adjusted logic Timing Score uses.
 *
 * Each round gets a fixed-size SLOT (width/height = size) with the
 * actual filled circle centered inside it (see PickQualityDot), so
 * every round lines up at a constant horizontal position independent
 * of its neighbors' sizes.
 *
 * Renders nothing with fewer than 2 rounds - a single round has
 * nothing to compare itself against.
 */
export function RoundSparkline({
  roundScores,
  highlightRound,
  highlightHasDoublePlay,
  size = 22,
  gap = 4,
  variant = "dark",
}: RoundSparklineProps) {
  if (roundScores.length < 2) return null;

  const sorted = [...roundScores].sort((a, b) => a.roundNumber - b.roundNumber);
  const siblingMagnitudes = sorted.map((r) => r.scoreToPar - (r.fieldAvg ?? 0));

  return (
    <div style={{ display: "flex", alignItems: "center", gap, flexShrink: 0, padding: `${MAX_RING_REACH}px 0` }}>
      {sorted.map((r) => {
        const isHighlighted = r.roundNumber === highlightRound;
        return (
          <div key={r.roundNumber} title={`Round ${r.roundNumber}`} style={{ flexShrink: 0 }}>
            <PickQualityDot
              scoreToPar={r.scoreToPar}
              fieldAvg={r.fieldAvg}
              fieldBest={r.fieldBest}
              siblingMagnitudes={siblingMagnitudes}
              showPickRing={isHighlighted}
              showDoublePlayRing={isHighlighted && !!highlightHasDoublePlay}
              size={size}
              variant={variant}
            />
          </div>
        );
      })}
    </div>
  );
}
