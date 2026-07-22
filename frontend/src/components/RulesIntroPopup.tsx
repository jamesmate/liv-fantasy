import { useEffect, useState } from "react";
import { Modal, Text, Stack, List, Button, Box } from "@mantine/core";
import { IconBolt } from "@tabler/icons-react";

interface RulesIntroPopupProps {
  tournamentId: string | null;
}

function storageKey(tournamentId: string) {
  return `liv_fantasy_rules_seen_${tournamentId}`;
}

/**
 * One-time rules reminder shown the first time a member opens the
 * Pick tab for a given tournament - tracked per-tournament (not just
 * once ever) via localStorage, so a new tournament starting is a
 * natural moment to re-surface the rules, especially for anything
 * that's changed since the last one (points values, new bonus
 * categories, etc). No backend/DB needed since this is purely
 * per-device "have I seen this" state with no cross-device sync
 * requirement - same reasoning as team_name/league_name already being
 * cached in localStorage elsewhere in this app.
 */
export function RulesIntroPopup({ tournamentId }: RulesIntroPopupProps) {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!tournamentId) return;
    const seen = localStorage.getItem(storageKey(tournamentId));
    if (!seen) setOpened(true);
  }, [tournamentId]);

  function handleClose() {
    if (tournamentId) {
      localStorage.setItem(storageKey(tournamentId), "true");
    }
    setOpened(false);
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
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
              — this doubles the score for a player (tap the{" "}
              <IconBolt size={13} style={{ verticalAlign: "middle" }} /> lightning bolt next to their
              name when picking them). Be careful — this can backfire if they shoot over par!
            </Box>
          </List.Item>
          <List.Item>
            Pick players for all rounds in case you forget. In Team Settings you can turn on Auto Pick to
            prevent you from defaulting.
          </List.Item>
        </List>
        <Button color="tangerine" onClick={handleClose}>
          Let's Go
        </Button>
      </Stack>
    </Modal>
  );
}
