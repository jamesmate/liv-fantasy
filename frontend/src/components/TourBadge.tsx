import { useState } from "react";
import { Box, Text } from "@mantine/core";

export const TOURS: Record<string, { label: string; logoPath: string; bg: string; fg: string }> = {
  LIV: { label: "LIV Golf", logoPath: "/tour-logos/liv.png", bg: "#111111", fg: "#d4af37" },
  PGA_TOUR: { label: "PGA TOUR", logoPath: "/tour-logos/pga-tour.png", bg: "#003087", fg: "#ffffff" },
  DP_WORLD: { label: "DP World Tour", logoPath: "/tour-logos/dp-world.png", bg: "#1a5d3a", fg: "#ffffff" },
  OTHER: { label: "Other", logoPath: "", bg: "#5a6b54", fg: "#ffffff" },
};

interface TourBadgeProps {
  tour: string;
  size?: number;
}

/**
 * Shows the real tour logo if one has been supplied at the expected
 * path (/public/tour-logos/{liv,pga-tour,dp-world}.png), falling back
 * to a plain colored text badge if that file doesn't exist yet (404)
 * or for tours with no logo file at all ("Other"). Means the schedule
 * page works cleanly today, and automatically upgrades to real logos
 * the moment image files are dropped into that folder - no code
 * change needed at that point.
 */
export function TourBadge({ tour, size = 32 }: TourBadgeProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const info = TOURS[tour] ?? TOURS.OTHER;

  if (info.logoPath && !imgFailed) {
    return (
      <img
        src={info.logoPath}
        alt={info.label}
        onError={() => setImgFailed(true)}
        style={{ height: size, width: "auto", objectFit: "contain", flexShrink: 0 }}
      />
    );
  }

  return (
    <Box
      style={{
        backgroundColor: info.bg,
        color: info.fg,
        borderRadius: 6,
        padding: "3px 8px",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <Text size="10px" fw={800} tt="uppercase">
        {info.label}
      </Text>
    </Box>
  );
}
