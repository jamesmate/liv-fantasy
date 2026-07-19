import { PixelGolferSprite } from "./PixelGolferSprite";
import { HueSatTarget } from "./recolorSprite";
import "./sprite-animations.css";

interface AnimatedGolferSpriteProps {
  playerName: string;
  size?: number;
  /** Position in the lineup (0-3) - staggers bob timing and run-on delay/distance. */
  lineupIndex?: number;
  /** When true, plays the run-on-screen entrance once on mount. */
  runOn?: boolean;
  /** True when this player currently has the best score in the round - shows the golf-club pose. */
  isTopScorer?: boolean;
  /** See PixelGolferSprite - overrides the deterministic clothing color, e.g. with a member's team color. */
  clothingOverride?: HueSatTarget | null;
}

const BOB_OFFSET_CLASSES = ["", "bob-offset-1", "bob-offset-2", "bob-offset-3"];

/**
 * Used wherever a selected player should "run onto the screen and line
 * up" - the run-on animation plays once when this component mounts
 * (i.e. the moment a player becomes selected), then settles into a
 * continuous idle bob, staggered slightly per lineup position so a row
 * of 4 sprites doesn't bob in perfect unison.
 */
export function AnimatedGolferSprite({
  playerName,
  size = 64,
  lineupIndex = 0,
  runOn = true,
  isTopScorer = false,
  clothingOverride = null,
}: AnimatedGolferSpriteProps) {
  const bobOffsetClass = BOB_OFFSET_CLASSES[lineupIndex % BOB_OFFSET_CLASSES.length];
  // Earlier lineup slots run on from further away and arrive slightly
  // sooner, later slots trail behind - gives the line-up a staggered,
  // organic feel rather than every sprite snapping in at once.
  const runDistance = 100 + lineupIndex * 24;
  const runDelay = lineupIndex * 80;

  return (
    <div
      className={runOn ? "pixel-sprite-run-on" : undefined}
      style={
        runOn
          ? ({
              "--run-distance": `${runDistance}px`,
              animationDelay: `${runDelay}ms`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <PixelGolferSprite
        playerName={playerName}
        size={size}
        bobbing
        bobOffsetClass={bobOffsetClass}
        isTopScorer={isTopScorer}
        clothingOverride={clothingOverride}
      />
    </div>
  );
}
