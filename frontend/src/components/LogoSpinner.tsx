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

// Each letter shares one keyframe (see LogoSpinner.css) but starts at
// a different point in it via a negative animation-delay - the
// standard trick for staggering identical repeating animations. This
// offset controls how far apart each letter's "jump" is timed, in
// seconds - small enough that letters visibly cascade left to right
// as a wave, not so small that they all jump at once.
const STEP_SECONDS = 0.4;

/**
 * Loading indicator: JAMDOG's real letter art jumping in left to
 * right, each with a little wobble, in a continuous cascading loop.
 */
export function LogoSpinner({ height = 56 }: LogoSpinnerProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height }}>
      {LETTERS.map((letter, i) => (
        <img
          key={letter.char}
          src={`/loading-letters/${letter.file}`}
          alt={letter.char}
          className="logo-letter"
          style={{
            height,
            width: height * letter.aspect,
            animationDelay: `-${i * STEP_SECONDS}s`,
          }}
        />
      ))}
    </div>
  );
}
