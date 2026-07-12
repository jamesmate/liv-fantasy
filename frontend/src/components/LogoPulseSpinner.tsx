import "./LogoPulseSpinner.css";

interface LogoPulseSpinnerProps {
  size?: number;
}

/**
 * Secondary loading indicator: the full JAMDOG wordmark rotating
 * continuously while pulsing bigger and smaller. Separate component
 * from LogoSpinner (the letter-by-letter one) since this uses the
 * single flat wordmark image rather than the individual letter art.
 */
export function LogoPulseSpinner({ size = 120 }: LogoPulseSpinnerProps) {
  return (
    <img
      src="/jamdog-logo.png"
      alt="Loading"
      className="logo-pulse-spinner"
      style={{ width: size, height: "auto" }}
    />
  );
}
