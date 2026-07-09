import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Card,
  Title,
  Text,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Anchor,
} from "@mantine/core";
import { IconFlag3, IconAlertTriangle } from "@tabler/icons-react";
import { api, setSession } from "../api/client";

export default function LoginPage() {
  const [joinCode, setJoinCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.loginToTeam(joinCode.trim(), teamName.trim(), passcode);
      setSession(result.sessionToken, result.memberId, result.leagueId, result.isOwner, undefined, teamName.trim());
      navigate(`/league/${result.leagueId}/pick`);
    } catch (err: any) {
      setError(err.message || "Couldn't log in. Check your details and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card bg="forest.7" p="xl">
      <Stack gap={4} mb="lg" align="center">
        <IconFlag3 size={32} color="var(--mantine-color-tangerine-4)" />
        <Title order={2} c="forest.8" ta="center">
          Log In to Your Team
        </Title>
        <Text c="forest.1" size="sm" ta="center">
          Already have a team? Log back in from any device with your passcode.
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
            label="Team Name"
            placeholder="Birdie Believers"
            value={teamName}
            onChange={(e) => setTeamName(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label="Passcode"
            placeholder="Your team's passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.currentTarget.value)}
            required
          />

          {error && (
            <Alert color="coral" icon={<IconAlertTriangle size={18} />}>
              {error}
            </Alert>
          )}

          <Button type="submit" loading={loading} color="mint" size="md" fullWidth>
            Log In
          </Button>

          <Text size="sm" ta="center" c="forest.2">
            New here?{" "}
            <Anchor component={Link} to="/join" c="tangerine.4">
              Join a league
            </Anchor>
          </Text>
          <Text size="sm" ta="center" c="forest.2">
            Note: logging in on a new device will sign this team out of any other device it was logged into.
          </Text>
        </Stack>
      </form>
    </Card>
  );
}
