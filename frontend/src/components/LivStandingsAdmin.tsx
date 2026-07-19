import { useEffect, useState } from "react";
import { Card, Text, Stack, Group, Checkbox } from "@mantine/core";
import { IconTrophy } from "@tabler/icons-react";
import { api, LivStandingsMember } from "../api/client";

/**
 * Owner-only checklist for managing who's in the LIV Standings - a
 * separate standings scoped to tour='LIV' tournaments, only including
 * whichever teams are checked here. Regular season standings are
 * unaffected and always include every team/tournament regardless.
 */
export function LivStandingsAdmin() {
  const [members, setMembers] = useState<LivStandingsMember[]>([]);

  function refresh() {
    api.getLivStandingsMembers().then(setMembers).catch(() => {});
  }

  useEffect(refresh, []);

  async function toggle(member: LivStandingsMember) {
    // Optimistic update for a snappy feel, reconcile with the server after.
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, is_liv_member: !m.is_liv_member } : m)));
    try {
      if (member.is_liv_member) {
        await api.removeLivStandingsMember(member.id);
      } else {
        await api.addLivStandingsMember(member.id);
      }
    } catch {
      refresh(); // roll back to real state on failure
    }
  }

  return (
    <Card bg="forest.7" p="lg">
      <Stack gap="sm">
        <Group gap={6}>
          <IconTrophy size={18} color="var(--mantine-color-tangerine-6)" />
          <Text fw={600} c="forest.9">
            LIV Standings Roster
          </Text>
        </Group>
        <Text size="xs" c="forest.3">
          Only checked teams appear in the LIV Standings, and only their results from tournaments tagged as LIV
          events count toward it. Regular season standings are unaffected either way.
        </Text>
        <Stack gap={6}>
          {members.map((m) => (
            <Checkbox
              key={m.id}
              label={m.team_name}
              checked={m.is_liv_member}
              onChange={() => toggle(m)}
              color="tangerine"
            />
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
