import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Card,
  Title,
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
} from "@mantine/core";
import {
  IconCheck,
  IconBan,
  IconAlertTriangle,
  IconArrowsExchange,
  IconLock,
  IconBolt,
} from "@tabler/icons-react";
import {
  api,
  PlayerOption,
  NeedsSwapPick,
  RoundInfo,
  DoublePlayStatus,
} from "../api/client";
import { SelectedLineup } from "../components/SelectedLineup";
import { PixelGolferSprite } from "../components/sprites/PixelGolferSprite";

export default function PickPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [doublePlayId, setDoublePlayId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const [needsSwap, setNeedsSwap] = useState<NeedsSwapPick[]>([]);
  const [swapTarget, setSwapTarget] = useState<NeedsSwapPick | null>(null);
  const [swapping, setSwapping] = useState(false);

  const [doublePlayStatus, setDoublePlayStatus] = useState<DoublePlayStatus | null>(null);

  const isLocked = !!(round?.locks_at && new Date(round.locks_at) < new Date());

  // Token is unavailable this round if it's already been spent in a
  // DIFFERENT round. If it was spent in THIS round (doublePlayId is
  // already set from my-picks), that's fine - it can still move
  // between this round's 4 players freely until submit.
  const tokenUsedElsewhere =
    doublePlayStatus?.used && doublePlayStatus.round_id !== roundId;

  const isFinalRound = !!(round && round.round_number === round.total_rounds);
  const tokenStillUnusedOnFinalRound =
    isFinalRound && doublePlayStatus && !doublePlayStatus.used && !doublePlayId;

  useEffect(() => {
    if (!roundId) return;
    api.getRound(roundId).then(setRound).catch((err) => setError(err.message));
    loadPlayers();
    loadMyPicks();
    checkNeedsSwap();
    api.getDoublePlayStatus(roundId).then(setDoublePlayStatus).catch(() => {});
    // Re-check periodically in case a player withdraws while this page
    // is open during a live round.
    const interval = setInterval(checkNeedsSwap, 60_000);
    return () => clearInterval(interval);
  }, [roundId]);

  function loadPlayers() {
    if (!roundId) return;
    api.getAvailablePlayers(roundId).then(setPlayers).catch((err) => setError(err.message));
  }

  function loadMyPicks() {
    if (!roundId) return;
    api
      .getMyPicks(roundId)
      .then((picks) => {
        if (picks.length > 0) {
          setSelected(picks.map((p) => p.tournament_player_id));
          const tokenPick = picks.find((p) => p.has_double_play);
          if (tokenPick) setDoublePlayId(tokenPick.tournament_player_id);
        }
      })
      .catch(() => {});
  }

  function checkNeedsSwap() {
    if (!roundId) return;
    api
      .getNeedsSwap(roundId)
      .then(setNeedsSwap)
      .catch(() => {
        // Non-critical - silently skip if this fails (e.g. before any
        // picks have been made yet, which is a normal state).
      });
  }

  function togglePlayer(id: string, disabled: boolean) {
    if (disabled) return;
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
      // The token (if it was on the swapped-out player) transfers
      // automatically server-side - reflect that locally too.
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

  return (
    <Stack gap="md">
      {isLocked && (
        <Alert color="coral" icon={<IconLock size={18} />} title="Picks locked">
          <Text size="sm">
            This round's pick window has closed. You can still view your team below, but no
            changes can be made.
          </Text>
        </Alert>
      )}

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
            This is the final round - your Double Play token hasn't been used yet. Tap the
            bolt icon on one of your picks below to use it before this round locks, or it's
            gone for the tournament.
          </Text>
        </Alert>
      )}

      <SelectedLineup
        slots={selected.map((id) => {
          const p = players.find((pl) => pl.id === id);
          return { id, name: p?.full_name ?? "?" };
        })}
      />

      <Stack gap={2} align="center">
        <Title order={2} c="mint.3">
          Pick Your 4
        </Title>
        <Text c="forest.1" size="sm">
          Players already used this tournament are locked out
        </Text>
        <Progress
          value={(selected.length / 4) * 100}
          color="mint"
          size="sm"
          w="100%"
          mt={6}
          radius="xl"
        />
        <Text size="xs" c="forest.2">
          {selected.length} / 4 selected
        </Text>
      </Stack>

      <Stack gap="xs">
        {players.map((p) => {
          const disabled = isLocked || p.already_used || !p.is_active;
          const isSelected = selected.includes(p.id);
          const hasToken = doublePlayId === p.id;
          return (
            <Card
              key={p.id}
              p="sm"
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
                  gap="sm"
                  wrap="nowrap"
                  style={{ flex: 1, cursor: disabled ? "not-allowed" : "pointer" }}
                  onClick={() => togglePlayer(p.id, disabled)}
                >
                  <ThemeIcon
                    variant="light"
                    color={isSelected ? "mint" : "forest"}
                    radius="xl"
                    size={40}
                    style={{ overflow: "hidden", padding: 2 }}
                  >
                    <PixelGolferSprite playerName={p.full_name} size={32} bobbing={false} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} c="white" size="sm">
                      {p.full_name}
                    </Text>
                    {p.pro_team_name && (
                      <Text size="xs" c="forest.2">
                        {p.pro_team_name}
                      </Text>
                    )}
                  </div>
                </Group>

                <Group gap={6} wrap="nowrap">
                  {!p.is_active && (
                    <Badge color="coral" leftSection={<IconBan size={12} />}>
                      Withdrawn
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
                  {isSelected && !disabled && (
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

      {error && (
        <Alert color="coral" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}

      <Button
        disabled={isLocked || selected.length !== 4 || status === "saving"}
        loading={status === "saving"}
        onClick={handleSubmit}
        color="mint"
        size="md"
        fullWidth
      >
        {isLocked ? "Picks Locked" : status === "saved" ? "Picks Saved ✓" : "Submit Picks"}
      </Button>

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
