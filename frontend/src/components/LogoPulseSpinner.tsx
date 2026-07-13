import "./LogoPulseSpinner.css";

interface LogoPulseSpinnerProps {
  size?: number;
}

/**
 * Secondary loading indicator: the full JAMGOLF wordmark rotating
 * clockwise continuously while pulsing bigger and smaller.
 *
 * Rotation and scale are on two separate nested elements (rather than
 * one combined `transform: rotate(...) scale(...)` animation) so each
 * can use its own timing function - rotation is linear/constant-speed
 * so it reads as unambiguously, continuously clockwise, while scale
 * keeps an ease-in-out feel for the pulse. Combining both into one
 * shared ease-in-out timing made the rotation appear to hitch/pause
 * right at the midpoint (exactly when the deceleration going into 180
 * degrees lines up with the scale peak), which could look like a
 * brief reversal even though the rotation value itself never actually
 * changed direction.
 */
export function LogoPulseSpinner({ size = 120 }: LogoPulseSpinnerProps) {
  return (
    <div className="logo-pulse-spinner-rotate" style={{ width: size }}>
      <img
        src="/jamgolf-logo.png"
        alt="Loading"
        className="logo-pulse-spinner-scale"
        style={{ width: size, height: "auto" }}
      />
    </div>
  );
}
