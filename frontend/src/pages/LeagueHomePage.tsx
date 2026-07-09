import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Card,
  Title,
  Text,
  Stack,
  Button,
  Badge,
  Group,
  Center,
  Loader,
  CopyButton,
  ActionIcon,
  Tooltip,
  Alert,
} from "@mantine/core";
import {
  IconChartBar,
  IconGolf,
  IconSettings,
  IconCopy,
  IconCheck,
  IconTrophy,
  IconLock,
  IconBolt,
} from "@tabler/icons-react";
import { api, CurrentTournament, DoublePlayStatus, isStoredOwner, getStoredJoinCode } from "../api/client";

export default function LeagueHomePage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<CurrentTournament | null>(null);
  const [doublePlayStatus, setDoublePlayStatus] = useState<DoublePlayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isOwner = isStoredOwner();
  const joinCode = getStoredJoinCode();

  useEffect(() => {
    if (!leagueId) return;
    api
      .getCurrentTournament(leagueId)
      .then((t) => {
        setTournament(t);
        // double-play-status is keyed off whichever round we pass, but
        // resolves to the tournament as a whole - any round in the
        // tournament works, so the first one is fine here.
        if (t && t.rounds.length > 0 && t.status !== "completed") {
          api
            .getDoublePlayStatus(t.rounds[0].id)
            .then(setDoublePlayStatus)
            .catch(() => {});
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [leagueId]);

  if (loading) {
    return (
      <Center mt="xl">
        <Loader color="mint" />
      </Center>
    );
  }

  if (error) {
    return (
      <Text c="coral.4" ta="center">
        {error}
      </Text>
    );
  }

  // Find the last round and whether it's already locked, to decide
  // between a gentle reminder vs. a "you're about to lose it" warning.
  const finalRound = tournament?.rounds[tournament.rounds.length - 1];
  const finalRoundLocked = !!(
    finalRound?.locks_at && new Date(finalRound.locks_at) < new Date()
  );
  const nextOpenRound = tournament?.rounds.find(
    (r) => !r.locks_at || new Date(r.locks_at) >= new Date()
  );

  const tokenUnused = doublePlayStatus && !doublePlayStatus.used;

  return (
    <Stack gap="md">
      <Stack gap={2} align="center">
        <Title order={2} c="mint.3" ta="center">
          {tournament?.name || "Your League"}
        </Title>
        {tournament && (
          <Badge color={tournament.status === "live" ? "coral" : "tangerine"} variant="light">
            {tournament.status}
          </Badge>
        )}
      </Stack>

      {tokenUnused && finalRoundLocked && (
        <Alert color="forest" variant="light" icon={<IconBolt size={18} />}>
          <Text size="sm" c="forest.1">
            Your Double Play token went unused this tournament - it doesn't carry over.
          </Text>
        </Alert>
      )}

      {tokenUnused && !finalRoundLocked && finalRound && nextOpenRound && (
        <Alert
          color={nextOpenRound.id === finalRound.id ? "coral" : "tangerine"}
          icon={<IconBolt size={18} />}
          title={
            nextOpenRound.id === finalRound.id
              ? "Last chance for Double Play"
              : "Double Play unused"
          }
        >
          <Stack gap={6}>
            <Text size="sm">
              {nextOpenRound.id === finalRound.id
                ? "This is the final round - if you don't use your token here, it's gone for the tournament."
                : "You haven't used your Double Play token yet this tournament."}
            </Text>
            <Button
              size="xs"
              color={nextOpenRound.id === finalRound.id ? "coral" : "tangerine"}
              variant="white"
              onClick={() => navigate(`/round/${nextOpenRound.id}/pick`)}
            >
              Go to Round {nextOpenRound.round_number}
            </Button>
          </Stack>
        </Alert>
      )}

      {isOwner && joinCode && (
        <Card bg="forest.7" p="sm">
          <Group justify="space-between">
            <div>
              <Text size="xs" c="forest.2">
                League join code
              </Text>
              <Text fw={700} c="mint.3" ff="monospace" style={{ letterSpacing: 2 }}>
                {joinCode}
              </Text>
            </div>
            <CopyButton value={joinCode} timeout={1500}>
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

      {!tournament && (
        <Card bg="forest.7" p="lg">
          <Text c="forest.1" ta="center">
            {isOwner
              ? "No tournament yet — head to Admin to create one."
              : "No active tournament yet — ask the league owner to add the upcoming LIV event."}
          </Text>
        </Card>
      )}

      {tournament && (
        <Stack gap="xs">
          {tournament.rounds.map((r) => {
            const isLocked = r.locks_at && new Date(r.locks_at) < new Date();
            return (
              <Card key={r.id} p="md" bg="forest.7">
                <Group justify="space-between">
                  <Group gap="sm">
                    <IconGolf size={20} color="var(--mantine-color-mint-4)" />
                    <Text fw={600} c="white">
                      Round {r.round_number}
                    </Text>
                    <Badge color="forest" variant="light" size="sm">
                      {r.status}
                    </Badge>
                    {isLocked && (
                      <Badge color="coral" variant="light" size="sm" leftSection={<IconLock size={10} />}>
                        Locked
                      </Badge>
                    )}
                  </Group>
                  <Button
                    size="xs"
                    color="mint"
                    variant="light"
                    onClick={() => navigate(`/round/${r.id}/pick`)}
                  >
                    Pick
                  </Button>
                </Group>
              </Card>
            );
          })}

          <Button
            variant="outline"
            color="mint"
            leftSection={<IconChartBar size={16} />}
            onClick={() => navigate(`/league/${leagueId}/standings`)}
          >
            View Standings
          </Button>
          <Button
            variant="outline"
            color="tangerine"
            leftSection={<IconTrophy size={16} />}
            onClick={() => navigate(`/league/${leagueId}/career`)}
          >
            All-Time Leaderboard
          </Button>
        </Stack>
      )}

      {isOwner && (
        <Button
          variant="subtle"
          color="tangerine"
          leftSection={<IconSettings size={16} />}
          onClick={() => navigate(`/league/${leagueId}/admin`)}
        >
          League Admin
        </Button>
      )}
    </Stack>
  );
}
