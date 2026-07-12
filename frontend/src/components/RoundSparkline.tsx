interface RoundScoreEntry {
  roundNumber: number;
  scoreToPar: number;
  fieldAvg?: number | null;
}

interface RoundSparklineProps {
  /** This player's round-by-round scores for the WHOLE tournament so far. */
  roundScores: RoundScoreEntry[];
  /** Which round to ring as "the one this pick was actually for". */
  highlightRound?: number;
  /** Fixed width/height of each round's SLOT - the actual filled circle is centered within this and may be smaller, but the slot itself (and therefore every circle's center point) never moves. */
  size?: number;
  gap?: number;
  /** "dark" for the app's dark forest-green backgrounds, "light" for the pale expanded-row background on the leaderboard. */
  variant?: "light" | "dark";
}

// Same red-neutral-green gradient used elsewhere in the app (the
// round-score chips on the pick list) - kept local here rather than a
// shared import since the two call sites color slightly different
// underlying values (raw score there, field-adjusted here).
function getScoreColor(magnitude: number): string {
  const clamped = Math.max(-5, Math.min(5, magnitude));
  const deepGreen: [number, number, number] = [22, 120, 62];
  const neutral: [number, number, number] = [230, 227, 218];
  const deepRed: [number, number, number] = [150, 24, 24];
  const [from, to, t] =
    clamped <= 0 ? [deepGreen, neutral, (clamped + 5) / 5] : [neutral, deepRed, clamped / 5];
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Round-by-round history as a row of filled circles rather than a
 * line graph - each circle's SIZE and OPACITY both scale with how
 * good that round was FIELD-ADJUSTED (relative to the whole field's
 * average that day, not the raw score), so a gritty +2 on a brutal
 * scoring day reads as big/vivid, and a hollow-looking -1 on a day
 * everyone shot low reads as small/faint. This is deliberately the
 * same field-adjusted logic Timing Score uses, so the two always
 * agree with each other.
 *
 * Each round gets a fixed-size SLOT (width/height = size) with the
 * actual filled circle centered inside it - the circle itself can be
 * smaller than the slot, but the slot's center never moves regardless
 * of any circle's size, so every round lines up at a constant
 * horizontal position independent of its neighbors.
 *
 * The round this pick was actually FOR gets a ring - drawn on the
 * OUTER slot, not the inner faded circle, so the ring stays at a
 * constant opacity no matter how faint that round's own circle is.
 *
 * Renders nothing with fewer than 2 rounds - a single round has
 * nothing to compare itself against.
 */
export function RoundSparkline({
  roundScores,
  highlightRound,
  size = 22,
  gap = 4,
  variant = "dark",
}: RoundSparklineProps) {
  if (roundScores.length < 2) return null;

  const sorted = [...roundScores].sort((a, b) => a.roundNumber - b.roundNumber);

  // Field-adjusted magnitude: how much better/worse than that day's
  // field average. Falls back to the raw score if field average
  // isn't available for some reason, rather than breaking.
  const magnitudes = sorted.map((r) => r.scoreToPar - (r.fieldAvg ?? 0));
  const best = Math.min(...magnitudes); // most negative = best
  const worst = Math.max(...magnitudes);
  const range = worst - best || 1;

  const minScale = 0.55; // smallest circle, for their worst round
  const maxScale = 1.0; // largest circle, for their best round
  const minOpacity = 0.5;
  const maxOpacity = 1.0;

  const ringColor = variant === "dark" ? "#fff" : "#1e3c2d";

  return (
    <div style={{ display: "flex", alignItems: "center", gap, flexShrink: 0 }}>
      {sorted.map((r, i) => {
        const magnitude = magnitudes[i];
        // quality: 1 = their best round, 0 = their worst
        const quality = 1 - (magnitude - best) / range;
        const scale = minScale + quality * (maxScale - minScale);
        const opacity = minOpacity + quality * (maxOpacity - minOpacity);
        const diameter = size * scale;
        const isHighlighted = r.roundNumber === highlightRound;
        const bg = getScoreColor(magnitude);

        return (
          // Fixed-size outer slot: this is what carries the ring
          // (constant opacity) and what fixes this round's center
          // position, regardless of the inner circle's own size.
          <div
            key={r.roundNumber}
            title={`Round ${r.roundNumber}`}
            style={{
              width: size,
              height: size,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              outline: isHighlighted ? `2px solid ${ringColor}` : "none",
              outlineOffset: isHighlighted ? 2 : 0,
              borderRadius: "50%",
            }}
          >
            {/* Inner filled circle: this is what fades - opacity
                lives here only, never on the outer ringed slot. */}
            <div
              style={{
                width: diameter,
                height: diameter,
                borderRadius: "50%",
                backgroundColor: bg,
                opacity,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
