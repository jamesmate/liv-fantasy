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
 * agree with each other. The round this pick was actually FOR gets a
 * ring around it. Renders nothing with fewer than 2 rounds - a single
 * round has nothing to compare itself against.
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

  const minScale = 0.62; // smallest circle, for their worst round
  const maxScale = 1.0; // largest circle, for their best round
  const minOpacity = 0.5;
  const maxOpacity = 1.0;

  const ringColor = variant === "dark" ? "#fff" : "#1e3c2d";
  const textColorDark = "#20291f";
  const textColorLight = "#ffffff";

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
        // Pick a readable text color against the fill - the gradient
        // swings from pale neutral to saturated dark green/red, so a
        // fixed text color won't read well across the whole range.
        const textColor = quality > 0.35 && quality < 0.65 ? textColorDark : textColorLight;

        return (
          <div
            key={r.roundNumber}
            title={`Round ${r.roundNumber}`}
            style={{
              width: diameter,
              height: diameter,
              borderRadius: "50%",
              backgroundColor: bg,
              opacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: isHighlighted ? `0 0 0 2px ${ringColor}` : "none",
            }}
          >
            <span
              style={{
                fontSize: Math.max(8, diameter * 0.42),
                fontWeight: 700,
                color: textColor,
                lineHeight: 1,
              }}
            >
              {r.scoreToPar === 0 ? "E" : r.scoreToPar > 0 ? `+${r.scoreToPar}` : r.scoreToPar}
            </span>
          </div>
        );
      })}
    </div>
  );
}
