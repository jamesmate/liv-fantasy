import { useEffect, useState } from "react";
import { Card, Text, Stack, Group, Button, TextInput, Select, Box, ActionIcon, Alert } from "@mantine/core";
import { IconCalendarEvent, IconTrash, IconAlertTriangle } from "@tabler/icons-react";
import { api, ScheduleEvent } from "../api/client";
import { TourBadge, TOURS } from "./TourBadge";

interface ScheduleAdminProps {
  leagueId: string;
}

const TOUR_OPTIONS = Object.entries(TOURS)
  .filter(([key]) => key !== "OTHER")
  .map(([value, info]) => ({ value, label: info.label }))
  .concat([{ value: "OTHER", label: "Other" }]);

/**
 * Owner-only schedule management - add/remove entries on the league's
 * schedule preview (see schema.sql on schedule_events for why this is
 * separate from actually seeding a tournament for picking).
 */
export function ScheduleAdmin({ leagueId }: ScheduleAdminProps) {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [name, setName] = useState("");
  const [tour, setTour] = useState<string | null>("LIV");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [espnEventId, setEspnEventId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    api.getSchedule(leagueId).then(setEvents).catch(() => {});
  }

  useEffect(refresh, [leagueId]);

  async function handleAdd() {
    if (!name.trim() || !tour || !startDate) {
      setError("Name, tour, and start date are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.addScheduleEvent({
        name: name.trim(),
        tour,
        startDate,
        endDate: endDate || undefined,
        espnEventId: espnEventId || undefined,
      });
      setName("");
      setStartDate("");
      setEndDate("");
      setEspnEventId("");
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteScheduleEvent(id);
      refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Card bg="forest.7" p="lg">
      <Stack gap="sm">
        <Group gap={6}>
          <IconCalendarEvent size={18} color="var(--mantine-color-mint-6)" />
          <Text fw={600} c="forest.9">
            Schedule
          </Text>
        </Group>

        {events.length > 0 && (
          <Stack gap={4}>
            {events.map((e) => (
              <Group key={e.id} justify="space-between" wrap="nowrap">
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <TourBadge tour={e.tour} size={20} />
                  <Text size="sm" c="forest.9" lineClamp={1}>
                    {e.name}
                  </Text>
                  <Text size="xs" c="forest.3" style={{ flexShrink: 0 }}>
                    {e.start_date}
                  </Text>
                </Group>
                <ActionIcon variant="subtle" color="coral" size="sm" onClick={() => handleDelete(e.id)}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        )}

        <Box mt={4}>
          <Text size="xs" fw={700} c="forest.6" mb={4}>
            Add event
          </Text>
          <Stack gap={6}>
            <TextInput
              placeholder="Event name"
              size="sm"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Group gap={6} grow>
              <Select
                size="sm"
                data={TOUR_OPTIONS}
                value={tour}
                onChange={setTour}
                placeholder="Tour"
              />
              <TextInput
                type="date"
                size="sm"
                value={startDate}
                onChange={(e) => setStartDate(e.currentTarget.value)}
              />
              <TextInput
                type="date"
                size="sm"
                placeholder="End (optional)"
                value={endDate}
                onChange={(e) => setEndDate(e.currentTarget.value)}
              />
            </Group>
            <TextInput
              placeholder="ESPN event ID (optional, fill in later if unknown)"
              size="sm"
              value={espnEventId}
              onChange={(e) => setEspnEventId(e.currentTarget.value)}
            />
            {error && (
              <Alert color="coral" icon={<IconAlertTriangle size={16} />}>
                {error}
              </Alert>
            )}
            <Button size="sm" color="mint" loading={saving} onClick={handleAdd}>
              Add to schedule
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Card>
  );
}
