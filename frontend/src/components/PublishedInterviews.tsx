import { useEffect, useState } from "react";
import { Card, Text, Stack, Group, UnstyledButton, Box } from "@mantine/core";
import { IconMicrophone } from "@tabler/icons-react";
import { api, PublishedInterview, REACTION_EMOJIS } from "../api/client";

interface PublishedInterviewsProps {
  leagueId: string;
}

/**
 * Published "Jamdog Interview" Q&As for the current tournament -
 * sits alongside the headlines feed on the Leaderboard. Anyone can
 * react to any interview with one of a fixed set of emojis; tapping
 * an emoji you've already used removes your reaction (toggle).
 */
export function PublishedInterviews({ leagueId }: PublishedInterviewsProps) {
  const [interviews, setInterviews] = useState<PublishedInterview[]>([]);

  function refresh() {
    api.getPublishedInterviews(leagueId).then(setInterviews).catch(() => {});
  }

  useEffect(refresh, [leagueId]);

  async function handleReact(interviewId: string, emoji: string) {
    // Optimistic update so tapping feels instant, then reconcile with
    // the server's actual counts.
    setInterviews((prev) =>
      prev.map((iv) => {
        if (iv.id !== interviewId) return iv;
        const alreadyReacted = iv.myReactions.includes(emoji);
        const newCount = (iv.reactionCounts[emoji] ?? 0) + (alreadyReacted ? -1 : 1);
        return {
          ...iv,
          reactionCounts: { ...iv.reactionCounts, [emoji]: Math.max(0, newCount) },
          myReactions: alreadyReacted ? iv.myReactions.filter((e) => e !== emoji) : [...iv.myReactions, emoji],
        };
      })
    );
    try {
      await api.reactToInterview(interviewId, emoji);
    } catch {
      refresh(); // roll back to real state on failure
    }
  }

  if (interviews.length === 0) return null;

  return (
    <Stack gap="sm" mt="md">
      {interviews.map((iv) => (
        <Card key={iv.id} bg="forest.7" p="md">
          <Group gap={6} mb={6}>
            <IconMicrophone size={16} color="var(--mantine-color-tangerine-6)" />
            <Text size="10px" fw={700} c="tangerine.7" tt="uppercase">
              Jamdog Interview - {iv.teamName}
            </Text>
          </Group>
          <Text size="sm" fw={700} c="forest.9" mb={4}>
            {iv.questionText}
          </Text>
          <Text size="sm" c="forest.2" mb={10}>
            {iv.answerText}
          </Text>
          <Group gap={6}>
            {REACTION_EMOJIS.map((emoji) => {
              const count = iv.reactionCounts[emoji] ?? 0;
              const mine = iv.myReactions.includes(emoji);
              return (
                <UnstyledButton key={emoji} onClick={() => handleReact(iv.id, emoji)}>
                  <Box
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      padding: "3px 8px",
                      borderRadius: 12,
                      border: mine ? "1.5px solid var(--mantine-color-tangerine-6)" : "1.5px solid transparent",
                      background: mine ? "rgba(245, 166, 35, 0.15)" : "var(--mantine-color-forest-0)",
                    }}
                  >
                    <Text size="sm">{emoji}</Text>
                    {count > 0 && (
                      <Text size="10px" fw={700} c={mine ? "tangerine.7" : "forest.4"}>
                        {count}
                      </Text>
                    )}
                  </Box>
                </UnstyledButton>
              );
            })}
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
