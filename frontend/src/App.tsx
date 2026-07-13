import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell, Box } from "@mantine/core";
import JoinPage from "./pages/JoinPage";
import LoginPage from "./pages/LoginPage";
import CreateLeaguePage from "./pages/CreateLeaguePage";
import PickTabPage from "./pages/PickTabPage";
import SchedulePage from "./pages/SchedulePage";
import LeaderboardTabPage from "./pages/LeaderboardTabPage";
import OverallStandingsTabPage from "./pages/OverallStandingsTabPage";
import CareerStandingsPage from "./pages/CareerStandingsPage";
import AdminPage from "./pages/AdminPage";
import { getStoredLeagueId } from "./api/client";
import { TopBar } from "./components/TopBar";
import { BottomTabBar } from "./components/BottomTabBar";

export default function App() {
  return (
    <BrowserRouter>
      <AppShell
        header={{ height: 60 }}
        footer={{ height: 64 }}
        styles={{
          header: {
            background: "var(--mantine-color-forest-8)",
            borderBottom: "none",
          },
          footer: {
            border: "none",
            padding: 0,
          },
          main: {
            background: "var(--mantine-color-forest-0)",
            minHeight: "100dvh",
          },
        }}
      >
        <AppShell.Header>
          <TopBar />
        </AppShell.Header>
        <AppShell.Main>
          <Box
            mx="auto"
            style={{
              width: "100%",
              maxWidth: 560,
            }}
          >
            <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <Routes>
                <Route path="/" element={<HomeRedirect />} />
                <Route path="/join" element={<JoinPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/create" element={<CreateLeaguePage />} />
                <Route path="/league/:leagueId/pick" element={<PickTabPage />} />
                <Route path="/league/:leagueId/schedule" element={<SchedulePage />} />
                <Route path="/league/:leagueId/leaderboard" element={<LeaderboardTabPage />} />
                <Route
                  path="/league/:leagueId/overall-standings"
                  element={<OverallStandingsTabPage />}
                />
                <Route path="/league/:leagueId/career" element={<CareerStandingsPage />} />
                <Route path="/league/:leagueId/admin" element={<AdminPage />} />
                {/* Backward-compatible redirect for the old per-round route */}
                <Route path="/league/:leagueId" element={<PickRedirect />} />
              </Routes>
            </Box>
          </Box>
        </AppShell.Main>
        <AppShell.Footer>
          <BottomTabBar />
        </AppShell.Footer>
      </AppShell>
    </BrowserRouter>
  );
}

function HomeRedirect() {
  const leagueId = getStoredLeagueId();
  return <Navigate to={leagueId ? `/league/${leagueId}/pick` : "/join"} replace />;
}

function PickRedirect() {
  const leagueId = getStoredLeagueId();
  return <Navigate to={leagueId ? `/league/${leagueId}/pick` : "/join"} replace />;
}
