import { useEffect, useState } from "react";
import { Card, Text, Stack, Group, Box } from "@mantine/core";
import { IconTrophy } from "@tabler/icons-react";
import { api, TournamentRecap as TournamentRecapData } from "../api/client";

interface TournamentRecapProps {
  leagueId: string;
}

/**
 * "Awards ceremony" shown once a tournament is marked completed -
 * champion, plus a handful of auto-generated awards (best/worst
 * round, double play gambles, Hot Hand champion). Renders nothing if
 * the tournament isn't completed yet, or there's no tournament at
 * all - this is a payoff for AFTER the event, not something that
 * should show mid-tournament.
 */
export function TournamentRecap({ leagueId }: TournamentRecapProps) {
  const [recap, setRecap] = useState<TournamentRecapData | null>(null);

  useEffect(() => {
    api
      .getRecap(leagueId)
      .then(setRecap)
      .catch(() => setRecap(null));
  }, [leagueId]);

  if (!recap || !recap.available) return null;

  return (
    <Card bg="forest.8" p="lg" mb="md" style={{ border: "2px solid var(--mantine-color-tangerine-5)" }}>
      <Stack gap={4} align="center" mb="md">
        <IconTrophy size={28} color="var(--mantine-color-tangerine-4)" />
        <Text size="xs" fw={700} c="mint.3" tt="uppercase">
          {recap.tournamentName} - Recap
        </Text>
        {recap.champion && (
          <>
            <Text size="lg" fw={800} c="white" ta="center">
              🏆 {recap.champion.teamName}
            </Text>
            <Text size="xs" c="forest.2">
              Champion, {recap.champion.total === 0 ? "E" : recap.champion.total > 0 ? `+${recap.champion.total}` : recap.champion.total}
            </Text>
          </>
        )}
      </Stack>

      <Stack gap="sm">
        {recap.awards.map((a) => (
          <Group key={a.id} gap={10} wrap="nowrap" align="flex-start">
            <Text size="lg" style={{ lineHeight: 1 }}>
              {a.emoji}
            </Text>
            <Box style={{ flex: 1 }}>
              <Text size="sm" fw={700} c="tangerine.3" style={{ fontFamily: "'Titan One', cursive" }}>
                {a.title}
              </Text>
              <Text size="xs" c="forest.1">
                {a.description}
              </Text>
            </Box>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
