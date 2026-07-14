import { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { Group, Text, ActionIcon, Tooltip } from "@mantine/core";
import { IconArrowLeft, IconSettings } from "@tabler/icons-react";
import { getStoredLeagueId, getStoredLeagueName, isStoredOwner, api } from "../api/client";
import { PasscodeButton } from "./PasscodeButton";

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueId: routeLeagueId } = useParams<{ leagueId: string }>();
  const leagueId = routeLeagueId || getStoredLeagueId();
  const [leagueName, setLeagueName] = useState<string | null>(getStoredLeagueName());
  const isOwner = isStoredOwner();

  useEffect(() => {
    const cached = getStoredLeagueName();
    if (cached) {
      setLeagueName(cached);
      return;
    }
    // Session predates when the league name started being cached at
    // login time - fetch it once and cache it so this only happens
    // the one time, not on every load.
    if (!leagueId) return;
    api
      .getLeagueName(leagueId)
      .then((res) => {
        localStorage.setItem("liv_fantasy_league_name", res.name);
        setLeagueName(res.name);
      })
      .catch(() => {});
  }, [leagueId]);

  function goHome() {
    navigate(leagueId ? `/league/${leagueId}/pick` : "/join");
  }

  // Hide the back button on the three main tab screens themselves and
  // on join/create - the back arrow is for drilling OUT of a detail
  // screen (e.g. admin, career leaderboard), not for navigating between
  // tabs (that's what the bottom tab bar is for).
  const isMainTabScreen =
    !!leagueId &&
    (location.pathname === `/league/${leagueId}/pick` ||
      location.pathname === `/league/${leagueId}/leaderboard` ||
      location.pathname === `/league/${leagueId}/overall-standings`);
  const isEntryScreen = location.pathname === "/join" || location.pathname === "/create";
  const showBack = !isMainTabScreen && !isEntryScreen;
  const showSettings = isMainTabScreen && isOwner;

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
        <img
          src="/jamdog-logo.png"
          alt="Jamdog"
          onClick={(e) => {
            e.stopPropagation();
            window.open("https://jamdog.io", "_blank", "noopener,noreferrer");
          }}
          style={{
            height: 40,
            width: "auto",
            flexShrink: 0,
            objectFit: "contain",
            cursor: "pointer",
          }}
        />
        <Text
          onClick={goHome}
          fw={800}
          size="lg"
          truncate
          style={{
            fontFamily: "'Poppins', sans-serif",
            letterSpacing: -0.5,
            color: "var(--mantine-color-mint-3)",
            cursor: "pointer",
          }}
        >
          {leagueName || "LIV Fantasy"}
        </Text>
      </Group>

      {showBack && (
        <ActionIcon
          variant="light"
          color="mint"
          size="lg"
          radius="xl"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <IconArrowLeft size={18} />
        </ActionIcon>
      )}

      {isMainTabScreen && <PasscodeButton />}

      {showSettings && (
        <Tooltip label="League admin" withArrow>
          <ActionIcon
            variant="light"
            color="mint"
            size="lg"
            radius="xl"
            onClick={() => navigate(`/league/${leagueId}/admin`)}
            aria-label="League admin"
          >
            <IconSettings size={18} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
