import { useEffect, useState, useMemo } from "react";
import { Box, Card, Text, Group, Stack, Modal, TextInput, ScrollArea, UnstyledButton, Badge } from "@mantine/core";
import { IconSearch, IconBan } from "@tabler/icons-react";
import { api, BonusEligiblePlayer, MyBonusPick, BONUS_CATEGORY_INFO } from "../api/client";
import { getCountryFlagUrl } from "../utils/countryFlags";

interface BonusPickCardProps {
  roundId: string | null;
  isLocked: boolean;
}

/**
 * The 5th "bonus pick" - deliberately visually separated from the 4
 * normal picks above it (different card, own border/background), and
 * functionally different in two ways: no no-repeat restriction (any
 * player is always eligible, see bonus-eligible-players), and it's
 * scored against a category randomized once per round for the whole
 * league (see BONUS_CATEGORY_INFO / bonusPickSync.ts) rather than raw
 * golf score.
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
      // Silent - the picker just stays open, matching how the main
      // pick list handles a failed selection.
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
      <Card
        bg="forest.8"
        p="md"
        mt="lg"
        style={{ border: "2px dashed var(--mantine-color-tangerine-5)" }}
      >
        <Text size="10px" fw={700} c="mint.3" tt="uppercase" mb={4}>
          Bonus Pick - Any Player Eligible
        </Text>
        <Group gap={8} mb={8} wrap="nowrap">
          <Text size="lg">{categoryInfo?.emoji ?? "⭐"}</Text>
          <Box style={{ flex: 1 }}>
            <Text size="sm" fw={800} c="white">
              {categoryInfo?.label ?? data.category}
            </Text>
            <Text size="10px" c="forest.5">
              {categoryInfo?.description}
            </Text>
          </Box>
        </Group>

        <UnstyledButton
          onClick={openPicker}
          disabled={isLocked}
          style={{ width: "100%", opacity: isLocked ? 0.7 : 1 }}
        >
          <Card bg="forest.7" p="sm">
            {data.pick ? (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={600} c="forest.9">
                  {data.pick.full_name}
                </Text>
                <Badge size="lg" color="tangerine" variant="filled">
                  +{data.pick.points}
                </Badge>
              </Group>
            ) : (
              <Text size="sm" c="forest.3" ta="center">
                {isLocked ? "No bonus pick made" : "Tap to pick a bonus player"}
              </Text>
            )}
          </Card>
        </UnstyledButton>
      </Card>

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
