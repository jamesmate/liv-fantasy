import { useEffect, useState } from "react";
import { Box, Text, Stack, TextInput, Button, Alert, Switch, Card, Group, UnstyledButton } from "@mantine/core";
import { IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { api } from "../api/client";

const DEFAULT_COLOR = "#2d5a3d";

const SWATCHES = [
  "#2d5a3d",
  "#c0392b",
  "#2980b9",
  "#8e44ad",
  "#f39c12",
  "#16a085",
  "#d35400",
  "#2c3e50",
  "#e91e8c",
  "#27ae60",
];

/**
 * Self-service team settings - name, an accent color (shown on picked
 * players' sprites), and the auto-assign-on-no-pick toggle: on means
 * a round locking with zero picks made gets 4 random eligible players
 * assigned automatically instead of defaulting to the field-average+5
 * no-pick penalty.
 */
export default function TeamTabPage() {
  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState(DEFAULT_COLOR);
  const [autoAssign, setAutoAssign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyTeam()
      .then((team) => {
        if (team) {
          setTeamName(team.team_name);
          setTeamColor(team.team_color ?? DEFAULT_COLOR);
          setAutoAssign(team.auto_assign_on_no_pick);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!teamName.trim()) {
      setError("Team name can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateMyTeam({ teamName: teamName.trim(), teamColor, autoAssignOnNoPick: autoAssign });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Box p="md">
      <Text size="lg" fw={800} c="forest.9" mb="md">
        Team Settings
      </Text>
      <Stack gap="md" maw={400}>
        <TextInput
          label="Team Name"
          value={teamName}
          onChange={(e) => setTeamName(e.currentTarget.value)}
          placeholder="Your team name"
        />
        <Box>
          <Text size="sm" fw={500} mb={4}>
            Team Colour
          </Text>
          <Text size="xs" c="dimmed" mb={8}>
            Shows on your picked players once you've made your picks
          </Text>
          <Group gap={8} mb={10}>
            {SWATCHES.map((sw) => (
              <UnstyledButton
                key={sw}
                onClick={() => setTeamColor(sw)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: sw,
                  border:
                    teamColor.toLowerCase() === sw.toLowerCase()
                      ? "3px solid var(--mantine-color-forest-9)"
                      : "1px solid var(--mantine-color-forest-3)",
                }}
              />
            ))}
          </Group>
          {/* Native browser color picker rather than Mantine's
              ColorInput - Mantine's custom drag-based hue/saturation
              sliders have known touch-event issues on iOS Safari.
              A native <input type="color"> hands off entirely to the
              OS's own picker, so there's no custom touch handling to
              break. */}
          <Group gap={10} align="center">
            <input
              type="color"
              value={teamColor}
              onChange={(e) => setTeamColor(e.target.value)}
              style={{
                width: 44,
                height: 36,
                border: "1px solid var(--mantine-color-forest-3)",
                borderRadius: 6,
                padding: 2,
                background: "none",
                cursor: "pointer",
              }}
            />
            <Text size="sm" c="dimmed" ff="monospace">
              {teamColor}
            </Text>
          </Group>
        </Box>
        <Card bg="forest.7" p="md">
          <Switch
            label="Auto-assign if I forget to pick"
            description={
              autoAssign
                ? "On - any empty pick slots at lock time get filled with random eligible players automatically."
                : "Off - a completely empty round scores the field average + 5 shots; a partial pick just scores whichever players you did pick, with no penalty."
            }
            checked={autoAssign}
            onChange={(e) => setAutoAssign(e.currentTarget.checked)}
            color="tangerine"
          />
        </Card>
        {error && (
          <Alert color="coral" icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}
        {saved && (
          <Alert color="mint" icon={<IconCheck size={16} />}>
            Saved.
          </Alert>
        )}
        <Button color="tangerine" loading={saving} onClick={handleSave}>
          Save
        </Button>
      </Stack>
    </Box>
  );
}
