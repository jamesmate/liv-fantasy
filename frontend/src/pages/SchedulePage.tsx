import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Text, Stack, Group, Card, Center } from "@mantine/core";
import { IconCalendarEvent } from "@tabler/icons-react";
import { api, ScheduleEvent } from "../api/client";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { TourBadge } from "../components/TourBadge";

// Postgres `date` columns come back through the pg driver as JS Date
// objects, which Express's res.json() then serializes to a FULL ISO
// datetime string (e.g. "2026-07-21T00:00:00.000Z"), not the plain
// "2026-07-21" you might expect from a `date` column. Taking just the
// first 10 characters normalizes either shape before parsing, so this
// doesn't break if that serialization behavior ever changes.
function parseDateOnly(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + "T00:00:00");
}

function formatDateRange(startDate: string, endDate: string | null): string {
  const start = parseDateOnly(startDate);
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!endDate || endDate.slice(0, 10) === startDate.slice(0, 10)) return startStr;
  const end = parseDateOnly(endDate);
  const sameMonth = start.getMonth() === end.getMonth();
  const endStr = end.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${startStr}-${endStr}`;
}

export default function SchedulePage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [events, setEvents] = useState<ScheduleEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    api
      .getSchedule(leagueId)
      .then((res) => {
        const today = new Date().toISOString().slice(0, 10);
        setEvents(res.filter((e) => (e.end_date ?? e.start_date).slice(0, 10) >= today));
      })
      .catch((err) => setError(err.message));
  }, [leagueId]);

  if (error) {
    return (
      <Text c="coral.6" ta="center" p="md">
        {error}
      </Text>
    );
  }

  if (events === null) {
    return (
      <Center style={{ height: "calc(100dvh - var(--app-shell-header-height, 60px) - var(--app-shell-footer-height, 64px))" }}>
        <LoadingIndicator />
      </Center>
    );
  }

  if (events.length === 0) {
    return (
      <Text c="forest.2" ta="center" p="md">
        No upcoming events on the schedule yet.
      </Text>
    );
  }

  const [next, ...rest] = events;

  return (
    <Box p="md">
      <Stack gap="md">
        {/* Next event - larger, featured */}
        <Card bg="forest.8" p="lg" style={{ border: "2px solid var(--mantine-color-tangerine-5)" }}>
          <Stack gap={8} align="center">
            <Text size="10px" fw={700} c="mint.3" tt="uppercase">
              Next Up
            </Text>
            <TourBadge tour={next.tour} size={44} />
            <Text size="lg" fw={800} c="white" ta="center">
              {next.name}
            </Text>
            <Group gap={6}>
              <IconCalendarEvent size={16} color="var(--mantine-color-forest-5)" />
              <Text size="sm" c="forest.5">
                {formatDateRange(next.start_date, next.end_date)}
              </Text>
            </Group>
          </Stack>
        </Card>

        {/* Rest of the schedule */}
        {rest.length > 0 && (
          <Stack gap={0}>
            {rest.map((e) => (
              <Group
                key={e.id}
                justify="space-between"
                wrap="nowrap"
                py="sm"
                px="xs"
                style={{ borderBottom: "1px solid var(--mantine-color-forest-2)" }}
              >
                <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
                  <TourBadge tour={e.tour} size={26} />
                  <Text size="sm" fw={600} c="forest.9" lineClamp={1}>
                    {e.name}
                  </Text>
                </Group>
                <Text size="xs" c="forest.3" style={{ flexShrink: 0 }}>
                  {formatDateRange(e.start_date, e.end_date)}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
