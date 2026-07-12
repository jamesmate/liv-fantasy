import { IconStarFilled } from "@tabler/icons-react";

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

// Outline geometry, all in px. Two independently-offset outlines (not
// achievable with a single CSS `outline`, which only supports one) is
// why the highlighted round is built from two nested wrapper divs
// rather than one - each contributes its own ring at its own gap.
const RING_WIDTH = 1; // reduced from 2px
const RING1_GAP = 2; // gap between the filled circle and the pick ring
const RING2_GAP = 1; // gap between ring 1 and the double-play ring (measured from ring 1's outer edge)

// Extra space reserved around the WHOLE sparkline row so rings never
// bleed into the row above/below - sized for the worst case (double
// ring), not just whichever rounds actually have one, so every row's
// height stays consistent regardless of which picks are highlighted.
const MAX_RING_REACH = RING1_GAP + RING_WIDTH + RING2_GAP + RING_WIDTH; // 5px

/**
 * Round-by-round history as a row of filled circles rather than a
 * line graph - each circle's SIZE and OPACITY both scale with how
 * good that round was FIELD-ADJUSTED (relative to the whole field's
 * average that day), so a gritty round on a brutal scoring day reads
 * as big/vivid, and a hollow-looking score on a day everyone shot low
 * reads as small/faint. Same field-adjusted logic Timing Score uses.
 *
 * Each round gets a fixed-size SLOT (width/height = size) with the
 * actual filled circle centered inside it, so every round lines up at
 * a constant horizontal position independent of its neighbors' sizes.
 *
 * The round this pick was actually FOR gets a ring, drawn on an outer
 * wrapper (not the faded inner circle) so the ring stays a constant
 * opacity regardless of how faint that round's own circle is. If the
 * Double Play token was used on that round, a second ring appears
 * further out. If that round was the single best score in the WHOLE
 * field that day, a small trophy shows inside the circle.
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

  const magnitudes = sorted.map((r) => r.scoreToPar - (r.fieldAvg ?? 0));
  const best = Math.min(...magnitudes);
  const worst = Math.max(...magnitudes);
  const range = worst - best || 1;

  const minScale = 0.55;
  const maxScale = 1.0;
  const minOpacity = 0.5;
  const maxOpacity = 1.0;

  const ringColor = variant === "dark" ? "#fff" : "#1e3c2d";

  return (
    <div style={{ display: "flex", alignItems: "center", gap, flexShrink: 0, padding: `${MAX_RING_REACH}px 0` }}>
      {sorted.map((r, i) => {
        const magnitude = magnitudes[i];
        const quality = 1 - (magnitude - best) / range;
        const scale = minScale + quality * (maxScale - minScale);
        const opacity = minOpacity + quality * (maxOpacity - minOpacity);
        const diameter = size * scale;
        const isHighlighted = r.roundNumber === highlightRound;
        const showDoubleRing = isHighlighted && highlightHasDoublePlay;
        const bg = getScoreColor(magnitude);
        const isFieldBest = r.fieldBest !== null && r.fieldBest !== undefined && r.scoreToPar <= r.fieldBest;

        // Ring 2 (double play) wraps ring 1 (pick highlight) - both
        // are fixed-size slots the same dimensions as the innermost
        // one, just with progressively larger outline-offsets, so
        // they sit as genuinely separate concentric rings rather than
        // one thick one.
        const starSize = Math.max(8, diameter * 0.55);

        const circle = (
          <div
            style={{
              width: diameter,
              height: diameter,
              borderRadius: "50%",
              backgroundColor: bg,
              opacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isFieldBest && <IconStarFilled size={starSize} color="#fff" />}
          </div>
        );

        const ring1 = (
          <div
            style={{
              width: size,
              height: size,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              outline: isHighlighted ? `${RING_WIDTH}px solid ${ringColor}` : "none",
              outlineOffset: isHighlighted ? RING1_GAP : 0,
            }}
          >
            {circle}
          </div>
        );

        const wrapped = showDoubleRing ? (
          <div
            style={{
              width: size,
              height: size,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              outline: `${RING_WIDTH}px solid ${ringColor}`,
              outlineOffset: RING1_GAP + RING_WIDTH + RING2_GAP,
            }}
          >
            {ring1}
          </div>
        ) : (
          ring1
        );

        return (
          <div key={r.roundNumber} title={`Round ${r.roundNumber}`} style={{ flexShrink: 0 }}>
            {wrapped}
          </div>
        );
      })}
    </div>
  );
}
