import { useEffect, useState } from "react";
import { Card, Text, Stack, Group, Select, Textarea, Button, Alert } from "@mantine/core";
import { IconMicrophone, IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { api } from "../api/client";

/**
 * Owner-only composer for sending a new "Jamdog Interview" question
 * to a team. They'll see a popup next time they open the app (see
 * InterviewPopup.tsx), and once answered it publishes automatically
 * to the Leaderboard's Q&A section - no further admin action needed.
 */
export function InterviewComposer() {
  const [members, setMembers] = useState<{ id: string; team_name: string }[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.getMembers().then(setMembers).catch(() => {});
  }, []);

  async function handleSend() {
    if (!memberId || !question.trim()) {
      setError("Pick a team and write a question first.");
      return;
    }
    setSending(true);
    setError(null);
    setSent(false);
    try {
      await api.sendInterviewQuestion(memberId, question.trim());
      setQuestion("");
      setMemberId(null);
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card bg="forest.7" p="lg">
      <Stack gap="sm">
        <Group gap={6}>
          <IconMicrophone size={18} color="var(--mantine-color-tangerine-6)" />
          <Text fw={600} c="forest.9">
            Jamdog Interview
          </Text>
        </Group>
        <Select
          placeholder="Pick a team to interview"
          data={members.map((m) => ({ value: m.id, label: m.team_name }))}
          value={memberId}
          onChange={setMemberId}
          searchable
        />
        <Textarea
          placeholder="Write your question, e.g. 'Talk us through that eagle on 14...'"
          minRows={3}
          autosize
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
        />
        {error && (
          <Alert color="coral" icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}
        {sent && (
          <Alert color="mint" icon={<IconCheck size={16} />}>
            Sent - they'll see it next time they open the app.
          </Alert>
        )}
        <Button color="tangerine" loading={sending} onClick={handleSend}>
          Send Question
        </Button>
      </Stack>
    </Card>
  );
}
