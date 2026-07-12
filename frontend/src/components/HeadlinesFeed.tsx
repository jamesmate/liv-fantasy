import { useEffect, useState } from "react";
import { Card, Text, Stack, Group } from "@mantine/core";
import { api, Headline } from "../api/client";

interface HeadlinesFeedProps {
  leagueId: string;
}

/**
 * Auto-generated news feed about what's happening in the current live
 * round - double plays paying off/backfiring, who's leading, missed
 * cuts. Fetched fresh on mount; not live-polling, since it's meant to
 * be a "check in and see what's happening" feed rather than a ticker.
 */
export function HeadlinesFeed({ leagueId }: HeadlinesFeedProps) {
  const [headlines, setHeadlines] = useState<Headline[] | null>(null);

  useEffect(() => {
    api
      .getHeadlines(leagueId)
      .then((res) => setHeadlines(res.headlines))
      .catch(() => setHeadlines([]));
  }, [leagueId]);

  if (headlines === null || headlines.length === 0) return null;

  return (
    <Card bg="forest.7" p="md" mt="md">
      <Text size="xs" fw={700} c="mint.3" tt="uppercase" mb="sm">
        Live from the tournament
      </Text>
      <Stack gap="xs">
        {headlines.map((h) => (
          <Group key={h.id} gap={8} wrap="nowrap" align="flex-start">
            <Text size="sm" style={{ lineHeight: 1 }}>
              {h.emoji}
            </Text>
            <Text size="sm" c="forest.1" style={{ lineHeight: 1.4 }}>
              {h.text}
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
