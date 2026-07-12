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
  return useSpinPulse ? <LogoPulseSpinner size={100} /> : <LogoSpinner height={56} />;
}
