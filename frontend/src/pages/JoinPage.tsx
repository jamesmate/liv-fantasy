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
import { IconFlag3, IconAlertTriangle } from "@tabler/icons-react";
import { api, setSession } from "../api/client";

export default function JoinPage() {
  const [joinCode, setJoinCode] = useState("");
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
      const result = await api.joinLeague(joinCode.trim(), displayName.trim(), teamName.trim());
      setSession(result.sessionToken, result.memberId, result.leagueId, result.isOwner, undefined, teamName.trim(), result.leagueName);
      navigate(`/league/${result.leagueId}/pick`);
    } catch (err: any) {
      setError(err.message || "Couldn't join. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card bg="forest.7" p="xl">
      <Stack gap={4} mb="lg" align="center">
        <IconFlag3 size={32} color="var(--mantine-color-tangerine-4)" />
        <Title order={2} c="forest.8" ta="center">
          Join Your League
        </Title>
        <Text c="forest.1" size="sm" ta="center">
          Enter the code your league owner shared with you
        </Text>
      </Stack>

      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="League Code"
            placeholder="ABC123"
            value={joinCode}
            onChange={(e) => setJoinCode(e.currentTarget.value.toUpperCase())}
            maxLength={6}
            styles={{ input: { textTransform: "uppercase", letterSpacing: 2 } }}
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
            label="Team Name"
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
            Join League
          </Button>

          <Text size="sm" ta="center" c="forest.2">
            Starting a new league?{" "}
            <Anchor component={Link} to="/create" c="tangerine.4">
              Create one
            </Anchor>
          </Text>
          <Text size="sm" ta="center" c="forest.2">
            Already have a team on another device?{" "}
            <Anchor component={Link} to="/login" c="tangerine.4">
              Log in
            </Anchor>
          </Text>
        </Stack>
      </form>
    </Card>
  );
}
