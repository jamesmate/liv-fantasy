import "./LogoSpinner.css";

interface LogoSpinnerProps {
  /** Height each letter is scaled to, in px - widths follow each letter's own aspect ratio. */
  height?: number;
}

// Real individually-drawn letter art (see /public/loading-letters) -
// each letter has its own aspect ratio, unlike the old approach which
// sliced one wordmark image into equal-width windows.
const LETTERS: { char: string; file: string; aspect: number }[] = [
  { char: "J", file: "J.png", aspect: 247 / 342 },
  { char: "A", file: "A.png", aspect: 263 / 343 },
  { char: "M", file: "M.png", aspect: 304 / 344 },
  { char: "D", file: "D.png", aspect: 304 / 322 },
  { char: "O", file: "O.png", aspect: 254 / 292 },
  { char: "G", file: "G.png", aspect: 255 / 292 },
];

// Each letter shares one keyframe (see LogoSpinner.css) but starts
// STEP_SECONDS later than the one before it, so the "big" bounce
// visibly travels left to right and - critically - keeps doing so on
// every loop, not just the first pass (see the comment at the actual
// delay below for why positive delay, not negative, is what makes
// that true).
const STEP_SECONDS = 0.22;

/**
 * Loading indicator: JAMDOG's real letter art jumping in left to
 * right, each with a little wobble, in a continuous cascading loop.
 */
export function LogoSpinner({ height = 56 }: LogoSpinnerProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 0, height }}>
      {LETTERS.map((letter, i) => (
        <img
          key={letter.char}
          src={`/loading-letters/${letter.file}`}
          alt={letter.char}
          className="logo-letter"
          style={{
            height,
            width: height * letter.aspect,
            // Positive delay (not negative) - each letter's start is
            // pushed back by its position, then all six loop forever
            // at the same period, so the left-to-right order holds
            // on every lap, not just the first. A negative delay here
            // would make each letter act as if its clock already ran
            // ahead by that amount, which flips the visual order to
            // right-to-left after letter one - that was the original
            // bug.
            animationDelay: `${i * STEP_SECONDS}s`,
          }}
        />
      ))}
    </div>
  );
}
