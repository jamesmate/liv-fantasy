import { Modal, Text, Stack, List, Button, Box } from "@mantine/core";
import { IconBolt } from "@tabler/icons-react";

interface RulesModalProps {
  opened: boolean;
  onClose: () => void;
}

/**
 * The "How This Works" rules content, as a plain controlled modal -
 * used both for the automatic first-visit-per-tournament popup
 * (see the tournamentId-watching effect in PickTabPage) and the
 * persistent "?" button that lets someone reopen it on demand
 * anytime.
 */
export function RulesModal({ opened, onClose }: RulesModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="How This Works"
      centered
      overlayProps={{ blur: 6, backgroundOpacity: 0.4 }}
    >
      <Stack gap="md">
        <List spacing="sm" size="sm">
          <List.Item>
            Pick 4 players each round, but you can only use a player once for the whole tournament!
          </List.Item>
          <List.Item>Your players' scores to par are accumulated to be your score for the round!</List.Item>
          <List.Item>At the end of the tournament your total score is ranked against the rest!</List.Item>
          <List.Item>
            Every round there's a bonus objective — pick any player to fulfil it for extra league points.
            These points might tip the balance at the end of the season.
          </List.Item>
          <List.Item>
            <Box>
              Once per tournament you can use a{" "}
              <Text span fw={700} c="tangerine.7">
                Double Token
              </Text>{" "}
              — this doubles a player's score, good or bad (e.g. +2 becomes +4, -2 becomes -4).
              Tap the <IconBolt size={13} style={{ verticalAlign: "middle" }} /> lightning bolt next to
              their name when picking them. Be careful — this can backfire if they shoot over par!
            </Box>
          </List.Item>
          <List.Item>
            Pick players for all rounds in case you forget. In Team Settings you can turn on Auto Pick to
            prevent you from defaulting.
          </List.Item>
        </List>
        <Button color="tangerine" onClick={onClose}>
          Let's Go
        </Button>
      </Stack>
    </Modal>
  );
}
