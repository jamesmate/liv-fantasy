import { useNavigate, useLocation, useParams } from "react-router-dom";
import { UnstyledButton, Group, Text, Stack } from "@mantine/core";
import { IconTarget, IconTable, IconTrophy, IconCalendarEvent } from "@tabler/icons-react";

interface TabDef {
  key: string;
  label: string;
  icon: typeof IconTarget;
  path: (leagueId: string) => string;
  match: (pathname: string, leagueId: string) => boolean;
}

const TABS: TabDef[] = [
  {
    key: "schedule",
    label: "Schedule",
    icon: IconCalendarEvent,
    path: (leagueId) => `/league/${leagueId}/schedule`,
    match: (pathname) => pathname.includes("/schedule"),
  },
  {
    key: "pick",
    label: "Pick",
    icon: IconTarget,
    path: (leagueId) => `/league/${leagueId}/pick`,
    match: (pathname) => pathname.includes("/pick") || pathname.startsWith("/round/"),
  },
  {
    key: "leaderboard",
    label: "Leaderboard",
    icon: IconTable,
    path: (leagueId) => `/league/${leagueId}/leaderboard`,
    match: (pathname) => pathname.includes("/leaderboard"),
  },
  {
    key: "standings",
    label: "Standings",
    icon: IconTrophy,
    path: (leagueId) => `/league/${leagueId}/overall-standings`,
    match: (pathname) => pathname.includes("/overall-standings"),
  },
];

/**
 * Fixed bottom tab bar, shown only once a member belongs to a league
 * (hidden on /join, /create, and admin/sub-detail screens like
 * standalone round picking by id - those are reached via the Pick tab
 * itself, not directly from the tab bar).
 */
export function BottomTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueId: routeLeagueId } = useParams<{ leagueId: string }>();
  const leagueId = routeLeagueId || localStorage.getItem("liv_fantasy_league_id");

  if (!leagueId) return null;

  return (
    <Group
      h="100%"
      grow
      gap={0}
      wrap="nowrap"
      style={{
        background: "var(--mantine-color-forest-8)",
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.match(location.pathname, leagueId);
        const Icon = tab.icon;
        return (
          <UnstyledButton
            key={tab.key}
            onClick={() => navigate(tab.path(leagueId))}
            style={{ height: "100%" }}
          >
            <Stack gap={2} align="center" justify="center" h="100%">
              <Icon
                size={22}
                color={
                  isActive ? "var(--mantine-color-mint-4)" : "var(--mantine-color-forest-3)"
                }
              />
              <Text
                size="xs"
                fw={isActive ? 700 : 500}
                c={isActive ? "mint.4" : "forest.3"}
                style={{ fontFamily: "'Poppins', sans-serif" }}
              >
                {tab.label}
              </Text>
            </Stack>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}
