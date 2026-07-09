import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, Title, Text, Stack, Group, Badge, Avatar } from "@mantine/core";
import { IconTrophy } from "@tabler/icons-react";
import { api, CareerStanding } from "../api/client";

function formatToPar(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

export default function CareerStandingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [standings, setStandings] = useState<CareerStanding[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    api.getCareerStandings(leagueId).then(setStandings).catch((err) => setError(err.message));
  }, [leagueId]);

  return (
    <Stack gap="md">
      <Stack gap={2} align="center">
        <Title order={2} c="forest.8">
          All-Time Leaderboard
        </Title>
        <Text c="forest.1" size="sm">
          Wins and accumulated score across every tournament
        </Text>
      </Stack>

      {error && (
        <Text c="coral.4" ta="center">
          {error}
        </Text>
      )}

      {standings.length === 0 && !error && (
        <Card bg="forest.7" p="lg">
          <Text c="forest.1" ta="center">
            No completed tournaments yet - career stats appear once a tournament is marked
            completed.
          </Text>
        </Card>
      )}

      <Stack gap="xs">
        {standings.map((row, i) => (
          <Card key={row.member_id} p="sm" bg="forest.7">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <Avatar radius="xl" color={i === 0 ? "tangerine" : "forest.8"} variant="filled">
                  <IconTrophy size={16} />
                </Avatar>
                <div>
                  <Text fw={700} c="forest.9" size="sm">
                    {row.current_team_name}
                  </Text>
                  <Text size="xs" c="forest.2">
                    {row.display_name} · {row.tournaments_played}{" "}
                    {row.tournaments_played === 1 ? "tournament" : "tournaments"}
                  </Text>
                </div>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <Badge color="tangerine" variant="filled" size="lg">
                  {row.career_wins} {row.career_wins === 1 ? "win" : "wins"}
                </Badge>
                <Badge
                  color={
                    row.career_total_to_par < 0
                      ? "mint"
                      : row.career_total_to_par > 0
                      ? "coral"
                      : "forest"
                  }
                  variant="light"
                  size="lg"
                >
                  {formatToPar(row.career_total_to_par)}
                </Badge>
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
