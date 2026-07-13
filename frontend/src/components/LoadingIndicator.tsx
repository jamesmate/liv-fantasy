import { useState } from "react";
import { LogoSpinner } from "./LogoSpinner";
import { LogoPulseSpinner } from "./LogoPulseSpinner";

/**
 * Randomly shows one of the two loading animations - the letter
 * wobble or the spin+pulse wordmark - roughly 50/50, picked once per
 * mount (not re-rolled on every render, so it doesn't flicker between
 * the two while the same loading state is showing).
 */
export function LoadingIndicator() {
  const [useSpinPulse] = useState(() => Math.random() < 0.5);
  // LogoSpinner's height prop and LogoPulseSpinner's size (width) prop
  // aren't the same dimension - the pulse spinner shows the full
  // wordmark, a wide ~5.2:1 image, so matching widths would make it
  // look tiny next to the letters. Sizing pulse's width to ~5.2x the
  // wobble height lines up their actual rendered HEIGHT instead,
  // since that's what reads as "the same size" side by side.
  return useSpinPulse ? <LogoPulseSpinner size={207} /> : <LogoSpinner height={40} />;
}
