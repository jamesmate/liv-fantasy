import { IconStarFilled } from "@tabler/icons-react";

// Same red-neutral-green gradient used elsewhere in the app (the
// round-score chips on the pick list) - kept local here rather than a
// shared import since the two call sites color slightly different
// underlying values (raw score there, field-adjusted here).
export function getScoreColor(magnitude: number): string {
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
// why a double-ringed dot is built from two nested wrapper divs rather
// than one - each contributes its own ring at its own gap.
export const RING_WIDTH = 1;
export const RING1_GAP = 1; // gap between the filled circle and the pick ring
export const RING2_GAP = 1; // gap between ring 1 and the double-play ring (measured from ring 1's outer edge)

// Extra space a dot's outer slot should reserve on every side so
// rings never bleed into neighboring rows/dots - sized for the worst
// case (double ring), not just whichever dots actually have one, so
// layout stays consistent regardless of which specific dots are
// ringed.
export const MAX_RING_REACH = RING1_GAP + RING_WIDTH + RING2_GAP + RING_WIDTH;

interface PickQualityDotProps {
  /** This round's score. */
  scoreToPar: number;
  /** Field average for this specific round, for the color/size magnitude calc. */
  fieldAvg?: number | null;
  /** The single best score in the whole field for this round, to decide the star. */
  fieldBest?: number | null;
  /** This SAME player's other rounds (field-adjusted scores), to normalize this dot's size/opacity against - the best of these renders biggest/most opaque, the worst smallest/faintest. Should include this round's own magnitude too. */
  siblingMagnitudes: number[];
  /** Show the "this is the round that was actually picked" ring. */
  showPickRing?: boolean;
  /** Show a second, further-out ring (Double Play was used on this round). */
  showDoublePlayRing?: boolean;
  size?: number;
  variant?: "light" | "dark";
}

/**
 * A single round's circle: filled color + size + opacity all driven
 * by field-adjusted quality, an optional ring for "this is the pick",
 * an optional second ring for Double Play, and a star if this round
 * was the single best score in the whole field that day. Shared by
 * RoundSparkline (one player's whole history) and the team timing
 * summary row (one dot per pick, across different players).
 */
export function PickQualityDot({
  scoreToPar,
  fieldAvg,
  fieldBest,
  siblingMagnitudes,
  showPickRing = false,
  showDoublePlayRing = false,
  size = 22,
  variant = "dark",
}: PickQualityDotProps) {
  const magnitude = scoreToPar - (fieldAvg ?? 0);
  const best = Math.min(...siblingMagnitudes);
  const worst = Math.max(...siblingMagnitudes);
  const range = worst - best || 1;
  const quality = 1 - (magnitude - best) / range;

  const minScale = 0.55;
  const maxScale = 1.0;
  const minOpacity = 0.5;
  const maxOpacity = 1.0;

  const scale = minScale + quality * (maxScale - minScale);
  const opacity = minOpacity + quality * (maxOpacity - minOpacity);
  const diameter = size * scale;
  const bg = getScoreColor(magnitude);
  const isFieldBest = fieldBest !== null && fieldBest !== undefined && scoreToPar <= fieldBest;
  const starSize = Math.max(8, diameter * 0.55);
  const ringColor = variant === "dark" ? "#fff" : "#1e3c2d";

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
        outline: showPickRing ? `${RING_WIDTH}px solid ${ringColor}` : "none",
        outlineOffset: showPickRing ? RING1_GAP : 0,
      }}
    >
      {circle}
    </div>
  );

  if (!showDoublePlayRing) return ring1;

  return (
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
  );
}
