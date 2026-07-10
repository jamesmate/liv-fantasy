import "./LogoSpinner.css";

interface LogoSpinnerProps {
  size?: number;
}

/**
 * Rotating Jamdog logo, used in place of Mantine's default Loader
 * spinner throughout the app for loading states.
 */
export function LogoSpinner({ size = 48 }: LogoSpinnerProps) {
  return (
    <img
      src="/jamdog-logo.png"
      alt="Loading"
      className="logo-spinner"
      style={{ width: size, height: "auto" }}
    />
  );
}
