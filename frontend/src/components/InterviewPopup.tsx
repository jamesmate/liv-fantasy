import { useEffect, useState } from "react";
import { Modal, Text, Stack, Textarea, Button, ActionIcon, Box } from "@mantine/core";
import { IconArrowRight, IconMicrophone } from "@tabler/icons-react";
import { api, getStoredLeagueId, PendingInterview } from "../api/client";

/**
 * Global "Jamdog Interview" popup - checks once on mount whether the
 * current member has a pending (unanswered) question waiting, and if
 * so walks them through a two-stage flow: a teaser ("Jamdog wants to
 * ask you a question...") they tap through, then the actual question
 * with a text box to answer. This is the whole "notification" for
 * this feature - there's no real push notification infrastructure in
 * this app, so this only fires when they next open/reload the app,
 * not the instant the question is sent.
 *
 * Mounted once at the top of App.tsx so it can appear regardless of
 * which page someone lands on.
 */
export function InterviewPopup() {
  const [pending, setPending] = useState<PendingInterview | null>(null);
  const [stage, setStage] = useState<"teaser" | "question">("teaser");
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const leagueId = getStoredLeagueId();
    if (!leagueId) return;
    api
      .getMyPendingInterview(leagueId)
      .then(setPending)
      .catch(() => {});
  }, []);

  async function handleSubmit() {
    if (!pending || !answer.trim()) return;
    setSubmitting(true);
    try {
      await api.answerInterview(pending.id, answer.trim());
      setPending(null);
    } catch {
      // Leave the modal open with whatever they typed so they can retry.
    } finally {
      setSubmitting(false);
    }
  }

  if (!pending) return null;

  return (
    <Modal
      opened
      onClose={() => {}}
      withCloseButton={false}
      centered
      overlayProps={{ blur: 6, backgroundOpacity: 0.5 }}
    >
      {stage === "teaser" ? (
        <Stack gap="md" align="center" py="md">
          <IconMicrophone size={40} color="var(--mantine-color-tangerine-6)" />
          <Text size="lg" fw={800} ta="center" c="forest.9">
            Jamdog wants to ask {pending.team_name} a question...
          </Text>
          <Box style={{ alignSelf: "flex-end" }}>
            <ActionIcon size="xl" radius="xl" color="tangerine" onClick={() => setStage("question")}>
              <IconArrowRight size={22} />
            </ActionIcon>
          </Box>
        </Stack>
      ) : (
        <Stack gap="md">
          <Text size="10px" fw={700} c="tangerine.7" tt="uppercase">
            Jamdog Interview
          </Text>
          <Text size="md" fw={700} c="forest.9">
            {pending.question_text}
          </Text>
          <Textarea
            placeholder="Type your answer..."
            minRows={4}
            autosize
            value={answer}
            onChange={(e) => setAnswer(e.currentTarget.value)}
          />
          <Button color="tangerine" disabled={!answer.trim()} loading={submitting} onClick={handleSubmit}>
            Submit Answer
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
