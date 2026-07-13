import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Card,
  Title,
  Text,
  TextInput,
  Button,
  Stack,
  Alert,
  Anchor,
} from "@mantine/core";
import { IconTrophy, IconAlertTriangle } from "@tabler/icons-react";
import { api, setSession } from "../api/client";

export default function CreateLeaguePage() {
  const [leagueName, setLeagueName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.createLeague(
        leagueName.trim(),
        displayName.trim(),
        teamName.trim()
      );
      setSession(result.sessionToken, result.memberId, result.leagueId, result.isOwner, result.joinCode, teamName.trim(), result.leagueName);
      navigate(`/league/${result.leagueId}/pick`, { state: { justCreated: true } });
    } catch (err: any) {
      setError(err.message || "Couldn't create the league.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card bg="forest.7" p="xl">
      <Stack gap={4} mb="lg" align="center">
        <IconTrophy size={32} color="var(--mantine-color-tangerine-4)" />
        <Title order={2} c="forest.8" ta="center">
          Create a League
        </Title>
        <Text c="forest.1" size="sm" ta="center">
          You'll get a join code to share with colleagues
        </Text>
      </Stack>

      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="League Name"
            placeholder="Bolt6 Fantasy LIV"
            value={leagueName}
            onChange={(e) => setLeagueName(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Your Name"
            placeholder="Jam"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Your Team Name"
            placeholder="Birdie Believers"
            value={teamName}
            onChange={(e) => setTeamName(e.currentTarget.value)}
            required
          />

          {error && (
            <Alert color="coral" icon={<IconAlertTriangle size={18} />}>
              {error}
            </Alert>
          )}

          <Button type="submit" loading={loading} color="mint" size="md" fullWidth>
            Create League
          </Button>

          <Text size="sm" ta="center" c="forest.2">
            Already have a code?{" "}
            <Anchor component={Link} to="/join" c="tangerine.4">
              Join instead
            </Anchor>
          </Text>
        </Stack>
      </form>
    </Card>
  );
}
