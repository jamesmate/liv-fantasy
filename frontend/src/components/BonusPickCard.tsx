import { useEffect, useState, useMemo } from "react";
import { Box, Card, Text, Group, Stack, Modal, TextInput, ScrollArea, UnstyledButton, Badge, Button } from "@mantine/core";
import { IconSearch, IconBan } from "@tabler/icons-react";
import { api, BonusEligiblePlayer, MyBonusPick, BONUS_CATEGORY_INFO } from "../api/client";
import { getCountryFlagUrl } from "../utils/countryFlags";
import { AnimatedGolferSprite } from "./sprites/AnimatedGolferSprite";

interface BonusPickCardProps {
  roundId: string | null;
  isLocked: boolean;
}

/**
 * The 5th "bonus pick" - sits right below the main lineup zone, always
 * visible without scrolling (previously buried at the bottom of the
 * scrollable player list, which made it easy to miss entirely).
 * Visually distinct from the 4 normal picks via the dotted tangerine
 * border, but otherwise a compact single-row card matching the list's
 * style. No no-repeat restriction here - any player is always
 * eligible, scored against a category randomized once per round for
 * the whole league (see BONUS_CATEGORY_INFO / bonusPickSync.ts).
 */
export function BonusPickCard({ roundId, isLocked }: BonusPickCardProps) {
  const [data, setData] = useState<MyBonusPick | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [players, setPlayers] = useState<BonusEligiblePlayer[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!roundId) return;
    api.getMyBonusPick(roundId).then(setData).catch(() => {});
  }, [roundId]);

  // Explicit "Pick" button press is what reveals the player list - the
  // card itself is never directly tappable, so there's no accidental
  // opening while just glancing at the current bonus pick/score.
  function openPicker() {
    if (!roundId || isLocked) return;
    api.getBonusEligiblePlayers(roundId).then(setPlayers).catch(() => {});
    setPickerOpen(true);
  }

  async function handlePick(playerId: string) {
    if (!roundId) return;
    setSaving(true);
    try {
      await api.submitBonusPick(roundId, playerId);
      const refreshed = await api.getMyBonusPick(roundId);
      setData(refreshed);
      setPickerOpen(false);
      setSearch("");
    } catch {
      // Silent - picker just stays open, matching how the main pick
      // list handles a failed selection.
    } finally {
      setSaving(false);
    }
  }

  const filteredPlayers = useMemo(
    () => players.filter((p) => p.full_name.toLowerCase().includes(search.toLowerCase())),
    [players, search]
  );

  if (!roundId || !data?.category) return null;

  const categoryInfo = BONUS_CATEGORY_INFO[data.category];

  return (
    <>
      <Box px="md" pt={6} pb={2} style={{ flexShrink: 0 }}>
        <Card
          p={0}
          style={{ border: "2px dotted var(--mantine-color-tangerine-5)", overflow: "hidden" }}
        >
          <Box px={8} pt={6} pb={2}>
            <Text size="9px" fw={700} c="tangerine.7" tt="uppercase">
              <Text span size="13px" fw={800}>
                Bonus
              </Text>
              : Earn Extra League Points!
            </Text>
          </Box>
          <Box p={8} pt={2}>
            <Group justify="space-between" wrap="nowrap" gap={8} mb={data.pick ? 4 : 0}>
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                {data.pick && (
                  <Box style={{ flexShrink: 0 }}>
                    <AnimatedGolferSprite playerName={data.pick.full_name} size={32} runOn={false} />
                  </Box>
                )}
                <Text size="md">{categoryInfo?.emoji ?? "⭐"}</Text>
                <Box style={{ minWidth: 0 }}>
                  <Text size="xs" fw={700} c="forest.9" lineClamp={1}>
                    {categoryInfo?.label ?? data.category}
                  </Text>
                  <Text size="10px" c="forest.3" lineClamp={1}>
                    {data.pick ? data.pick.full_name : "No pick yet"}
                  </Text>
                </Box>
              </Group>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                {data.pick && (
                  <Badge size="lg" color="tangerine" variant="filled">
                    {data.pick.points}pts
                  </Badge>
                )}
                <Button
                  size="compact-xs"
                  variant={data.pick ? "light" : "filled"}
                  color="tangerine"
                  disabled={isLocked}
                  onClick={openPicker}
                >
                  Pick
                </Button>
              </Group>
            </Group>
            <Text size="10px" c="forest.3" lineClamp={2}>
              {categoryInfo?.description}
            </Text>
          </Box>
        </Card>
      </Box>

      <Modal
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choose Your Bonus Pick"
        centered
        overlayProps={{ blur: 6, backgroundOpacity: 0.4 }}
      >
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            Any player is eligible here, even ones you've already used in a normal round pick.
          </Text>
          <TextInput
            placeholder="Search players..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <ScrollArea h={360}>
            <Stack gap={4}>
              {filteredPlayers.map((p) => {
                const flagUrl = getCountryFlagUrl(p.country_code);
                const disabled = !p.is_active || saving;
                return (
                  <UnstyledButton
                    key={p.id}
                    disabled={disabled}
                    onClick={() => handlePick(p.id)}
                    style={{ opacity: disabled ? 0.5 : 1 }}
                  >
                    <Group gap={8} wrap="nowrap" py={6} px={8}>
                      {flagUrl && <img src={flagUrl} alt="" width={16} height={12} style={{ borderRadius: 2 }} />}
                      <Text size="sm" style={{ flex: 1 }}>
                        {p.full_name}
                      </Text>
                      {!p.is_active && (
                        <Badge size="xs" color="coral" leftSection={<IconBan size={10} />}>
                          {p.inactive_reason === "missed_cut" ? "Missed Cut" : "Withdrawn"}
                        </Badge>
                      )}
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </ScrollArea>
        </Stack>
      </Modal>
    </>
  );
}
