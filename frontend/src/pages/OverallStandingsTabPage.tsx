import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Text, Stack, Group, Center } from "@mantine/core";
import { IconMedal } from "@tabler/icons-react";
import { api, PodiumStanding } from "../api/client";
import { LogoSpinner } from "../components/LogoSpinner";

const MEDAL_COLORS = ["#d4af37", "#a8a8a8", "#b08d57"]; // gold, silver, bronze

export default function OverallStandingsTabPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [standings, setStandings] = useState<PodiumStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    api
      .getPodiumStandings(leagueId)
      .then(setStandings)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [leagueId]);

  if (loading) {
    return (
      <Center style={{ height: "calc(100dvh - var(--app-shell-header-height, 60px) - var(--app-shell-footer-height, 64px))" }}>
        <LogoSpinner height={56} />
      </Center>
    );
  }

  if (error) {
    return (
      <Text c="coral.6" ta="center" p="md">
        {error}
      </Text>
    );
  }

  if (standings.length === 0 || standings.every((s) => s.tournaments_played === 0)) {
    return (
      <Text c="forest.2" ta="center" p="md">
        No completed tournaments yet - overall standings appear once a tournament is marked
        completed.
      </Text>
    );
  }

  return (
    <Box p="md">
      <Stack gap={0}>
        <Group
          wrap="nowrap"
          px="xs"
          py={6}
          style={{ borderBottom: "2px solid var(--mantine-color-forest-8)" }}
        >
          <Text size="xs" fw={700} c="forest.8" style={{ flex: 3 }}>
            Team
          </Text>
          <Text size="xs" fw={700} c="forest.8" ta="center" style={{ flex: 0.6 }}>
            1st
          </Text>
          <Text size="xs" fw={700} c="forest.8" ta="center" style={{ flex: 0.6 }}>
            2nd
          </Text>
          <Text size="xs" fw={700} c="forest.8" ta="center" style={{ flex: 0.6 }}>
            3rd
          </Text>
          <Text size="xs" fw={700} c="forest.8" ta="center" style={{ flex: 0.7 }}>
            Played
          </Text>
        </Group>

        {standings.map((s, idx) => (
          <Group
            key={s.member_id}
            wrap="nowrap"
            px="xs"
            py={10}
            align="flex-start"
            style={{ borderBottom: "1px solid var(--mantine-color-forest-3)" }}
          >
            <Group gap={6} wrap="nowrap" align="flex-start" style={{ flex: 3, minWidth: 0 }}>
              {idx < 3 ? (
                <IconMedal size={18} color={MEDAL_COLORS[idx]} style={{ marginTop: 2, flexShrink: 0 }} />
              ) : (
                <Text size="xs" c="forest.3" w={18} ta="center" pt={2}>
                  {idx + 1}
                </Text>
              )}
              <Box style={{ minWidth: 0 }}>
                <Text size="sm" fw={700} c="forest.9" style={{ wordBreak: "break-word" }}>
                  {s.current_team_name}
                </Text>
                <Text size="xs" c="forest.2" lineClamp={1}>
                  {s.display_name}
                </Text>
              </Box>
            </Group>
            <Text size="sm" fw={700} ta="center" c={s.firsts > 0 ? "tangerine.7" : "forest.3"} style={{ flex: 0.6 }}>
              {s.firsts}
            </Text>
            <Text size="sm" fw={600} ta="center" c={s.seconds > 0 ? "forest.7" : "forest.3"} style={{ flex: 0.6 }}>
              {s.seconds}
            </Text>
            <Text size="sm" fw={600} ta="center" c={s.thirds > 0 ? "forest.6" : "forest.3"} style={{ flex: 0.6 }}>
              {s.thirds}
            </Text>
            <Text size="sm" ta="center" c="forest.4" style={{ flex: 0.7 }}>
              {s.tournaments_played}
            </Text>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}
