import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Text,
  Stack,
  Group,
  Collapse,
  UnstyledButton,
  Badge,
  Center,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconBolt } from "@tabler/icons-react";
import { api, LeaderboardResponse, LeaderboardTeam } from "../api/client";
import { getCountryFlagUrl } from "../utils/countryFlags";
import { LogoSpinner } from "../components/LogoSpinner";

function formatToPar(n: number | null): string {
  if (n === null) return "-";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

export default function LeaderboardTabPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [leagueId]);

  function load() {
    if (!leagueId) return;
    api
      .getLeaderboard(leagueId)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  if (loading) {
    return (
      <Center mih="100%">
        <LogoSpinner size={56} />
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

  if (!data?.tournament || data.teams.length === 0) {
    return (
      <Text c="forest.2" ta="center" p="md">
        No tournament data yet.
      </Text>
    );
  }

  const totalRounds = data.tournament.totalRounds;

  return (
    <Box p="md">
      <Stack gap={0}>
        {/* Header row */}
        <Group
          wrap="nowrap"
          px="xs"
          py={6}
          style={{ borderBottom: "2px solid var(--mantine-color-forest-8)" }}
        >
          <Text size="xs" fw={700} c="forest.8" style={{ flex: 3.2 }}>
            Team
          </Text>
          {Array.from({ length: totalRounds }).map((_, i) => (
            <Text key={i} size="xs" fw={700} c="forest.8" ta="center" style={{ flex: 0.7 }}>
              R{i + 1}
            </Text>
          ))}
          <Text size="xs" fw={700} c="forest.8" ta="center" style={{ flex: 0.8 }}>
            Tot
          </Text>
        </Group>

        {(() => {
          // Tie-aware position numbers, same competition-ranking logic
          // as the backend's finalization (1, 1, 3 - not 1, 2, 3) so
          // teams tied on overallTotal show the same position rather
          // than an arbitrary tiebreak from array order.
          let previousTotal: number | null = null;
          let previousPosition = 0;
          let rowsSeen = 0;

          return data.teams.map((team) => {
            rowsSeen++;
            const position =
              previousTotal !== null && team.overallTotal === previousTotal
                ? previousPosition
                : rowsSeen;
            previousTotal = team.overallTotal;
            previousPosition = position;

            return (
              <TeamRow
                key={team.memberId}
                team={team}
                position={position}
                totalRounds={totalRounds}
                isExpanded={expanded === team.memberId}
                onToggle={() => setExpanded(expanded === team.memberId ? null : team.memberId)}
              />
            );
          });
        })()}
      </Stack>
    </Box>
  );
}

function TeamRow({
  team,
  position,
  totalRounds,
  isExpanded,
  onToggle,
}: {
  team: LeaderboardTeam;
  position: number;
  totalRounds: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Box style={{ borderBottom: "1px solid var(--mantine-color-forest-3)" }}>
      <UnstyledButton onClick={onToggle} style={{ width: "100%" }}>
        <Group wrap="nowrap" px="xs" py={10}>
          <Group gap={6} wrap="nowrap" style={{ flex: 3.2, minWidth: 0 }} align="flex-start">
            <Text size="xs" c="forest.3" w={16} pt={2}>
              {position}
            </Text>
            <Box style={{ minWidth: 0 }}>
              <Text size="sm" fw={700} c="forest.9" style={{ wordBreak: "break-word" }}>
                {team.teamName}
              </Text>
              <Text size="xs" c="forest.2" lineClamp={1}>
                {team.displayName}
              </Text>
            </Box>
          </Group>
          {team.rounds.map((r) => (
            <Text
              key={r.roundNumber}
              size="sm"
              ta="center"
              fw={600}
              c={
                r.total === null
                  ? "forest.3"
                  : r.total < 0
                  ? "mint.7"
                  : r.total > 0
                  ? "coral.6"
                  : "forest.6"
              }
              style={{ flex: 0.7 }}
            >
              {formatToPar(r.total)}
            </Text>
          ))}
          <Group gap={4} wrap="nowrap" justify="center" style={{ flex: 0.8 }}>
            <Text size="sm" fw={800} c="forest.9">
              {formatToPar(team.overallTotal)}
            </Text>
            {isExpanded ? (
              <IconChevronUp size={14} color="var(--mantine-color-forest-5)" />
            ) : (
              <IconChevronDown size={14} color="var(--mantine-color-forest-5)" />
            )}
          </Group>
        </Group>
      </UnstyledButton>

      <Collapse in={isExpanded}>
        <Box pb="sm" px="xs" style={{ background: "var(--mantine-color-forest-0)" }}>
          {team.rounds.map((round) => (
            <Box key={round.roundNumber} mb="xs">
              <Text size="xs" fw={700} c="forest.6" mb={4}>
                Round {round.roundNumber}
                {round.total !== null ? ` · ${formatToPar(round.total)}` : ""}
              </Text>
              {round.picks.length === 0 ? (
                <Text size="xs" c="forest.3" pl="xs">
                  No picks made
                </Text>
              ) : (
                <Stack gap={4} pl="xs">
                  {round.picks.map((pick, i) => {
                    const flagUrl = getCountryFlagUrl(pick.countryCode);
                    return (
                      <Group key={i} justify="space-between" wrap="nowrap">
                        <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
                          {flagUrl && (
                            <img
                              src={flagUrl}
                              alt={pick.countryCode ?? ""}
                              width={14}
                              height={11}
                              style={{ borderRadius: 2, flexShrink: 0 }}
                            />
                          )}
                          <Text size="xs" c="forest.8" lineClamp={1}>
                            {pick.playerName}
                            {pick.proTeamName && (
                              <Text span c="forest.3">
                                {" "}
                                · {pick.proTeamName}
                              </Text>
                            )}
                          </Text>
                          {pick.hasDoublePlay && (
                            <IconBolt size={12} color="var(--mantine-color-tangerine-6)" />
                          )}
                          {pick.status === "withdrawn" && (
                            <Badge size="xs" color="coral" variant="light">
                              WD
                            </Badge>
                          )}
                        </Group>
                        <Text
                          size="xs"
                          fw={600}
                          c={
                            pick.scoreToPar < 0
                              ? "mint.7"
                              : pick.scoreToPar > 0
                              ? "coral.6"
                              : "forest.6"
                          }
                        >
                          {formatToPar(pick.scoreToPar)}
                        </Text>
                      </Group>
                    );
                  })}
                </Stack>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
