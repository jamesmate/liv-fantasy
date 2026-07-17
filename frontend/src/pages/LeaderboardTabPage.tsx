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
  Modal,
  ActionIcon,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconBolt, IconInfoCircle } from "@tabler/icons-react";
import { api, LeaderboardResponse, LeaderboardTeam, BONUS_CATEGORY_INFO } from "../api/client";
import { getCountryFlagUrl } from "../utils/countryFlags";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { RoundSparkline } from "../components/RoundSparkline";
import { TeamTimingSummary } from "../components/TeamTimingSummary";
import { HeadlinesFeed } from "../components/HeadlinesFeed";
import { TournamentRecap } from "../components/TournamentRecap";

function formatToPar(n: number | null): string {
  if (n === null) return "-";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

// Shows how far through the round a pick is - or, if they haven't
// teed off yet, their tee time instead (parsed to the viewer's local
// time, not whatever timezone the course is in).
function formatThruOrTeeTime(status: string, thru: number | null, teeTime: string | null): string {
  if (status === "not_started") {
    if (!teeTime) return "";
    return new Date(teeTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (thru === null || thru <= 0) return "";
  if (thru >= 18) return "F";
  return `Thru ${thru}`;
}

// Red-neutral-green gradient for a 0-100 percentage (Pick IQ), same
// visual language as the score gradients elsewhere in the app, just
// scaled for a percent instead of a golf score.
function getPercentColor(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const deepRed: [number, number, number] = [150, 24, 24];
  const neutral: [number, number, number] = [230, 227, 218];
  const deepGreen: [number, number, number] = [22, 120, 62];
  const [from, to, t] =
    clamped <= 50 ? [deepRed, neutral, clamped / 50] : [neutral, deepGreen, (clamped - 50) / 50];
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

function getPercentTextColor(percent: number): string {
  return percent > 35 && percent < 65 ? "#2b2b2b" : "#ffffff";
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
      {leagueId && <TournamentRecap leagueId={leagueId} />}
      <Text size="lg" fw={800} c="forest.9" mb="xs">
        {data.tournament.name}
      </Text>
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
      {leagueId && <HeadlinesFeed leagueId={leagueId} />}
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
  const [infoOpen, setInfoOpen] = useState(false);

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
          <Box pt="sm" pb="xs">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Box style={{ minWidth: 0, flex: 1 }}>
                <Text size="10px" fw={700} c="forest.3" tt="uppercase" mb={4}>
                  All picks this tournament
                </Text>
                <TeamTimingSummary team={team} variant="light" />
              </Box>
              {team.timingScoreQualifyingPicks >= 2 && (
                <Box style={{ flexShrink: 0 }}>
                  <Group gap={2} wrap="nowrap" mb={3}>
                    <Text size="10px" fw={700} c="forest.3" tt="uppercase">
                      Hot Hand Score
                    </Text>
                    <ActionIcon
                      variant="subtle"
                      color="forest"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfoOpen(true);
                      }}
                      aria-label="How Hot Hand Score is calculated"
                    >
                      <IconInfoCircle size={12} />
                    </ActionIcon>
                  </Group>
                  <Box
                    style={{
                      backgroundColor: getPercentColor(team.timingScore!),
                      color: getPercentTextColor(team.timingScore!),
                      borderRadius: 8,
                      padding: "1px 7px",
                      display: "inline-block",
                    }}
                  >
                    <Text size="sm" fw={800}>
                      {team.timingScore}
                    </Text>
                  </Box>
                </Box>
              )}
            </Group>
          </Box>
          {team.rounds.map((round) => (
            <Box key={round.roundNumber} mb={6}>
              <Text size="xs" fw={700} c="forest.2" mb={4}>
                Round {round.roundNumber}
                {round.total !== null ? ` | ${formatToPar(round.total)}` : ""}
              </Text>
              {round.picks.length === 0 ? (
                <Text size="xs" c="forest.3" pl="xs">
                  No picks made
                </Text>
              ) : (
                <Stack gap={0} pl="xs">
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
                          <Text
                            size="xs"
                            c="forest.8"
                            lineClamp={1}
                            style={{ width: 92, flexShrink: 0 }}
                          >
                            {pick.playerName}
                            {pick.proTeamName && (
                              <Text span c="forest.3">
                                {" "}
                                · {pick.proTeamName}
                              </Text>
                            )}
                          </Text>
                          <RoundSparkline
                            roundScores={pick.playerRoundScores}
                            highlightRound={round.roundNumber}
                            highlightHasDoublePlay={pick.hasDoublePlay}
                            variant="light"
                            size={18}
                            gap={3}
                          />
                          {pick.hasDoublePlay && pick.status !== "completed" && (
                            <IconBolt size={12} color="var(--mantine-color-tangerine-6)" />
                          )}
                          {pick.status === "withdrawn" && (
                            <Badge size="xs" color="coral" variant="light">
                              WD
                            </Badge>
                          )}
                        </Group>
                        <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
                          {pick.status !== "not_started" && (
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
                          )}
                          <Text size="9px" c="forest.3">
                            {formatThruOrTeeTime(pick.status, pick.thru, pick.teeTime)}
                          </Text>
                        </Stack>
                      </Group>
                    );
                  })}
                </Stack>
              )}
              {round.bonusPick && (
                <Group
                  justify="space-between"
                  wrap="nowrap"
                  pl="xs"
                  mt={2}
                  pt={2}
                  style={{ borderTop: "1px dashed var(--mantine-color-tangerine-4)" }}
                >
                  <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text size="10px">{BONUS_CATEGORY_INFO[round.bonusPick.category ?? ""]?.emoji ?? "⭐"}</Text>
                    <Text size="xs" c="tangerine.7" fw={600} lineClamp={1}>
                      {round.bonusPick.playerName}
                      <Text span c="forest.3">
                        {" "}
                        · {BONUS_CATEGORY_INFO[round.bonusPick.category ?? ""]?.label ?? "Bonus"}
                      </Text>
                    </Text>
                  </Group>
                  <Text size="xs" fw={700} c="tangerine.7">
                    {round.bonusPick.points}pts
                  </Text>
                </Group>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>

      <Modal
        opened={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="How Hot Hand Score works"
        centered
        overlayProps={{ blur: 6, backgroundOpacity: 0.4 }}
      >
        <Stack gap="sm">
          <Text size="sm">
            Hot Hand Score measures how well a team's picks lined up with each player's actual good rounds - not
            just whether they picked good golfers, but whether they picked them at the right time.
          </Text>
          <Text size="sm">
            For every pick, we compare that round's score to the field's average score that same day, so a rough
            score on a brutal weather day and a good score on an easy scoring day are judged fairly against each
            other.
          </Text>
          <Text size="sm">
            Each pick is then ranked against that SAME player's other rounds in the tournament - landing on their
            best relative round scores 100%, their worst scores 0%, with the picks in between scored on a sliding
            scale. Hot Hand Score is the average across all of a team's qualifying picks.
          </Text>
          <Text size="10px" c="dimmed">
            Only shown once a team has at least 2 picks with enough data to compare fairly.
          </Text>
        </Stack>
      </Modal>
    </Box>
  );
}
