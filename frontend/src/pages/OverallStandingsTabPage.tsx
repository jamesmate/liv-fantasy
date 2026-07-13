import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Text, Stack, Group, Center, UnstyledButton, Collapse } from "@mantine/core";
import { IconMedal, IconChevronDown, IconChevronUp, IconFlame, IconStar, IconGolf } from "@tabler/icons-react";
import { api, PodiumStanding, MemberCareerStats } from "../api/client";
import { LoadingIndicator } from "../components/LoadingIndicator";

const MEDAL_COLORS = ["#d4af37", "#a8a8a8", "#b08d57"]; // gold, silver, bronze

function formatToPar(n: number | null): string {
  if (n === null) return "-";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

export default function OverallStandingsTabPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [standings, setStandings] = useState<PodiumStanding[]>([]);
  const [careerStats, setCareerStats] = useState<MemberCareerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    Promise.all([api.getPodiumStandings(leagueId), api.getCareerStats(leagueId)])
      .then(([s, c]) => {
        setStandings(s);
        setCareerStats(c);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [leagueId]);

  if (loading) {
    return (
      <Center style={{ height: "calc(100dvh - var(--app-shell-header-height, 60px) - var(--app-shell-footer-height, 64px))" }}>
        <LoadingIndicator />
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

        {standings.map((s, idx) => {
          const stats = careerStats.find((c) => c.memberId === s.member_id);
          const isExpanded = expanded === s.member_id;
          return (
            <Box key={s.member_id} style={{ borderBottom: "1px solid var(--mantine-color-forest-3)" }}>
              <UnstyledButton onClick={() => setExpanded(isExpanded ? null : s.member_id)} style={{ width: "100%" }}>
                <Group wrap="nowrap" px="xs" py={10} align="flex-start">
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
                  <Text size="sm" fw={600} ta="center" c={s.thirds > 0 ? "forest.2" : "forest.3"} style={{ flex: 0.6 }}>
                    {s.thirds}
                  </Text>
                  <Group gap={2} wrap="nowrap" justify="center" style={{ flex: 0.7 }}>
                    <Text size="sm" c="forest.3">
                      {s.tournaments_played}
                    </Text>
                    {isExpanded ? (
                      <IconChevronUp size={14} color="var(--mantine-color-forest-3)" />
                    ) : (
                      <IconChevronDown size={14} color="var(--mantine-color-forest-3)" />
                    )}
                  </Group>
                </Group>
              </UnstyledButton>

              <Collapse in={isExpanded}>
                <Box px="xs" pb="sm" style={{ background: "var(--mantine-color-forest-0)" }}>
                  {!stats || (stats.avgHotHandScore === null && !stats.favouritePlayerName) ? (
                    <Text size="xs" c="forest.3" py="sm">
                      No stats yet - these fill in once this team has finished a tournament.
                    </Text>
                  ) : (
                    <Stack gap={8} pt="sm">
                      {stats.avgHotHandScore !== null && (
                        <Group gap={8} wrap="nowrap">
                          <IconFlame size={16} color="var(--mantine-color-tangerine-6)" />
                          <Box style={{ flex: 1 }}>
                            <Text size="xs" fw={700} c="forest.7">
                              Average Hot Hand Score: {stats.avgHotHandScore}
                            </Text>
                            {stats.bestHotHandScore !== null && (
                              <Text size="10px" c="forest.3">
                                Best ever: {stats.bestHotHandScore} at {stats.bestHotHandTournamentName}
                              </Text>
                            )}
                          </Box>
                        </Group>
                      )}
                      {stats.favouritePlayerName && (
                        <Group gap={8} wrap="nowrap">
                          <IconStar size={16} color="var(--mantine-color-mint-6)" />
                          <Text size="xs" fw={700} c="forest.7">
                            Favourite Player: {stats.favouritePlayerName}
                            <Text span size="10px" c="forest.3">
                              {" "}
                              (picked {stats.favouritePlayerUseCount}x)
                            </Text>
                          </Text>
                        </Group>
                      )}
                      {stats.bestRoundScore !== null && (
                        <Group gap={8} wrap="nowrap">
                          <IconGolf size={16} color="var(--mantine-color-coral-6)" />
                          <Text size="xs" fw={700} c="forest.7">
                            Best Round Ever: {formatToPar(stats.bestRoundScore)}
                            <Text span size="10px" c="forest.3">
                              {" "}
                              (round {stats.bestRoundNumber} at {stats.bestRoundTournamentName})
                            </Text>
                          </Text>
                        </Group>
                      )}
                    </Stack>
                  )}
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
