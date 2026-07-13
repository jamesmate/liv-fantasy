import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Card,
  Title,
  Text,
  TextInput,
  Textarea,
  Button,
  Stack,
  Group,
  Badge,
  Alert,
  SegmentedControl,
  ActionIcon,
  Divider,
  CopyButton,
  Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import {
  IconAlertTriangle,
  IconBan,
  IconLock,
  IconLockOpen,
  IconTrophy,
  IconCopy,
  IconCheck,
  IconTrash,
} from "@tabler/icons-react";
import {
  api,
  CurrentTournament,
  PoolPlayer,
  TournamentResult,
  getStoredJoinCode,
} from "../api/client";
import { getCountryFlagUrl } from "../utils/countryFlags";
import { ScheduleAdmin } from "../components/ScheduleAdmin";

export default function AdminPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<CurrentTournament | null>(null);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [results, setResults] = useState<TournamentResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finalizationWarning, setFinalizationWarning] = useState<string | null>(null);

  const [tournamentName, setTournamentName] = useState("");
  const [espnEventId, setEspnEventId] = useState("");
  const [creating, setCreating] = useState(false);

  const [bulkText, setBulkText] = useState("");
  const [addingPlayers, setAddingPlayers] = useState(false);

  const [seedingRoster, setSeedingRoster] = useState(false);
  const [seedResult, setSeedResult] = useState<{ added: number; skipped: number } | null>(null);
  const [clearingPlayers, setClearingPlayers] = useState(false);
  const [simulatingRound, setSimulatingRound] = useState<number | "all" | null>(null);
  const [simulateResult, setSimulateResult] = useState<string | null>(null);

  const [editingEspnId, setEditingEspnId] = useState("");
  const [savingEspnId, setSavingEspnId] = useState(false);
  const [populatingFromEspn, setPopulatingFromEspn] = useState(false);
  const [populateResult, setPopulateResult] = useState<{ eventName: string; fieldSize: number; added: number; skipped: number } | null>(null);

  async function handleDeleteTournament() {
    if (!tournament) return;
    const confirmed = window.confirm(
      `Delete "${tournament.name}" permanently? This removes all its rounds, players, picks, and scores. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.deleteTournament(tournament.id);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }


  async function handlePopulateFromEspn() {
    if (!tournament) return;
    setPopulatingFromEspn(true);
    setError(null);
    setPopulateResult(null);
    try {
      const result = await api.populateFromEspn(tournament.id);
      setPopulateResult(result);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPopulatingFromEspn(false);
    }
  }

  async function handleSaveEspnId() {
    if (!tournament) return;
    setSavingEspnId(true);
    setError(null);
    try {
      await api.setEspnEventId(tournament.id, editingEspnId.trim() || null);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEspnId(false);
    }
  }

  useEffect(() => {
    if (!leagueId) return;
    refresh();
  }, [leagueId]);

  async function refresh() {
    if (!leagueId) return;
    try {
      const t = await api.getCurrentTournament(leagueId);
      setTournament(t);
      setEditingEspnId(t?.espn_event_id ?? "");
      if (t) {
        const players = await api.getPlayerPool(t.id);
        setPool(players);
        if (t.status === "completed") {
          const r = await api.getTournamentResults(t.id);
          setResults(r);
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreateTournament(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createTournament({
        name: tournamentName.trim(),
        espnEventId: espnEventId.trim() || undefined,
      });
      setTournamentName("");
      setEspnEventId("");
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleSimulateRound(roundNumber: number) {
    if (!tournament) return;
    setSimulatingRound(roundNumber);
    setError(null);
    try {
      const result = await api.simulateRound(tournament.id, roundNumber);
      setSimulateResult(
        `Round ${roundNumber}: applied ${result.applied} of ${result.total}` +
          (result.skipped > 0 ? ` (${result.skipped} skipped - no match)` : "") +
          "."
      );
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSimulatingRound(null);
    }
  }

  async function handleSimulateAllRounds() {
    if (!tournament) return;
    setSimulatingRound("all");
    setError(null);
    try {
      const result = await api.simulateAllRounds(tournament.id);
      const summary = Object.entries(result.rounds)
        .map(([round, r]) => `R${round}: ${r.applied}/${r.total}`)
        .join(", ");
      setSimulateResult(`All rounds applied - ${summary}.`);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSimulatingRound(null);
    }
  }

  async function handleClearAllPlayers() {
    if (!tournament) return;
    const confirmed = window.confirm(
      `Remove all ${pool.length} players from this tournament's pool? This also deletes any picks already made against them. This can't be undone.`
    );
    if (!confirmed) return;

    setClearingPlayers(true);
    setError(null);
    try {
      await api.clearAllPlayers(tournament.id);
      setSeedResult(null);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setClearingPlayers(false);
    }
  }

  async function handleSeedRoster() {
    if (!tournament) return;
    setSeedingRoster(true);
    setError(null);
    try {
      const result = await api.seedDefaultRoster(tournament.id);
      setSeedResult(result);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSeedingRoster(false);
    }
  }

  async function handleBulkAdd() {
    if (!tournament) return;
    setAddingPlayers(true);
    setError(null);
    try {
      const lines = bulkText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const players = lines.map((line) => {
        const [fullName, proTeamName] = line.split(",").map((s) => s.trim());
        return { fullName, proTeamName: proTeamName || undefined };
      });
      await api.addPlayersBulk(tournament.id, players);
      setBulkText("");
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingPlayers(false);
    }
  }

  async function handleStatusChange(status: "upcoming" | "live" | "completed") {
    if (!tournament) return;
    setFinalizationWarning(null);
    try {
      const res = await api.setTournamentStatus(tournament.id, status);
      if ((res as any).finalizationWarning) {
        setFinalizationWarning((res as any).finalizationWarning);
      }
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleWithdraw(playerId: string) {
    try {
      await api.withdrawPlayer(playerId);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleLockChange(roundId: string, value: Date | null) {
    try {
      await api.setRoundLock(roundId, value ? value.toISOString() : null);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleToggleWin(memberId: string, current: boolean) {
    if (!tournament) return;
    try {
      await api.overrideWin(tournament.id, memberId, !current);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap={2} align="center">
        <Title order={2} c="forest.8">
          League Admin
        </Title>
        <Text c="forest.1" size="sm">
          Owner-only controls
        </Text>
      </Stack>

      {getStoredJoinCode() && (
        <Card bg="forest.7" p="sm">
          <Group justify="space-between">
            <div>
              <Text size="xs" c="forest.2">
                League join code
              </Text>
              <Text fw={700} c="forest.8" ff="monospace" style={{ letterSpacing: 2 }}>
                {getStoredJoinCode()}
              </Text>
            </div>
            <CopyButton value={getStoredJoinCode() ?? ""} timeout={1500}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied" : "Copy code"} withArrow>
                  <ActionIcon color={copied ? "mint" : "forest"} variant="light" onClick={copy}>
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        </Card>
      )}

      {error && (
        <Alert color="coral" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}

      <Button
        variant="subtle"
        color="tangerine"
        leftSection={<IconTrophy size={16} />}
        onClick={() => navigate(`/league/${leagueId}/career`)}
      >
        View All-Time Leaderboard
      </Button>

      {leagueId && <ScheduleAdmin leagueId={leagueId} />}

      {(!tournament || tournament.status === "completed") && (
        <Card bg="forest.7" p="lg">
          <Stack gap="sm">
            <Text fw={600} c="forest.9">
              {tournament ? "Start a new tournament" : "Create a tournament"}
            </Text>
            <Text size="sm" c="forest.2">
              4 rounds are created automatically, matching LIV's 2026 format. Team names and
              career wins carry over automatically from past tournaments in this league.
              {tournament && (
                <>
                  {" "}
                  "{tournament.name}" is completed and stays in the career record - creating a
                  new one here becomes the active tournament for picks going forward.
                </>
              )}
            </Text>
            <form onSubmit={handleCreateTournament}>
              <Stack gap="sm">
                <TextInput
                  label="Tournament name"
                  placeholder="LIV Golf Andalucía 2026"
                  value={tournamentName}
                  onChange={(e) => setTournamentName(e.currentTarget.value)}
                  required
                />
                <TextInput
                  label="ESPN event ID"
                  description={
                    <>
                      Required for live scores. Find it on ESPN's leaderboard URL, e.g.{" "}
                      <Text span ff="monospace" c="forest.8">
                        espn.com/golf/leaderboard?tournamentId=401809165
                      </Text>{" "}
                      → the ID is 401809165.
                    </>
                  }
                  placeholder="401809165"
                  value={espnEventId}
                  onChange={(e) => setEspnEventId(e.currentTarget.value)}
                />
                <Button type="submit" color="mint" loading={creating}>
                  {tournament ? "Create New Tournament" : "Create Tournament"}
                </Button>
              </Stack>
            </form>
          </Stack>
        </Card>
      )}

      {tournament && (
        <>
          <Card bg="forest.7" p="lg">
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={600} c="forest.9">
                  {tournament.name}
                </Text>
                <Group gap="xs">
                  <Badge color="tangerine" variant="light">
                    {tournament.status}
                  </Badge>
                  <ActionIcon
                    variant="subtle"
                    color="coral"
                    size="sm"
                    onClick={handleDeleteTournament}
                    aria-label="Delete tournament"
                    title="Delete this tournament"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
              <Text size="sm" c="forest.2">
                Set this live once the field is populated and the event begins. Mark it
                completed when the tournament ends to lock in wins and career stats.
              </Text>
              <SegmentedControl
                value={tournament.status}
                onChange={(v) => handleStatusChange(v as any)}
                color="mint"
                data={[
                  { label: "Upcoming", value: "upcoming" },
                  { label: "Live", value: "live" },
                  { label: "Completed", value: "completed" },
                ]}
              />

              {!tournament.espn_event_id && tournament.status === "live" && (
                <Alert color="coral" variant="light" icon={<IconAlertTriangle size={16} />}>
                  No ESPN event ID set - live scores can't sync until you add one below.
                </Alert>
              )}

              <Group gap="xs" align="flex-end">
                <TextInput
                  label="ESPN event ID"
                  placeholder="401809165"
                  value={editingEspnId}
                  onChange={(e) => setEditingEspnId(e.currentTarget.value)}
                  style={{ flex: 1 }}
                  size="sm"
                />
                <Button size="sm" color="mint" variant="light" loading={savingEspnId} onClick={handleSaveEspnId}>
                  Save
                </Button>
              </Group>

              <Button
                size="sm"
                color="tangerine"
                variant="light"
                loading={populatingFromEspn}
                disabled={!tournament.espn_event_id}
                onClick={handlePopulateFromEspn}
              >
                Populate players from ESPN
              </Button>
              <Text size="xs" c="dimmed">
                Pulls the current field for the saved ESPN event ID above and adds every player found. Safe to
                press again later (e.g. a few days into the event) - already-added players are skipped, not
                duplicated.
              </Text>
              {populateResult && (
                <Alert color="mint" variant="light">
                  "{populateResult.eventName}": {populateResult.fieldSize} players in the field, {populateResult.added} added
                  {populateResult.skipped > 0 ? `, ${populateResult.skipped} already in the pool` : ""}.
                </Alert>
              )}

              {finalizationWarning && (
                <Alert color="tangerine" variant="light" icon={<IconAlertTriangle size={16} />}>
                  {finalizationWarning}
                </Alert>
              )}
            </Stack>
          </Card>

          <Card bg="forest.7" p="lg">
            <Stack gap="sm">
              <Text fw={600} c="forest.9">
                Round locks
              </Text>
              <Text size="sm" c="forest.2">
                Set each round's lock time (e.g. tee time) - picks and swaps can't be changed
                after this. Leave blank for no lock.
              </Text>
              {tournament.rounds.map((r) => (
                <Group key={r.id} justify="space-between" wrap="nowrap">
                  <Group gap={6} wrap="nowrap">
                    {r.locks_at && new Date(r.locks_at) < new Date() ? (
                      <IconLock size={16} color="var(--mantine-color-coral-4)" />
                    ) : (
                      <IconLockOpen size={16} color="var(--mantine-color-mint-4)" />
                    )}
                    <Text size="sm" c="forest.9">
                      Round {r.round_number}
                    </Text>
                  </Group>
                  <DateTimePicker
                    placeholder="No lock set"
                    value={r.locks_at ? new Date(r.locks_at) : null}
                    onChange={(v) => handleLockChange(r.id, v)}
                    clearable
                    size="xs"
                    valueFormat="DD MMM, HH:mm"
                    w={180}
                  />
                </Group>
              ))}
            </Stack>
          </Card>

          <Card bg="forest.7" p="lg">
            <Stack gap="sm">
              <Text fw={600} c="forest.9">
                Testing
              </Text>
              <Text size="sm" c="forest.2">
                Loads real LIV Golf Andalucía results into this tournament's rounds - useful
                for testing scoring, standings, Double Play math, and the full
                live-to-completed-to-new-tournament flow against known real numbers. Only
                affects players matched by ESPN ID (i.e. players added via "Load Andalucía
                Roster").
              </Text>
              <Group gap="xs">
                {[1, 2, 3, 4].map((roundNum) => (
                  <Button
                    key={roundNum}
                    size="xs"
                    color="tangerine"
                    variant="light"
                    loading={simulatingRound === roundNum}
                    onClick={() => handleSimulateRound(roundNum)}
                  >
                    Round {roundNum}
                  </Button>
                ))}
              </Group>
              <Button
                color="tangerine"
                variant="filled"
                loading={simulatingRound === "all"}
                onClick={handleSimulateAllRounds}
              >
                Simulate All 4 Rounds
              </Button>
              {simulateResult && (
                <Text size="xs" c="forest.4">
                  {simulateResult}
                </Text>
              )}
            </Stack>
          </Card>

          {tournament.status === "completed" && results.length > 0 && (
            <Card bg="forest.7" p="lg">
              <Stack gap="sm">
                <Text fw={600} c="forest.9">
                  Final results
                </Text>
                <Text size="sm" c="forest.2">
                  Wins are auto-calculated from lowest score. Tap the trophy to override.
                </Text>
                <Stack gap={6}>
                  {results.map((r) => (
                    <Group key={r.id} justify="space-between">
                      <Group gap={8}>
                        <Text size="sm" c="forest.3" w={24}>
                          {r.placement}
                        </Text>
                        <Text size="sm" c="forest.9" fw={600}>
                          {r.team_name}
                        </Text>
                        <Text size="xs" c="forest.2">
                          {r.total_to_par > 0 ? `+${r.total_to_par}` : r.total_to_par}
                        </Text>
                      </Group>
                      <ActionIcon
                        variant={r.is_win ? "filled" : "subtle"}
                        color={r.is_win ? "tangerine" : "forest"}
                        size="sm"
                        onClick={() => handleToggleWin(r.member_id, r.is_win)}
                        aria-label="Toggle win"
                      >
                        <IconTrophy size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                </Stack>
              </Stack>
            </Card>
          )}

          <Card bg="forest.7" p="lg">
            <Stack gap="sm">
              <Text fw={600} c="forest.9">
                Quick start
              </Text>
              <Text size="sm" c="forest.2">
                Populate the pool with the real LIV Golf Andalucía 2026 field (57 players,
                with country flags) - safe to run even if you've already added a few
                manually, duplicates are skipped.
              </Text>
              <Button
                color="mint"
                variant="filled"
                loading={seedingRoster}
                onClick={handleSeedRoster}
              >
                Load Andalucía Roster
              </Button>
              {seedResult && (
                <Text size="xs" c="forest.4">
                  Added {seedResult.added}, skipped {seedResult.skipped} (already present).
                </Text>
              )}

              {pool.length > 0 && (
                <Button
                  color="coral"
                  variant="subtle"
                  size="xs"
                  loading={clearingPlayers}
                  onClick={handleClearAllPlayers}
                >
                  Clear all players ({pool.length}) and start over
                </Button>
              )}
            </Stack>
          </Card>

          <Card bg="forest.7" p="lg">
            <Stack gap="sm">
              <Text fw={600} c="forest.9">
                Add players
              </Text>
              <Text size="sm" c="forest.2">
                One per line. Optional pro team after a comma, e.g.{" "}
                <Text span ff="monospace" c="forest.8">
                  Jon Rahm, Legion XIII
                </Text>
              </Text>
              <Textarea
                placeholder={"Jon Rahm, Legion XIII\nTyrrell Hatton, Legion XIII"}
                value={bulkText}
                onChange={(e) => setBulkText(e.currentTarget.value)}
                minRows={4}
                autosize
              />
              <Button color="mint" variant="light" loading={addingPlayers} onClick={handleBulkAdd}>
                Add Players
              </Button>

              {pool.length > 0 && (
                <>
                  <Divider my="xs" color="forest.5" />
                  <Text size="sm" c="forest.2">
                    {pool.length} players in the pool
                  </Text>
                  <Stack gap={6}>
                    {pool.map((p) => {
                      const flagUrl = getCountryFlagUrl(p.country_code);
                      return (
                        <Group key={p.id} justify="space-between">
                          <Group gap={6} wrap="nowrap">
                            {flagUrl && (
                              <img
                                src={flagUrl}
                                alt={p.country_code ?? ""}
                                width={18}
                                height={14}
                                style={{ borderRadius: 2, flexShrink: 0 }}
                              />
                            )}
                            <Text size="sm" c={p.is_active ? "forest.9" : "forest.3"}>
                              {p.full_name}
                              {p.pro_team_name ? ` · ${p.pro_team_name}` : ""}
                            </Text>
                          </Group>
                          {p.is_active ? (
                            <ActionIcon
                              variant="subtle"
                              color="coral"
                              size="sm"
                              onClick={() => handleWithdraw(p.id)}
                              aria-label="Mark withdrawn"
                            >
                              <IconBan size={16} />
                            </ActionIcon>
                          ) : (
                            <Badge size="sm" color="coral" variant="light">
                              {p.inactive_reason === "missed_cut" ? "Missed Cut" : "Withdrawn"}
                            </Badge>
                          )}
                        </Group>
                      );
                    })}
                  </Stack>
                </>
              )}
            </Stack>
          </Card>
        </>
      )}
    </Stack>
  );
}
