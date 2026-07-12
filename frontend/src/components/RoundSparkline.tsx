interface RoundSparklineProps {
  /** This player's round-by-round scores for the WHOLE tournament so far. */
  roundScores: { roundNumber: number; scoreToPar: number }[];
  /** Which round to highlight as "the one this pick was actually for". */
  highlightRound?: number;
  width?: number;
  height?: number;
  /** "dark" for use on the app's dark forest-green backgrounds, "light" for the pale expanded-row background on the leaderboard. */
  variant?: "light" | "dark";
}

/**
 * Tiny inline line chart of a player's round-by-round scores, with
 * one round highlighted - the point of this widget is answering "did
 * this pick catch their good round or their bad one" at a glance.
 * Renders nothing if there's only 0-1 rounds to plot (a single point
 * has no line worth drawing and no "relative to what" story to tell).
 */
export function RoundSparkline({
  roundScores,
  highlightRound,
  width = 60,
  height = 20,
  variant = "dark",
}: RoundSparklineProps) {
  if (roundScores.length < 2) return null;

  const lineColor = variant === "dark" ? "rgba(255,255,255,0.35)" : "rgba(30,60,45,0.3)";
  const dotColor = variant === "dark" ? "rgba(255,255,255,0.5)" : "rgba(30,60,45,0.45)";
  const highlightStroke = variant === "dark" ? "#fff" : "#1e3c2d";

  const sorted = [...roundScores].sort((a, b) => a.roundNumber - b.roundNumber);
  const values = sorted.map((r) => r.scoreToPar);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // avoid divide-by-zero when every round was the same score

  const pad = 3;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  const points = sorted.map((r, i) => {
    const x = pad + (sorted.length === 1 ? usableW / 2 : (i / (sorted.length - 1)) * usableW);
    // Golf scoring: lower is better, so a lower score_to_par should
    // sit HIGHER on the sparkline (inverted y).
    const y = pad + ((r.scoreToPar - min) / range) * usableH;
    return { x, y, roundNumber: r.roundNumber, scoreToPar: r.scoreToPar };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }}>
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth={1.5} />
      {points.map((p) => {
        const isHighlighted = p.roundNumber === highlightRound;
        return (
          <circle
            key={p.roundNumber}
            cx={p.x}
            cy={p.y}
            r={isHighlighted ? 3 : 1.6}
            fill={isHighlighted ? "#f5a623" : dotColor}
            stroke={isHighlighted ? highlightStroke : "none"}
            strokeWidth={isHighlighted ? 1 : 0}
          />
        );
      })}
    </svg>
  );
}
