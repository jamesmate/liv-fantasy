import "./LogoSpinner.css";

interface LogoSpinnerProps {
  /** Total displayed width in px - height follows the logo's ~4:1 aspect ratio. */
  width?: number;
}

const LETTER_COUNT = 6; // J-A-M-D-O-G

/**
 * Loading indicator: the Jamdog logo revealed one letter at a time,
 * each popping in with a little wobble, in a continuous staggered
 * loop. Rather than slicing the logo PNG into 6 separate image files
 * (the letters overlap/touch in this hand-drawn font, so there's no
 * clean gap to cut along), each "letter" is really just an
 * overflow-hidden window onto the SAME background image, shifted via
 * background-position so it reveals roughly one letter's worth of
 * width - all 6 windows share one scaled-up copy of the source image.
 */
export function LogoSpinner({ width = 210 }: LogoSpinnerProps) {
  const height = Math.round(width / 4); // source logo is ~1200x300, i.e. 4:1
  const sliceWidth = width / LETTER_COUNT;

  return (
    <div style={{ display: "flex", width, height }}>
      {Array.from({ length: LETTER_COUNT }).map((_, i) => (
        <div
          key={i}
          className="logo-letter"
          style={{
            width: sliceWidth,
            height,
            backgroundImage: "url(/jamdog-logo.png)",
            backgroundSize: `${width}px ${height}px`,
            backgroundPosition: `-${i * sliceWidth}px 0`,
            backgroundRepeat: "no-repeat",
            animationDelay: `-${i * 0.25}s`,
          }}
        />
      ))}
    </div>
  );
}
