import { useState } from "react";
import { ActionIcon, Tooltip, Modal, Stack, PasswordInput, Button, Alert, Text } from "@mantine/core";
import { IconKey, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { api } from "../api/client";

/**
 * Lets the currently logged-in member set/change the passcode for
 * their own team, so they can log back into it from another device
 * later via /login (joinCode + teamName + passcode).
 */
export function PasscodeButton() {
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setSuccess(false);
    if (passcode.length < 4) {
      setError("Passcode must be at least 4 characters.");
      return;
    }
    setLoading(true);
    try {
      await api.setPasscode(passcode);
      setSuccess(true);
      setPasscode("");
    } catch (err: any) {
      setError(err.message || "Couldn't save passcode.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Tooltip label="Set team passcode" withArrow>
        <ActionIcon
          variant="light"
          color="mint"
          size="lg"
          radius="xl"
          onClick={() => setOpen(true)}
          aria-label="Set team passcode"
        >
          <IconKey size={18} />
        </ActionIcon>
      </Tooltip>

      <Modal opened={open} onClose={() => setOpen(false)} title="Team Passcode" centered>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Set a passcode for your team so you can log back in from any device (phone, laptop, etc.) using your
            league code, team name, and this passcode.
          </Text>
          <PasswordInput
            label="New passcode"
            placeholder="At least 4 characters"
            value={passcode}
            onChange={(e) => setPasscode(e.currentTarget.value)}
          />
          {error && (
            <Alert color="coral" icon={<IconAlertTriangle size={18} />}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert color="mint" icon={<IconCheck size={18} />}>
              Passcode saved. You can now log in with it from any device.
            </Alert>
          )}
          <Button color="mint" loading={loading} onClick={handleSave} fullWidth>
            Save Passcode
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
