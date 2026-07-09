/**
 * Deterministic per-player sprite palette.
 * -----------------------------------------
 * We don't have real visual data per golfer (headshot colors, etc -
 * ESPN's leaderboard endpoint doesn't expose that), so instead of
 * generic identical sprites, each player gets a consistent palette
 * derived from a hash of their name. Same player always renders the
 * same way; different players are visually distinct from each other.
 *
 * This palette feeds the HAND-DRAWN base sprite recolor system (see
 * recolorSprite.ts) rather than the old procedurally-drawn sprite -
 * hair and clothing colors are expressed as HSV hue/saturation
 * targets, since the recolor technique works by shifting hue/
 * saturation while preserving each pixel's original brightness (which
 * is what encodes the hand-painted shading).
 */

interface HueSat {
  hue: number; // 0-1
  saturation: number; // 0-1
}

// Weighted pool: light/tan skin tones repeated several times, darker
// tones appearing only once or twice - the LIV Golf field is mostly
// white/tan-skinned players with only one or two Black players, so
// the random pool should reflect that rather than uniform 1-in-N odds.
const SKIN_TONE_POOL: HueSat[] = [
  { hue: 0.08, saturation: 0.35 }, { hue: 0.08, saturation: 0.35 }, { hue: 0.08, saturation: 0.35 },
  { hue: 0.07, saturation: 0.45 }, { hue: 0.07, saturation: 0.45 }, { hue: 0.07, saturation: 0.45 }, { hue: 0.07, saturation: 0.45 },
  { hue: 0.06, saturation: 0.55 }, { hue: 0.06, saturation: 0.55 },
  { hue: 0.05, saturation: 0.6 },
  { hue: 0.04, saturation: 0.55 },
];

const HAIR_COLORS: HueSat[] = [
  { hue: 0.07, saturation: 0.55 }, // brown (close to original)
  { hue: 0.0, saturation: 0.0 },   // black/grey (desaturated)
  { hue: 0.13, saturation: 0.5 },  // sandy/blonde
  { hue: 0.95, saturation: 0.45 }, // auburn/red-brown
  { hue: 0.0, saturation: 0.0 },   // grey (special-cased brighter in recolorSprite.ts)
];

const CLOTHING_COLORS: HueSat[] = [
  { hue: 0.6, saturation: 0.55 },  // blue (original-ish)
  { hue: 0.0, saturation: 0.65 },  // red
  { hue: 0.35, saturation: 0.55 }, // green
  { hue: 0.13, saturation: 0.7 },  // orange/yellow
  { hue: 0.78, saturation: 0.5 },  // purple
  { hue: 0.5, saturation: 0.5 },   // teal
];

const CAP_COLORS: HueSat[] = [
  { hue: 0.6, saturation: 0.55 },  // blue (original-ish)
  { hue: 0.0, saturation: 0.6 },   // red
  { hue: 0.0, saturation: 0.0 },   // black/grey
  { hue: 0.35, saturation: 0.5 },  // green
  { hue: 0.13, saturation: 0.65 }, // orange
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface SpritePalette {
  skin: HueSat;
  hair: HueSat;
  clothing: HueSat;
  cap: HueSat;
  pose: "plain" | "sunglasses" | "cap";
}

const DEFAULT_POSES: SpritePalette["pose"][] = ["plain", "sunglasses", "cap"];

export function getSpritePalette(playerName: string): SpritePalette {
  const h = hashString(playerName || "default");
  return {
    skin: SKIN_TONE_POOL[h % SKIN_TONE_POOL.length],
    hair: HAIR_COLORS[(h >> 3) % HAIR_COLORS.length],
    clothing: CLOTHING_COLORS[(h >> 6) % CLOTHING_COLORS.length],
    cap: CAP_COLORS[(h >> 10) % CAP_COLORS.length],
    pose: DEFAULT_POSES[(h >> 9) % DEFAULT_POSES.length],
  };
}

/**
 * Returns the palette to actually render for this player, swapping in
 * the "golf" pose (club in hand) when isTopScorer is true - reserved
 * for whichever player currently has the best score in the round
 * being displayed, rather than randomly assigned like the other
 * poses. Callers (e.g. the pick screen, leaderboard) decide who
 * qualifies by comparing live scores and pass that in; this function
 * doesn't fetch or compare scores itself.
 */
export function getSpritePaletteWithPose(
  playerName: string,
  isTopScorer: boolean
): Omit<SpritePalette, "pose"> & { pose: "plain" | "sunglasses" | "cap" | "golf" } {
  const base = getSpritePalette(playerName);
  if (!isTopScorer) return base;
  return { skin: base.skin, hair: base.hair, clothing: base.clothing, cap: base.cap, pose: "golf" };
}
