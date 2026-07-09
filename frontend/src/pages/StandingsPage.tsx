import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, Title, Text, Stack, Group, Badge, Avatar } from "@mantine/core";
import { IconTrophy, IconBolt } from "@tabler/icons-react";
import { api } from "../api/client";

interface StandingRow {
  member_id: string;
  team_name: string;
  display_name: string;
  total_to_par: number;
  used_double_play: boolean;
}

function formatToPar(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

const RANK_COLORS = ["tangerine", "mint", "coral"] as const;

export default function StandingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    api.getStandings(leagueId).then(setStandings).catch((err) => setError(err.message));
  }, [leagueId]);

  return (
    <Stack gap="md">
      <Stack gap={2} align="center">
        <Title order={2} c="mint.3">
          Standings
        </Title>
        <Text c="forest.1" size="sm">
          Running total for the current tournament
        </Text>
      </Stack>

      {error && (
        <Text c="coral.4" ta="center">
          {error}
        </Text>
      )}

      <Stack gap="xs">
        {standings.map((row, i) => (
          <Card key={row.member_id} p="sm" bg="forest.7">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <Avatar radius="xl" color={RANK_COLORS[i] ?? "forest"} variant="filled">
                  {i < 3 ? <IconTrophy size={16} /> : i + 1}
                </Avatar>
                <div>
                  <Group gap={4} wrap="nowrap">
                    <Text fw={700} c="white" size="sm">
                      {row.team_name}
                    </Text>
                    {row.used_double_play && (
                      <IconBolt size={14} color="var(--mantine-color-tangerine-4)" />
                    )}
                  </Group>
                  <Text size="xs" c="forest.2">
                    {row.display_name}
                  </Text>
                </div>
              </Group>
              <Badge
                size="lg"
                color={row.total_to_par < 0 ? "mint" : row.total_to_par > 0 ? "coral" : "forest"}
                variant="filled"
              >
                {formatToPar(row.total_to_par)}
              </Badge>
            </Group>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
