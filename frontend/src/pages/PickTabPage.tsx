import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Text,
  Stack,
  Group,
  Badge,
  Button,
  Alert,
  ThemeIcon,
  Progress,
  Modal,
  ActionIcon,
  Tooltip,
  Card,
  Center,
} from "@mantine/core";
import {
  IconCheck,
  IconBan,
  IconAlertTriangle,
  IconArrowsExchange,
  IconLock,
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  api,
  PlayerOption,
  NeedsSwapPick,
  DoublePlayStatus,
  CurrentTournament,
  MyPickWithScore,
  getStoredTeamName,
} from "../api/client";
import { SelectedLineup } from "../components/SelectedLineup";
import { PixelGolferSprite } from "../components/sprites/PixelGolferSprite";
import { getCountryFlagUrl } from "../utils/countryFlags";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { BonusPickCard } from "../components/BonusPickCard";

function formatToPar(totalToPar: number | null): string {
  if (totalToPar === null) return "-";
  if (totalToPar === 0) return "E";
  return totalToPar > 0 ? `+${totalToPar}` : `${totalToPar}`;
}

// Mirrors the backend's apply_double_play() SQL function exactly -
// needed here because the lineup zone must reflect the LIVE (possibly
// unsaved) double play toggle instantly, but the backend's
// effective_score_to_par only reflects whatever was last actually
// saved. Without this, toggling the bolt icon before hitting save
// would show the un-doubled score until the next save/reload, even
// though the ring/pose already updated live.
function applyDoublePlay(score: number): number {
  if (score < 0) return score * 2;
  if (score > 0) return Math.ceil(score / 2);
  return 0;
}

// Diverging red-to-green gradient for a single round's score, used on
// the small per-round chips in the pick list. Deep green for a very
// good round, a light neutral tone right around even par, deep red
// for a very bad one - clamped at +/-5 so one blow-up hole doesn't
// blow out the whole scale.
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

// White text reads fine on the saturated ends of the gradient, but not
// on the pale neutral middle - switch to dark text once we're close
// enough to even par.
function getScoreTextColor(scoreToPar: number): string {
  return Math.abs(scoreToPar) <= 1 ? "#2b2b2b" : "#ffffff";
}

// Common lowercase surname particles that belong WITH the following
// word rather than being treated as part of the first name - e.g.
// "Erik van Rooyen" should sort under "van Rooyen", not just "Rooyen".
const SURNAME_PARTICLES = new Set(["van", "von", "de", "du", "la", "le", "der", "den", "di", "da"]);

function getSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  const lastIndex = parts.length - 1;
  // Walk backwards from the last word, absorbing any particle(s)
  // immediately before it (handles "van Rooyen", "von Dellingshausen",
  // and the rare double-particle case like "van der Berg").
  let start = lastIndex;
  while (start > 0 && SURNAME_PARTICLES.has(parts[start - 1].toLowerCase())) {
    start--;
  }
  return parts.slice(start).join(" ");
}

export default function PickTabPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [tournament, setTournament] = useState<CurrentTournament | null>(null);
  const [activeRoundNumber, setActiveRoundNumber] = useState<number>(1);
  const [loadingTournament, setLoadingTournament] = useState(true);

  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [sortMode, setSortMode] = useState<"name" | "leaderboard">("name");
  const [selected, setSelected] = useState<string[]>([]);
  const [doublePlayId, setDoublePlayId] = useState<string | null>(null);
  const [scoredPicks, setScoredPicks] = useState<MyPickWithScore[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const [needsSwap, setNeedsSwap] = useState<NeedsSwapPick[]>([]);
  const [swapTarget, setSwapTarget] = useState<NeedsSwapPick | null>(null);
  const [swapping, setSwapping] = useState(false);

  const [doublePlayStatus, setDoublePlayStatus] = useState<DoublePlayStatus | null>(null);

  const activeRound = tournament?.rounds.find((r) => r.round_number === activeRoundNumber);
  const roundId = activeRound?.id ?? null;
  const isLocked = !!(activeRound?.locks_at && new Date(activeRound.locks_at) < new Date());
  const teamName = getStoredTeamName();
  const isLiveOrCompleted = tournament?.status === "live" || tournament?.status === "completed";
  const showScores = isLocked && isLiveOrCompleted;

  const tokenUsedElsewhere = doublePlayStatus?.used && doublePlayStatus.round_id !== roundId;
  const isFinalRound = !!(tournament && activeRoundNumber === tournament.rounds.length);
  const tokenStillUnusedOnFinalRound =
    isFinalRound && doublePlayStatus && !doublePlayStatus.used && !doublePlayId;

  // Leaderboard sort puts players with no recorded score (not started
  // yet, or ESPN data not synced) at the end rather than treating a
  // null total as "best". Name sort is by SURNAME (not the backend's
  // default first-name ordering) since that's how people actually
  // look someone up in a golf field.
  const sortedPlayers =
    sortMode === "leaderboard"
      ? [...players].sort((a, b) => {
          if (a.total_to_par === null && b.total_to_par === null) return a.full_name.localeCompare(b.full_name);
          if (a.total_to_par === null) return 1;
          if (b.total_to_par === null) return -1;
          return a.total_to_par - b.total_to_par;
        })
      : [...players].sort((a, b) => getSurname(a.full_name).localeCompare(getSurname(b.full_name)));

  // Load the tournament once, default to its most sensible "current"
  // round (first upcoming/in-progress round, else the last round).
  useEffect(() => {
    if (!leagueId) return;
    setLoadingTournament(true);
    api
      .getCurrentTournament(leagueId)
      .then((t) => {
        setTournament(t);
        if (t && t.rounds.length > 0) {
          const firstOpen = t.rounds.find(
            (r) => !r.locks_at || new Date(r.locks_at) >= new Date()
          );
          setActiveRoundNumber((firstOpen ?? t.rounds[t.rounds.length - 1]).round_number);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingTournament(false));
  }, [leagueId]);

  const loadPlayers = useCallback(() => {
    if (!roundId) return;
    api.getAvailablePlayers(roundId).then(setPlayers).catch((err) => setError(err.message));
  }, [roundId]);

  const loadMyPicks = useCallback(() => {
    if (!roundId) return;
    setSelected([]);
    setDoublePlayId(null);
    setScoredPicks([]);

    if (showScores) {
      // Locked + live/completed round: show actual scores, sourced
      // from pick_scores (joined with player_round_scores).
      api
        .getMyPicksWithScores(roundId)
        .then((picks) => {
          setSelected(picks.map((p) => p.tournament_player_id));
          setScoredPicks(picks);
          const tokenPick = picks.find((p) => p.has_double_play);
          if (tokenPick) setDoublePlayId(tokenPick.tournament_player_id);
        })
        .catch(() => {});
    } else {
      // Upcoming/editable round: show the raw pick list only.
      api
        .getMyPicks(roundId)
        .then((picks) => {
          setSelected(picks.map((p) => p.tournament_player_id));
          const tokenPick = picks.find((p) => p.has_double_play);
          if (tokenPick) setDoublePlayId(tokenPick.tournament_player_id);
        })
        .catch(() => {});
    }
  }, [roundId, showScores]);

  const checkNeedsSwap = useCallback(() => {
    if (!roundId) return;
    api.getNeedsSwap(roundId).then(setNeedsSwap).catch(() => {});
  }, [roundId]);

  useEffect(() => {
    if (!roundId) return;
    loadPlayers();
    loadMyPicks();
    checkNeedsSwap();
    api.getDoublePlayStatus(roundId).then(setDoublePlayStatus).catch(() => {});
    const interval = setInterval(() => {
      checkNeedsSwap();
      if (showScores) loadMyPicks(); // pick up live score updates while viewing a live round
    }, 60_000);
    return () => clearInterval(interval);
  }, [roundId, loadPlayers, loadMyPicks, checkNeedsSwap, showScores]);

  function togglePlayer(id: string, disabled: boolean) {
    if (disabled || isLocked) return;
    setStatus("idle");
    setSelected((prev) => {
      if (prev.includes(id)) {
        if (doublePlayId === id) setDoublePlayId(null);
        return prev.filter((p) => p !== id);
      }
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  function toggleDoublePlay(id: string) {
    if (isLocked || tokenUsedElsewhere) return;
    setDoublePlayId((prev) => (prev === id ? null : id));
  }

  async function handleSubmit() {
    if (!roundId || selected.length !== 4) return;
    setStatus("saving");
    setError(null);
    try {
      await api.submitPicks(roundId, selected, doublePlayId);
      setStatus("saved");
      checkNeedsSwap();
      api.getDoublePlayStatus(roundId).then(setDoublePlayStatus).catch(() => {});
    } catch (err: any) {
      setError(err.message || "Couldn't save picks.");
      setStatus("idle");
    }
  }

  async function handleSwapConfirm(incomingId: string) {
    if (!roundId || !swapTarget) return;
    setSwapping(true);
    setError(null);
    try {
      await api.swapPick(roundId, swapTarget.tournament_player_id, incomingId);
      if (doublePlayId === swapTarget.tournament_player_id) {
        setDoublePlayId(incomingId);
      }
      setSelected((prev) =>
        prev.map((id) => (id === swapTarget.tournament_player_id ? incomingId : id))
      );
      setSwapTarget(null);
      loadPlayers();
      checkNeedsSwap();
    } catch (err: any) {
      setError(err.message || "Couldn't complete the swap.");
    } finally {
      setSwapping(false);
    }
  }

  const lineupSlots = selected.map((id) => {
    const p = players.find((pl) => pl.id === id);
    const scored = scoredPicks.find((sp) => sp.tournament_player_id === id);
    // Live selection (before saving) takes priority over the saved
    // flag from a previous save - see applyDoublePlay() comment for
    // why the score itself must be recomputed here too, not just the
    // ring/pose.
    const liveHasDoublePlay = doublePlayId === id || !!scored?.has_double_play;
    const rawScore = scored?.score_to_par;
    const scoreToPar =
      rawScore === undefined ? undefined : liveHasDoublePlay ? applyDoublePlay(rawScore) : rawScore;
    return {
      id,
      name: p?.full_name ?? scored?.player_name ?? "?",
      scoreToPar,
      hasDoublePlay: liveHasDoublePlay,
      isCompleted: scored?.player_status === "completed",
      roundScores: p?.round_scores.map((rs) => ({
        roundNumber: rs.round_number,
        scoreToPar: rs.score_to_par,
        fieldAvg: rs.field_avg,
        fieldBest: rs.field_best,
      })),
      currentRoundNumber: activeRoundNumber,
    };
  });

  // The picked player with the best (lowest) score this round gets the
  // golf-club pose instead of their usual deterministic one - only
  // meaningful once scores are actually visible (round locked + live/
  // completed), and only when scores are loaded for all 4 picks.
  const topScorerName = (() => {
    if (!showScores || scoredPicks.length === 0) return null;
    const scored = scoredPicks.filter((sp) => sp.effective_score_to_par !== null);
    if (scored.length === 0) return null;
    const best = scored.reduce((min, sp) =>
      sp.effective_score_to_par < min.effective_score_to_par ? sp : min
    );
    return best.player_name;
  })();

  if (loadingTournament) {
    return (
      <Center style={{ height: "calc(100dvh - var(--app-shell-header-height, 60px) - var(--app-shell-footer-height, 64px))" }}>
        <LoadingIndicator />
      </Center>
    );
  }

  if (!tournament) {
    return (
      <Stack p="md">
        <Text c="forest.2" ta="center">
          No active tournament yet — ask the league owner to set one up in Admin.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack
      gap={0}
      style={{
        height:
          "calc(100dvh - var(--app-shell-header-height, 60px) - var(--app-shell-footer-height, 64px))",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Top 1/3: lineup zone over the course background - fixed,
          does not scroll or shrink */}
      <Box
        style={{
          height: "24vh",
          minHeight: 170,
          flexShrink: 0,
          position: "relative",
        }}
      >
        <SelectedLineup
          slots={lineupSlots}
          showScores={showScores}
          teamName={teamName}
          tournamentName={tournament?.name}
          roundNumber={activeRoundNumber}
          isLocked={isLocked}
          topScorerName={topScorerName}
        />

        {/* Round arrows pinned to the left/right edges of the lineup
            zone, rather than centered together next to the round
            label - matches the requested layout. */}
        <Box style={{ position: "absolute", top: "50%", left: 8, transform: "translateY(-50%)" }}>
          <ActionIcon
            variant="filled"
            color="forest.8"
            radius="xl"
            size={36}
            disabled={activeRoundNumber <= 1}
            onClick={() => setActiveRoundNumber(activeRoundNumber - 1)}
            aria-label="Previous round"
          >
            <IconChevronLeft size={20} />
          </ActionIcon>
        </Box>
        <Box
          style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)" }}
        >
          <ActionIcon
            variant="filled"
            color="forest.8"
            radius="xl"
            size={36}
            disabled={activeRoundNumber >= tournament.rounds.length}
            onClick={() => setActiveRoundNumber(activeRoundNumber + 1)}
            aria-label="Next round"
          >
            <IconChevronRight size={20} />
          </ActionIcon>
        </Box>
      </Box>

      <BonusPickCard roundId={roundId} isLocked={isLocked} />

      {/* Bottom 2/3: scrollable player list */}
      <Box style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 16px" }}>
        <Stack gap={6}>
          {!isLocked && needsSwap.length > 0 && (
            <Alert color="coral" icon={<IconArrowsExchange size={18} />} title="Swap needed">
              <Stack gap={6}>
                <Text size="sm">
                  {needsSwap.length === 1
                    ? `${needsSwap[0].full_name} has withdrawn. Pick a replacement before the round locks.`
                    : `${needsSwap.length} of your picks have withdrawn. Pick replacements before the round locks.`}
                </Text>
                <Group gap="xs">
                  {needsSwap.map((n) => (
                    <Button
                      key={n.pick_id}
                      size="xs"
                      color="coral"
                      variant="white"
                      onClick={() => setSwapTarget(n)}
                    >
                      Swap {n.full_name}
                    </Button>
                  ))}
                </Group>
              </Stack>
            </Alert>
          )}

          {!isLocked && tokenUsedElsewhere && doublePlayStatus?.used && (
            <Alert color="tangerine" variant="light" icon={<IconBolt size={18} />}>
              <Text size="sm">
                Your Double Play token is already on {doublePlayStatus.full_name} in Round{" "}
                {doublePlayStatus.round_number}.
              </Text>
            </Alert>
          )}

          {!isLocked && tokenStillUnusedOnFinalRound && (
            <Alert color="coral" icon={<IconBolt size={18} />} title="Last chance for Double Play">
              <Text size="sm">
                This is the final round - use your Double Play token before this round locks,
                or it's gone for the tournament.
              </Text>
            </Alert>
          )}

          {!isLocked && (
            <Progress
              value={(selected.length / 4) * 100}
              color="mint"
              size="sm"
              radius="xl"
            />
          )}

          <Group justify="flex-end" gap={6}>
            <Text size="xs" c="forest.3">
              Sort:
            </Text>
            <Button.Group>
              <Button
                size="compact-xs"
                variant={sortMode === "name" ? "filled" : "light"}
                color="mint"
                onClick={() => setSortMode("name")}
              >
                Surname
              </Button>
              <Button
                size="compact-xs"
                variant={sortMode === "leaderboard" ? "filled" : "light"}
                color="mint"
                onClick={() => setSortMode("leaderboard")}
              >
                Leaderboard
              </Button>
            </Button.Group>
          </Group>

          {sortedPlayers.map((p) => {
            const disabled = isLocked || p.already_used || !p.is_active;
            const isSelected = selected.includes(p.id);
            const hasToken = doublePlayId === p.id;
            const flagUrl = getCountryFlagUrl(p.country_code);
            return (
              <Card
                key={p.id}
                p={8}
                bg={isSelected ? "mint.9" : "forest.7"}
                style={{
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  borderColor: hasToken
                    ? "var(--mantine-color-tangerine-5)"
                    : isSelected
                    ? "var(--mantine-color-mint-5)"
                    : "var(--mantine-color-forest-5)",
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Group
                    gap={8}
                    wrap="nowrap"
                    style={{ flex: 1, cursor: disabled ? "not-allowed" : "pointer" }}
                    onClick={() => togglePlayer(p.id, disabled)}
                  >
                    <ThemeIcon
                      variant="light"
                      color={isSelected ? "mint" : "forest"}
                      radius="xl"
                      size={30}
                      style={{ overflow: "hidden", padding: 2, flexShrink: 0 }}
                    >
                      <PixelGolferSprite
                        playerName={p.full_name}
                        size={24}
                        bobbing={false}
                        isTopScorer={hasToken}
                      />
                    </ThemeIcon>
                    <div>
                      <Group gap={4} wrap="nowrap">
                        {flagUrl && (
                          <img
                            src={flagUrl}
                            alt={p.country_code ?? ""}
                            width={18}
                            height={14}
                            style={{ borderRadius: 2, flexShrink: 0 }}
                          />
                        )}
                        <Text fw={600} c={isSelected ? "mint.0" : "forest.9"} size="sm">
                          {p.full_name}
                        </Text>
                      </Group>
                      {p.pro_team_name && (
                        <Text size="xs" c={isSelected ? "mint.2" : "forest.2"}>
                          {p.pro_team_name}
                        </Text>
                      )}
                      {p.round_scores.length > 0 && (
                        <Group gap={3} mt={2} wrap="nowrap">
                          {p.round_scores.map((rs) => (
                            <Text
                              key={rs.round_number}
                              size="10px"
                              fw={700}
                              ta="center"
                              style={{
                                backgroundColor: getScoreColor(rs.score_to_par),
                                color: getScoreTextColor(rs.score_to_par),
                                borderRadius: 3,
                                width: 20,
                                lineHeight: "15px",
                                flexShrink: 0,
                              }}
                            >
                              {rs.score_to_par === 0 ? "E" : rs.score_to_par > 0 ? `+${rs.score_to_par}` : rs.score_to_par}
                            </Text>
                          ))}
                        </Group>
                      )}
                    </div>
                  </Group>

                  <Group gap={6} wrap="nowrap">
                    {p.total_to_par !== null && (
                      <Text
                        size="sm"
                        fw={700}
                        c={
                          p.total_to_par < 0
                            ? "mint.4"
                            : p.total_to_par > 0
                            ? "coral.4"
                            : isSelected
                            ? "mint.1"
                            : "forest.2"
                        }
                        style={{ minWidth: 30, textAlign: "right" }}
                      >
                        {formatToPar(p.total_to_par)}
                      </Text>
                    )}
                    {!p.is_active && (
                      <Badge color="coral" leftSection={<IconBan size={12} />}>
                        {p.inactive_reason === "missed_cut" ? "Missed Cut" : "Withdrawn"}
                      </Badge>
                    )}
                    {p.already_used && p.is_active && (
                      <Badge color="tangerine" variant="light">
                        Already used
                      </Badge>
                    )}
                    {isSelected && !disabled && (
                      <Tooltip
                        label={
                          hasToken
                            ? "Double Play active - tap to remove"
                            : "Tap to use your Double Play token here"
                        }
                        withArrow
                        disabled={tokenUsedElsewhere}
                      >
                        <ActionIcon
                          variant={hasToken ? "filled" : "subtle"}
                          color="tangerine"
                          radius="xl"
                          size={28}
                          disabled={tokenUsedElsewhere || isLocked}
                          onClick={() => toggleDoublePlay(p.id)}
                          aria-label="Toggle Double Play"
                        >
                          <IconBolt size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    {isSelected && (
                      <ThemeIcon color="mint" radius="xl" size={24}>
                        <IconCheck size={14} />
                      </ThemeIcon>
                    )}
                  </Group>
                </Group>
              </Card>
            );
          })}
        </Stack>
      </Box>

      {/* Fixed action bar - always visible, not part of the scrollable
          list, so Submit Picks never requires scrolling to reach. */}
      {!isLocked && (
        <Box
          style={{
            flexShrink: 0,
            padding: "10px 16px",
            borderTop: "1px solid var(--mantine-color-forest-3)",
            background: "var(--mantine-color-forest-0)",
          }}
        >
          {error && (
            <Alert color="coral" icon={<IconAlertTriangle size={18} />} mb="xs">
              {error}
            </Alert>
          )}
          <Button
            disabled={selected.length !== 4 || status === "saving"}
            loading={status === "saving"}
            onClick={handleSubmit}
            color="mint"
            size="md"
            fullWidth
          >
            {status === "saved" ? "Picks Saved ✓" : "Submit Picks"}
          </Button>
        </Box>
      )}

      <Modal
        opened={!!swapTarget}
        onClose={() => setSwapTarget(null)}
        title={swapTarget ? `Replace ${swapTarget.full_name}` : ""}
        centered
      >
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Pick a replacement that you haven't used elsewhere in this tournament.
          </Text>
          {players
            .filter((p) => !p.already_used && p.is_active)
            .map((p) => (
              <Button
                key={p.id}
                variant="light"
                color="mint"
                loading={swapping}
                onClick={() => handleSwapConfirm(p.id)}
                justify="space-between"
                fullWidth
              >
                {p.full_name}
              </Button>
            ))}
        </Stack>
      </Modal>
    </Stack>
  );
}
