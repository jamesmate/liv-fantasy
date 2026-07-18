const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

function getToken(): string | null {
  return localStorage.getItem("liv_fantasy_session_token");
}

export function setSession(
  token: string,
  memberId: string,
  leagueId: string,
  isOwner: boolean,
  joinCode?: string,
  teamName?: string,
  leagueName?: string
) {
  localStorage.setItem("liv_fantasy_session_token", token);
  localStorage.setItem("liv_fantasy_member_id", memberId);
  localStorage.setItem("liv_fantasy_league_id", leagueId);
  localStorage.setItem("liv_fantasy_is_owner", isOwner ? "1" : "0");
  if (joinCode) {
    localStorage.setItem("liv_fantasy_join_code", joinCode);
  }
  if (teamName) {
    localStorage.setItem("liv_fantasy_team_name", teamName);
  }
  if (leagueName) {
    localStorage.setItem("liv_fantasy_league_name", leagueName);
  }
}

export function getStoredLeagueName(): string | null {
  return localStorage.getItem("liv_fantasy_league_name");
}

export function getStoredTeamName(): string | null {
  return localStorage.getItem("liv_fantasy_team_name");
}

export function clearSession() {
  localStorage.removeItem("liv_fantasy_session_token");
  localStorage.removeItem("liv_fantasy_member_id");
  localStorage.removeItem("liv_fantasy_league_id");
  localStorage.removeItem("liv_fantasy_is_owner");
  localStorage.removeItem("liv_fantasy_join_code");
  localStorage.removeItem("liv_fantasy_team_name");
  localStorage.removeItem("liv_fantasy_league_name");
}

export function getStoredLeagueId(): string | null {
  return localStorage.getItem("liv_fantasy_league_id");
}

export function isStoredOwner(): boolean {
  return localStorage.getItem("liv_fantasy_is_owner") === "1";
}

export function getStoredJoinCode(): string | null {
  return localStorage.getItem("liv_fantasy_join_code");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    // A 401 while we THOUGHT we had a valid token means the session
    // died server-side (e.g. after a migration, or if the account was
    // logged out elsewhere in a flow that does invalidate tokens).
    // Rather than leave the page stuck showing a raw error with no
    // way forward, clear the stale session and send them to re-login.
    // Skip this on the login/join pages themselves, so a wrong
    // passcode just shows its own error instead of bouncing in a loop.
    if (res.status === 401 && token) {
      const onAuthPage = window.location.pathname.startsWith("/login") || window.location.pathname.startsWith("/join");
      if (!onAuthPage) {
        const joinCode = getStoredJoinCode();
        clearSession();
        window.location.href = joinCode
          ? `/login?joinCode=${encodeURIComponent(joinCode)}&reason=expired`
          : "/login?reason=expired";
      }
    }

    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface CurrentTournament {
  id: string;
  name: string;
  status: string;
  espn_event_id: string | null;
  rounds: Array<{
    id: string;
    round_number: number;
    status: string;
    locks_at: string | null;
  }>;
}

export interface AuthResult {
  memberId: string;
  leagueId: string;
  leagueName: string;
  sessionToken: string;
  isOwner: boolean;
  joinCode?: string;
}

export interface BonusEligiblePlayer {
  id: string;
  full_name: string;
  pro_team_name: string | null;
  country_code: string | null;
  is_active: boolean;
  inactive_reason: string | null;
}

export interface MyBonusPick {
  category: string | null;
  pick: {
    id: string;
    tournament_player_id: string;
    full_name: string;
    points: number;
    breakdown: Record<string, number> | null;
    last_synced_at: string | null;
  } | null;
}

export const BONUS_CATEGORY_INFO: Record<string, { label: string; description: string; emoji: string }> = {
  EAGLE: { label: "Eagle Hunter", description: "+25 points for every eagle (or better) scored today.", emoji: "🦅" },
  BIRDIE: { label: "Birdie Machine", description: "+4 points for every birdie scored today.", emoji: "🐦" },
  BOGEY: { label: "Bogey Boy", description: "+5 points for every bogey scored today.", emoji: "😬" },
  DOUBLE_PLUS: {
    label: "Bogey Monster",
    description: "+10 points for every double bogey (or worse) scored today.",
    emoji: "💥",
  },
  POSITIONS_GAINED: {
    label: "Climber",
    description: "+0.5 points (rounded) per leaderboard position gained today.",
    emoji: "📈",
  },
  POSITIONS_LOST: {
    label: "Bottler",
    description: "+0.5 points (rounded) per leaderboard position lost today.",
    emoji: "📉",
  },
};

export interface PlayerOption {
  id: string;
  full_name: string;
  pro_team_name: string | null;
  country_code: string | null;
  is_active: boolean;
  inactive_reason: string | null;
  already_used: boolean;
  total_to_par: number | null;
  rounds_played: number;
  leaderboard_position: number | null;
  round_scores: Array<{ round_number: number; score_to_par: number; field_avg: number | null; field_best: number | null }>;
}

export interface PoolPlayer {
  id: string;
  full_name: string;
  pro_team_name: string | null;
  country_code: string | null;
  is_active: boolean;
  inactive_reason: string | null;
}

export interface LeaderboardRoundPick {
  playerName: string;
  proTeamName: string | null;
  countryCode: string | null;
  scoreToPar: number;
  effectiveScoreToPar: number;
  hasDoublePlay: boolean;
  status: string;
  thru: number | null;
  teeTime: string | null;
  playerRoundScores: { roundNumber: number; scoreToPar: number; fieldAvg: number | null; fieldBest: number | null }[];
  timingRank: number | null;
  timingOf: number | null;
}

export interface LeaderboardRound {
  roundNumber: number;
  total: number | null;
  fullyScored: boolean;
  isDefaulted: boolean;
  bonusPick: { playerName: string; points: number; category: string | null } | null;
  picks: LeaderboardRoundPick[];
}

export interface LeaderboardTeam {
  memberId: string;
  teamName: string;
  displayName: string;
  rounds: LeaderboardRound[];
  overallTotal: number;
  timingScore: number | null;
  timingScoreQualifyingPicks: number;
  totalPicksMade: number;
}

export interface ScheduleEvent {
  id: string;
  name: string;
  tour: string;
  start_date: string;
  end_date: string | null;
  espn_event_id: string | null;
}

export interface MemberCareerStats {
  memberId: string;
  avgHotHandScore: number | null;
  tournamentsWithHotHand: number;
  bestHotHandScore: number | null;
  bestHotHandTournamentName: string | null;
  bestRoundScore: number | null;
  bestRoundTournamentName: string | null;
  bestRoundNumber: number | null;
  favouritePlayerName: string | null;
  favouritePlayerUseCount: number | null;
}

export interface RecapAward {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

export interface TournamentRecap {
  available: boolean;
  tournamentName?: string;
  champion?: { teamName: string; total: number };
  awards: RecapAward[];
}

export interface PendingInterview {
  id: string;
  question_text: string;
  team_name: string;
}

export interface PublishedInterview {
  id: string;
  teamName: string;
  questionText: string;
  answerText: string;
  answeredAt: string;
  reactionCounts: Record<string, number>;
  myReactions: string[];
}

export const REACTION_EMOJIS = ["🔥", "😂", "👏", "😮", "💀"];

export interface Headline {
  id: string;
  text: string;
  emoji: string;
  priority: number;
}

export interface LeaderboardResponse {
  tournament: { id: string; name: string; totalRounds: number } | null;
  teams: LeaderboardTeam[];
}

export interface PodiumStanding {
  member_id: string;
  current_team_name: string;
  display_name: string;
  firsts: number;
  seconds: number;
  thirds: number;
  tournaments_played: number;
  career_total_to_par: number;
  total_points: number;
}

export interface NeedsSwapPick {
  pick_id: string;
  tournament_player_id: string;
  full_name: string;
}

export interface MyPick {
  tournament_player_id: string;
  has_double_play: boolean;
}

export interface MyPickWithScore {
  tournament_player_id: string;
  player_name: string;
  score_to_par: number;
  effective_score_to_par: number;
  has_double_play: boolean;
  player_status: string;
  tee_time: string | null;
}

export type DoublePlayStatus =
  | { used: false }
  | {
      used: true;
      round_number: number;
      full_name: string;
      round_id: string;
      tournament_player_id: string;
    };

export interface CareerStanding {
  member_id: string;
  current_team_name: string;
  display_name: string;
  career_wins: number;
  tournaments_played: number;
  career_total_to_par: number;
  best_tournament_to_par: number | null;
}

export interface TournamentResult {
  id: string;
  tournament_id: string;
  member_id: string;
  team_name: string;
  total_to_par: number;
  placement: number;
  is_win: boolean;
  win_overridden_by_owner: boolean;
}

export interface RoundInfo {
  id: string;
  tournament_id: string;
  round_number: number;
  status: string;
  locks_at: string | null;
  tournament_name: string;
  total_rounds: number;
}

export const api = {
  getRound: (roundId: string) => request<RoundInfo>(`/rounds/${roundId}`),

  createLeague: (name: string, ownerDisplayName: string, ownerTeamName: string) =>
    request<AuthResult>("/leagues", {
      method: "POST",
      body: JSON.stringify({ name, ownerDisplayName, ownerTeamName }),
    }),

  joinLeague: (joinCode: string, displayName: string, teamName: string) =>
    request<AuthResult>("/leagues/join", {
      method: "POST",
      body: JSON.stringify({ joinCode, displayName, teamName }),
    }),

  loginToTeam: (joinCode: string, teamName: string, passcode: string) =>
    request<AuthResult>("/leagues/login", {
      method: "POST",
      body: JSON.stringify({ joinCode, teamName, passcode }),
    }),

  setPasscode: (passcode: string) =>
    request<{ success: true }>("/leagues/passcode", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    }),

  getCurrentTournament: (leagueId: string) =>
    request<CurrentTournament | null>(`/leagues/${leagueId}/current-tournament`),

  getStandings: (leagueId: string) =>
    request<
      Array<{
        member_id: string;
        team_name: string;
        display_name: string;
        total_to_par: number;
        used_double_play: boolean;
      }>
    >(`/leagues/${leagueId}/standings`),

  getTournament: (tournamentId: string) => request<any>(`/tournaments/${tournamentId}`),

  getAvailablePlayers: (roundId: string) =>
    request<PlayerOption[]>(`/rounds/${roundId}/available-players`),

  getMyPicks: (roundId: string) => request<MyPick[]>(`/rounds/${roundId}/my-picks`),

  getMyPicksWithScores: (roundId: string) =>
    request<MyPickWithScore[]>(`/rounds/${roundId}/my-picks-with-scores`),

  getDoublePlayStatus: (roundId: string) =>
    request<DoublePlayStatus>(`/rounds/${roundId}/double-play-status`),

  submitPicks: (
    roundId: string,
    tournamentPlayerIds: string[],
    doublePlayTournamentPlayerId?: string | null
  ) =>
    request<{ success: true }>(`/rounds/${roundId}/picks`, {
      method: "POST",
      body: JSON.stringify({ tournamentPlayerIds, doublePlayTournamentPlayerId }),
    }),

  swapPick: (roundId: string, outgoingTournamentPlayerId: string, incomingTournamentPlayerId: string) =>
    request<{ success: true }>(`/rounds/${roundId}/swap`, {
      method: "POST",
      body: JSON.stringify({ outgoingTournamentPlayerId, incomingTournamentPlayerId }),
    }),

  getBonusEligiblePlayers: (roundId: string) =>
    request<BonusEligiblePlayer[]>(`/rounds/${roundId}/bonus-eligible-players`),

  getMyBonusPick: (roundId: string) => request<MyBonusPick>(`/rounds/${roundId}/my-bonus-pick`),

  submitBonusPick: (roundId: string, tournamentPlayerId: string) =>
    request<{ success: true }>(`/rounds/${roundId}/bonus-pick`, {
      method: "POST",
      body: JSON.stringify({ tournamentPlayerId }),
    }),

  getNeedsSwap: (roundId: string) =>
    request<NeedsSwapPick[]>(`/rounds/${roundId}/needs-swap`),

  // --- Admin (owner-only) ---

  createTournament: (input: {
    name: string;
    parTotal?: number;
    totalRounds?: number;
    espnEventId?: string;
    startsAt?: string;
  }) =>
    request<any>("/admin/tournaments", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  setEspnEventId: (tournamentId: string, espnEventId: string | null) =>
    request<{ success: true }>(`/admin/tournaments/${tournamentId}/espn-event-id`, {
      method: "PATCH",
      body: JSON.stringify({ espnEventId }),
    }),

  setTournamentStatus: (tournamentId: string, status: "upcoming" | "live" | "completed") =>
    request<{ success: true }>(`/admin/tournaments/${tournamentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  deleteTournament: (tournamentId: string) =>
    request<{ success: true }>(`/admin/tournaments/${tournamentId}`, {
      method: "DELETE",
    }),

  addPlayer: (tournamentId: string, fullName: string, proTeamName?: string) =>
    request<PoolPlayer>(`/admin/tournaments/${tournamentId}/players`, {
      method: "POST",
      body: JSON.stringify({ fullName, proTeamName }),
    }),

  addPlayersBulk: (tournamentId: string, players: Array<{ fullName: string; proTeamName?: string; countryCode?: string }>) =>
    request<PoolPlayer[]>(`/admin/tournaments/${tournamentId}/players/bulk`, {
      method: "POST",
      body: JSON.stringify({ players }),
    }),

  seedDefaultRoster: (tournamentId: string) =>
    request<{ added: number; skipped: number }>(
      `/admin/tournaments/${tournamentId}/players/seed-default`,
      { method: "POST" }
    ),

  populateFromEspn: (tournamentId: string) =>
    request<{ eventName: string; fieldSize: number; added: number; skipped: number }>(
      `/admin/tournaments/${tournamentId}/players/populate-from-espn`,
      { method: "POST" }
    ),

  clearAllPlayers: (tournamentId: string) =>
    request<{ deleted: number }>(`/admin/tournaments/${tournamentId}/players`, {
      method: "DELETE",
    }),

  simulateRound: (tournamentId: string, roundNumber: number) =>
    request<{ applied: number; skipped: number; total: number }>(
      `/admin/tournaments/${tournamentId}/simulate-round/${roundNumber}`,
      { method: "POST" }
    ),

  simulateAllRounds: (tournamentId: string) =>
    request<{ rounds: Record<number, { applied: number; skipped: number; total: number }> }>(
      `/admin/tournaments/${tournamentId}/simulate-all-rounds`,
      { method: "POST" }
    ),

  getPlayerPool: (tournamentId: string) =>
    request<PoolPlayer[]>(`/admin/tournaments/${tournamentId}/players`),

  withdrawPlayer: (playerId: string) =>
    request<{ success: true }>(`/admin/players/${playerId}/withdraw`, {
      method: "PATCH",
    }),

  setRoundLock: (roundId: string, locksAt: string | null) =>
    request<{ success: true }>(`/admin/rounds/${roundId}/lock`, {
      method: "PATCH",
      body: JSON.stringify({ locksAt }),
    }),

  getTournamentResults: (tournamentId: string) =>
    request<TournamentResult[]>(`/admin/tournaments/${tournamentId}/results`),

  overrideWin: (tournamentId: string, memberId: string, isWin: boolean) =>
    request<TournamentResult>(`/admin/tournaments/${tournamentId}/results/${memberId}/win`, {
      method: "PATCH",
      body: JSON.stringify({ isWin }),
    }),

  getLeaderboard: (leagueId: string) =>
    request<LeaderboardResponse>(`/leagues/${leagueId}/leaderboard`),

  getHeadlines: (leagueId: string) =>
    request<{ headlines: Headline[] }>(`/leagues/${leagueId}/headlines`),

  getMyPendingInterview: (leagueId: string) =>
    request<PendingInterview | null>(`/leagues/${leagueId}/my-pending-interview`),

  answerInterview: (interviewId: string, answerText: string) =>
    request<{ success: true }>(`/leagues/interview-questions/${interviewId}/answer`, {
      method: "POST",
      body: JSON.stringify({ answerText }),
    }),

  reactToInterview: (interviewId: string, emoji: string) =>
    request<{ success: true; reacted: boolean }>(`/leagues/interview-questions/${interviewId}/react`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),

  getPublishedInterviews: (leagueId: string) =>
    request<PublishedInterview[]>(`/leagues/${leagueId}/interviews`),

  getMembers: () => request<{ id: string; team_name: string; display_name: string }[]>(`/admin/members`),

  sendInterviewQuestion: (memberId: string, questionText: string) =>
    request<{ id: string }>(`/admin/interview-questions`, {
      method: "POST",
      body: JSON.stringify({ memberId, questionText }),
    }),

  getRecap: (leagueId: string) => request<TournamentRecap>(`/leagues/${leagueId}/recap`),

  getPodiumStandings: (leagueId: string) =>
    request<PodiumStanding[]>(`/leagues/${leagueId}/podium-standings`),

  getCareerStats: (leagueId: string) =>
    request<MemberCareerStats[]>(`/leagues/${leagueId}/career-stats`),

  getSchedule: (leagueId: string) => request<ScheduleEvent[]>(`/leagues/${leagueId}/schedule`),

  getLeagueName: (leagueId: string) => request<{ id: string; name: string }>(`/leagues/${leagueId}`),

  addScheduleEvent: (event: {
    name: string;
    tour: string;
    startDate: string;
    endDate?: string;
    espnEventId?: string;
  }) =>
    request<{ id: string }>(`/admin/schedule`, {
      method: "POST",
      body: JSON.stringify(event),
    }),

  deleteScheduleEvent: (id: string) =>
    request<{ success: true }>(`/admin/schedule/${id}`, {
      method: "DELETE",
    }),

  // --- Career / all-time (any member can view) ---

  getCareerStandings: (leagueId: string) =>
    request<CareerStanding[]>(`/leagues/${leagueId}/career-standings`),
};
