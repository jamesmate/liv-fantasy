import { Group, Text, Stack, Box } from "@mantine/core";
import { AnimatedGolferSprite } from "./sprites/AnimatedGolferSprite";

// Same raw-score red-neutral-green gradient used on the player list
// in PickTabPage - kept local here (small, cheap to duplicate) rather
// than importing across files for one shared style.
function getScoreColor(scoreToPar: number): string {
  const clamped = Math.max(-5, Math.min(5, scoreToPar));
  const deepGreen: [number, number, number] = [22, 120, 62];
  const neutral: [number, number, number] = [230, 227, 218];
  const deepRed: [number, number, number] = [150, 24, 24];
  const [from, to, t] =
    clamped <= 0 ? [deepGreen, neutral, (clamped + 5) / 5] : [neutral, deepRed, clamped / 5];
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

function getScoreTextColor(scoreToPar: number): string {
  return Math.abs(scoreToPar) <= 1 ? "#2b2b2b" : "#ffffff";
}

interface LineupSlot {
  id: string;
  name: string;
  scoreToPar?: number | null; // shown below the sprite once the round is locked/scored
  hasDoublePlay?: boolean;
  isCompleted?: boolean;
  roundScores?: { roundNumber: number; scoreToPar: number; fieldAvg?: number | null; fieldBest?: number | null }[];
  currentRoundNumber?: number;
}

interface SelectedLineupProps {
  slots: LineupSlot[]; // up to 4
  showScores?: boolean;
  teamName?: string | null;
  roundNumber?: number;
  isLocked?: boolean;
  /** Name of the picked player with the best score this round, if any - they render in the golf-club pose. */
  topScorerName?: string | null;
}

function formatToPar(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * The "team lineup" zone - rendered over the course background image,
 * showing the member's team name and current round above a row of
 * pixel sprites for each selected player. Sprites run on screen and
 * settle into a row when newly selected. Once showScores is true
 * (round locked/live), each sprite's current score-to-par appears
 * underneath it.
 */
export function SelectedLineup({
  slots,
  showScores = false,
  teamName,
  roundNumber,
  isLocked,
  topScorerName,
}: SelectedLineupProps) {
  return (
    <Box
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        backgroundImage: "url(/lineup-background.png)",
        backgroundSize: "cover",
        backgroundPosition: "center 65%",
        overflow: "hidden",
      }}
    >
      <Box
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.35))",
        }}
      />

      <Stack gap={2} align="center" style={{ position: "relative", paddingTop: 8 }}>
        {teamName && (
          <Text
            fw={800}
            size="sm"
            c="white"
            style={{
              fontFamily: "'Poppins', sans-serif",
              textShadow: "1px 1px 3px rgba(0,0,0,0.7)",
              letterSpacing: 0.3,
            }}
          >
            {teamName}
          </Text>
        )}
        {roundNumber !== undefined && (
          <Group gap={6} wrap="nowrap">
            <Text
              fw={700}
              size="xs"
              c="mint.3"
              style={{
                fontFamily: "'Poppins', sans-serif",
                textShadow: "1px 1px 2px rgba(0,0,0,0.6)",
              }}
            >
              Round {roundNumber}
              {isLocked ? " · Locked" : ""}
            </Text>
          </Group>
        )}
      </Stack>

      <Group
        justify="center"
        gap="lg"
        wrap="nowrap"
        style={{ position: "relative", height: "calc(100% - 40px)" }}
      >
        {Array.from({ length: 4 }).map((_, slotIndex) => {
          const slot = slots[slotIndex];
          return (
            <Stack key={slot?.id ?? `empty-${slotIndex}`} align="center" gap={2} w={60}>
              {slot ? (
                <AnimatedGolferSprite
                  playerName={slot.name}
                  size={52}
                  lineupIndex={slotIndex}
                  isTopScorer={(!!topScorerName && slot.name === topScorerName) || !!slot.hasDoublePlay}
                />
              ) : (
                <div
                  style={{
                    width: 52,
                    height: 52,
                    border: "2px dashed rgba(255,255,255,0.5)",
                    borderRadius: 8,
                  }}
                />
              )}
              <Text
                size="xs"
                ta="center"
                fw={700}
                lineClamp={1}
                style={{
                  maxWidth: 64,
                  fontFamily: "'Poppins', sans-serif",
                  color: "white",
                  textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
                }}
              >
                {slot ? slot.name.split(" ").slice(-1)[0] : "—"}
              </Text>
              {showScores && slot && slot.scoreToPar !== undefined && slot.scoreToPar !== null && (
                <Group gap={3} wrap="nowrap" justify="center">
                  <Text
                    size="10px"
                    fw={700}
                    ta="center"
                    style={{
                      backgroundColor: getScoreColor(slot.scoreToPar),
                      color: getScoreTextColor(slot.scoreToPar),
                      borderRadius: 3,
                      minWidth: 22,
                      padding: "1px 3px",
                      lineHeight: "15px",
                    }}
                  >
                    {formatToPar(slot.scoreToPar)}
                  </Text>
                  {slot.hasDoublePlay && !slot.isCompleted && (
                    <Text size="10px" style={{ textShadow: "1px 1px 2px rgba(0,0,0,0.8)" }}>
                      ⚡
                    </Text>
                  )}
                </Group>
              )}
            </Stack>
          );
        })}
      </Group>
    </Box>
  );
}
