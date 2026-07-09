import { ActionIcon, Group, Text, Badge } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

interface RoundSelectorProps {
  currentRound: number;
  totalRounds: number;
  isLocked?: boolean;
  onChange: (roundNumber: number) => void;
}

export function RoundSelector({
  currentRound,
  totalRounds,
  isLocked,
  onChange,
}: RoundSelectorProps) {
  return (
    <Group justify="center" gap="xs" wrap="nowrap">
      <ActionIcon
        variant="filled"
        color="forest.8"
        radius="xl"
        size={32}
        disabled={currentRound <= 1}
        onClick={() => onChange(currentRound - 1)}
        aria-label="Previous round"
      >
        <IconChevronLeft size={18} />
      </ActionIcon>

      <Group gap={6} wrap="nowrap" justify="center" style={{ minWidth: 110 }}>
        <Text
          fw={800}
          size="sm"
          c="white"
          style={{
            fontFamily: "'Poppins', sans-serif",
            textShadow: "1px 1px 2px rgba(0,0,0,0.6)",
          }}
        >
          Round {currentRound}
        </Text>
        {isLocked && (
          <Badge size="xs" color="coral" variant="filled">
            Locked
          </Badge>
        )}
      </Group>

      <ActionIcon
        variant="filled"
        color="forest.8"
        radius="xl"
        size={32}
        disabled={currentRound >= totalRounds}
        onClick={() => onChange(currentRound + 1)}
        aria-label="Next round"
      >
        <IconChevronRight size={18} />
      </ActionIcon>
    </Group>
  );
}
