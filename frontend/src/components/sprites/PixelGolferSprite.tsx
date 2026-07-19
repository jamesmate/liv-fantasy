import { useEffect, useMemo, useRef } from "react";
import { getSpritePaletteWithPose } from "./spritePalette";
import { renderRecoloredSprite, getSpriteDimensions, HueSatTarget } from "./recolorSprite";
import "./sprite-animations.css";

interface PixelGolferSpriteProps {
  playerName: string;
  size?: number; // rendered height in px
  bobbing?: boolean;
  facing?: "left" | "right";
  /** Extra class appended alongside pixel-sprite-bob, e.g. "bob-offset-2", to desync a row of sprites. */
  bobOffsetClass?: string;
  /**
   * True when this player currently has the best score in the round
   * being displayed - swaps in the golf-club pose instead of their
   * usual deterministic pose. Callers decide this by comparing live
   * scores; this component doesn't fetch or compare anything itself.
   */
  isTopScorer?: boolean;
  /**
   * Overrides the player's normal deterministic clothing color (see
   * spritePalette.ts) with a specific hue/sat - used to show a
   * member's own team color on their picked players' sprites, rather
   * than each player's usual per-name-derived color. Hair/skin/cap
   * stay on the normal deterministic palette either way.
   */
  clothingOverride?: HueSatTarget | null;
}

/**
 * Renders a hand-drawn base sprite, recolored per player via HSV hue/
 * saturation shifting (see recolorSprite.ts) so each player has a
 * distinct but consistent hair/clothing/skin/cap color, while keeping
 * every pixel of the original hand-painted shading and detail intact.
 *
 * Each player is deterministically assigned one of three everyday
 * poses (plain, sunglasses, or cap - no club) - see spritePalette.ts -
 * so the roster has visual variety in pose as well as color. The
 * fourth pose (holding a golf club) is reserved for whoever currently
 * has the best score in the round, via the isTopScorer prop.
 *
 * The poses have different aspect ratios (the golf pose is much
 * wider, due to the outstretched club), so `size` here means "fit
 * within a size x size box" rather than "render at this exact height"
 * - otherwise the golf pose would render almost twice as wide as the
 * others and overflow tight containers like the circular player-list
 * icons.
 */
export function PixelGolferSprite({
  playerName,
  size = 64,
  bobbing = true,
  facing = "right",
  bobOffsetClass,
  isTopScorer = false,
  clothingOverride = null,
}: PixelGolferSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palette = useMemo(
    () => getSpritePaletteWithPose(playerName, isTopScorer),
    [playerName, isTopScorer]
  );
  const dimensions = getSpriteDimensions(palette.pose);

  const pxUnit = Math.min(size / dimensions.height, size / dimensions.width);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderRecoloredSprite(
      canvas,
      palette.pose,
      {
        hair: palette.hair,
        clothing: clothingOverride ?? palette.clothing,
        skin: palette.skin,
        cap: palette.cap,
      },
      pxUnit
    ).catch((err) => console.error("Sprite recolor failed:", err));
  }, [palette, pxUnit, clothingOverride]);

  const className = bobbing
    ? ["pixel-sprite-bob", bobOffsetClass].filter(Boolean).join(" ")
    : undefined;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: pxUnit * dimensions.width,
        height: pxUnit * dimensions.height,
        imageRendering: "pixelated",
        transform: facing === "left" ? "scaleX(-1)" : undefined,
        display: "block",
      }}
      aria-hidden="true"
    />
  );
}
