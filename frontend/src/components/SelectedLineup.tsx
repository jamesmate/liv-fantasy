import { Group, Text, Stack, Box } from "@mantine/core";
import { AnimatedGolferSprite } from "./sprites/AnimatedGolferSprite";
import { RoundSparkline } from "./RoundSparkline";

interface LineupSlot {
  id: string;
  name: string;
  scoreToPar?: number | null; // shown below the sprite once the round is locked/scored
  hasDoublePlay?: boolean;
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
                <Text
                  size="xs"
                  fw={800}
                  style={{
                    color:
                      slot.scoreToPar < 0
                        ? "var(--mantine-color-mint-4)"
                        : slot.scoreToPar > 0
                        ? "var(--mantine-color-coral-3)"
                        : "white",
                    textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
                  }}
                >
                  {formatToPar(slot.scoreToPar)}
                  {slot.hasDoublePlay ? " ⚡" : ""}
                </Text>
              )}
              {slot && slot.roundScores && slot.roundScores.length > 1 && (
                <RoundSparkline
                  roundScores={slot.roundScores}
                  highlightRound={slot.currentRoundNumber}
                  highlightHasDoublePlay={slot.hasDoublePlay}
                  variant="dark"
                  size={12}
                  gap={2}
                />
              )}
            </Stack>
          );
        })}
      </Group>
    </Box>
  );
}
