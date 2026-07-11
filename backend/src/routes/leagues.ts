import { Router } from "express";
import crypto from "crypto";
import { query } from "../db/client";
import { requireMember } from "../middleware/auth";
import { hashPasscode, verifyPasscode } from "../utils/passcode";
import { maybeSync } from "../services/scoreSync";

export const leagueRouter = Router();

function generateJoinCode(): string {
  // 6-char, unambiguous alphabet (no 0/O, 1/I/L confusion)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}

function generateSessionToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

// POST /leagues  { name, ownerDisplayName, ownerTeamName }
// Creates the league AND its first member (the owner) in one step, so
// the creator gets a session token back immediately - same response
// shape as /leagues/join, so the frontend can treat "create" and
// "join" as the same flow with one extra field.
leagueRouter.post("/", async (req, res) => {
  const { name, ownerDisplayName, ownerTeamName } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "League name is required." });
  }
  if (!ownerDisplayName || !ownerTeamName) {
    return res.status(400).json({ error: "ownerDisplayName and ownerTeamName are required." });
  }

  let joinCode = generateJoinCode();
  // Extremely unlikely to collide, but guard anyway.
  for (let attempts = 0; attempts < 5; attempts++) {
    const existing = await query(`select 1 from leagues where join_code = $1`, [joinCode]);
    if (existing.rows.length === 0) break;
    joinCode = generateJoinCode();
  }

  const league = await query<{ id: string; join_code: string; name: string }>(
    `insert into leagues (name, join_code) values ($1, $2) returning id, join_code, name`,
    [name, joinCode]
  );
  const leagueId = league.rows[0].id;

  const sessionToken = generateSessionToken();
  const owner = await query<{ id: string }>(
    `insert into members (league_id, display_name, team_name, session_token, is_owner)
     values ($1, $2, $3, $4, true) returning id`,
    [leagueId, ownerDisplayName, ownerTeamName, sessionToken]
  );
  await query(`insert into sessions (member_id, token) values ($1, $2)`, [owner.rows[0].id, sessionToken]);

  res.status(201).json({
    leagueId,
    leagueName: league.rows[0].name,
    joinCode: league.rows[0].join_code,
    memberId: owner.rows[0].id,
    sessionToken,
    isOwner: true,
  });
});

// POST /leagues/join  { joinCode, displayName, teamName }
leagueRouter.post("/join", async (req, res) => {
  const { joinCode, displayName, teamName } = req.body;
  if (!joinCode || !displayName || !teamName) {
    return res.status(400).json({ error: "joinCode, displayName, and teamName are required." });
  }

  const league = await query<{ id: string; name: string }>(
    `select id, name from leagues where join_code = $1`,
    [joinCode.toUpperCase()]
  );
  if (league.rows.length === 0) {
    return res.status(404).json({ error: "No league found with that join code." });
  }
  const leagueId = league.rows[0].id;

  const teamNameTaken = await query(
    `select 1 from members where league_id = $1 and team_name = $2`,
    [leagueId, teamName]
  );
  if (teamNameTaken.rows.length > 0) {
    return res.status(409).json({ error: "That team name is already taken in this league." });
  }

  const sessionToken = generateSessionToken();
  const member = await query<{ id: string }>(
    `insert into members (league_id, display_name, team_name, session_token)
     values ($1, $2, $3, $4) returning id`,
    [leagueId, displayName, teamName, sessionToken]
  );
  await query(`insert into sessions (member_id, token) values ($1, $2)`, [member.rows[0].id, sessionToken]);

  res.status(201).json({
    memberId: member.rows[0].id,
    leagueId,
    leagueName: league.rows[0].name,
    sessionToken,
    isOwner: false,
  });
});

// POST /leagues/passcode  { passcode }
// Lets the currently logged-in member set/change the passcode for
// THEIR OWN team, so they can log back into this exact team from any
// device later via /leagues/login.
leagueRouter.post("/passcode", requireMember, async (req, res) => {
  const { passcode } = req.body;
  if (!passcode || typeof passcode !== "string" || passcode.length < 4) {
    return res.status(400).json({ error: "Passcode must be at least 4 characters." });
  }

  const passcodeHash = hashPasscode(passcode);
  await query(`update members set passcode_hash = $1 where id = $2`, [passcodeHash, req.member!.id]);

  res.json({ success: true });
});

// POST /leagues/login  { joinCode, teamName, passcode }
// Logs back into an EXISTING team from any device, using the passcode
// that team set via /leagues/passcode. Issues a new session token
// ADDED to this member's sessions, alongside any others already
// active - logging in on a new device (e.g. mobile) no longer signs
// out other devices, since each has its own row in the sessions table.
leagueRouter.post("/login", async (req, res) => {
  const { joinCode, teamName, passcode } = req.body;
  if (!joinCode || !teamName || !passcode) {
    return res.status(400).json({ error: "joinCode, teamName, and passcode are required." });
  }

  const league = await query<{ id: string; name: string }>(
    `select id, name from leagues where join_code = $1`,
    [joinCode.toUpperCase()]
  );
  if (league.rows.length === 0) {
    return res.status(404).json({ error: "No league found with that join code." });
  }
  const leagueId = league.rows[0].id;

  const member = await query<{
    id: string;
    is_owner: boolean;
    passcode_hash: string | null;
  }>(
    `select id, is_owner, passcode_hash from members where league_id = $1 and team_name = $2`,
    [leagueId, teamName]
  );
  if (member.rows.length === 0) {
    return res.status(404).json({ error: "No team with that name in this league." });
  }
  const { id: memberId, is_owner: isOwner, passcode_hash: passcodeHash } = member.rows[0];

  if (!passcodeHash) {
    return res.status(400).json({
      error: "This team hasn't set a passcode yet. Set one from the device you're already logged in on first.",
    });
  }
  if (!verifyPasscode(passcode, passcodeHash)) {
    return res.status(401).json({ error: "Incorrect passcode." });
  }

  const sessionToken = crypto.randomBytes(24).toString("hex");
  await query(`insert into sessions (member_id, token) values ($1, $2)`, [memberId, sessionToken]);

  res.json({
    memberId,
    leagueId,
    leagueName: league.rows[0].name,
    sessionToken,
    isOwner,
  });
});

// GET /leagues/:id/current-tournament - the most recently created
// tournament for this league, with its rounds. Used by the frontend to
// know what to link the "Pick" buttons to without hardcoding ids.
leagueRouter.get("/:id/current-tournament", async (req, res) => {
  const tournament = await query(
    `select * from tournaments where league_id = $1 order by created_at desc limit 1`,
    [req.params.id]
  );
  if (tournament.rows.length === 0) {
    return res.json(null);
  }
  maybeSync(tournament.rows[0].id, tournament.rows[0].espn_event_id, tournament.rows[0].status);
  const rounds = await query(
    `select * from rounds where tournament_id = $1 order by round_number asc`,
    [tournament.rows[0].id]
  );
  res.json({ ...tournament.rows[0], rounds: rounds.rows });
});

// GET /leagues/:id/podium-standings - all-time ranking by count of
// 1st/2nd/3rd place finishes across every completed tournament, NOT
// by total score - used by the Overall Standings tab. Sort order:
// most 1sts, then most 2nds, then most 3rds, then lowest career score
// as a final tiebreak.
leagueRouter.get("/:id/podium-standings", async (req, res) => {
  const result = await query(
    `select * from podium_standings
      where league_id = $1
      order by firsts desc, seconds desc, thirds desc, career_total_to_par asc`,
    [req.params.id]
  );
  res.json(result.rows);
});

// GET /leagues/:id/career-standings - all-time wins and accumulated
// score per team in this league, across every completed tournament.
// Unlike most other league routes, this doesn't require ownership -
// any member should be able to see the all-time leaderboard.
leagueRouter.get("/:id/career-standings", async (req, res) => {
  const result = await query(
    `select * from career_standings
      where league_id = $1
      order by career_wins desc, career_total_to_par asc`,
    [req.params.id]
  );
  res.json(result.rows);
});

// GET /leagues/:id/leaderboard
// Full data for the Leaderboard tab: each team's score per round and
// total, PLUS each team's individual picks (player name + that
// player's score) per round, for the tap-to-expand detail view.
// Returns the latest tournament for this league, same scoping as
// /standings.
leagueRouter.get("/:id/leaderboard", async (req, res) => {
  const tournament = await query<{ id: string; total_rounds: number }>(
    `select id, total_rounds from tournaments where league_id = $1 order by created_at desc limit 1`,
    [req.params.id]
  );
  if (tournament.rows.length === 0) {
    return res.json({ tournament: null, teams: [] });
  }
  const tournamentId = tournament.rows[0].id;
  const totalRounds = tournament.rows[0].total_rounds;

  const teams = await query<{
    member_id: string;
    team_name: string;
    display_name: string;
  }>(
    `select id as member_id, team_name, display_name from members where league_id = $1`,
    [req.params.id]
  );

  const roundTotals = await query<{
    member_id: string;
    round_number: number;
    round_total: number;
    round_fully_scored: boolean;
  }>(
    `select member_id, round_number, round_total, round_fully_scored
       from team_round_totals
      where tournament_id = $1`,
    [tournamentId]
  );

  const picks = await query<{
    member_id: string;
    round_number: number;
    player_name: string;
    pro_team_name: string | null;
    country_code: string | null;
    score_to_par: number;
    has_double_play: boolean;
    player_status: string;
  }>(
    `select member_id, round_number, player_name, pro_team_name, country_code,
            score_to_par, has_double_play, player_status
       from pick_scores
      where tournament_id = $1
      order by round_number asc`,
    [tournamentId]
  );

  const result = teams.rows.map((team) => {
    const teamRoundTotals = roundTotals.rows.filter((r) => r.member_id === team.member_id);
    const teamPicks = picks.rows.filter((p) => p.member_id === team.member_id);

    const rounds = Array.from({ length: totalRounds }, (_, i) => {
      const roundNumber = i + 1;
      const totalRow = teamRoundTotals.find((r) => r.round_number === roundNumber);
      const roundPicks = teamPicks.filter((p) => p.round_number === roundNumber);
      return {
        roundNumber,
        total: totalRow?.round_total ?? null,
        fullyScored: totalRow?.round_fully_scored ?? false,
        picks: roundPicks.map((p) => ({
          playerName: p.player_name,
          proTeamName: p.pro_team_name,
          countryCode: p.country_code,
          scoreToPar: p.score_to_par,
          hasDoublePlay: p.has_double_play,
          status: p.player_status,
        })),
      };
    });

    const overallTotal = teamRoundTotals.reduce((sum, r) => sum + Number(r.round_total), 0);

    return {
      memberId: team.member_id,
      teamName: team.team_name,
      displayName: team.display_name,
      rounds,
      overallTotal,
    };
  });

  // Sort by overall total ascending (lowest/best score first), same
  // convention as golf leaderboards.
  result.sort((a, b) => a.overallTotal - b.overallTotal);

  res.json({ tournament: { id: tournamentId, totalRounds }, teams: result });
});

// GET /leagues/:id/standings - latest tournament's running totals
leagueRouter.get("/:id/standings", async (req, res) => {
  const result = await query(
    `select * from tournament_standings
      where tournament_id in (
        select id from tournaments where league_id = $1 order by created_at desc limit 1
      )
      order by total_to_par asc`,
    [req.params.id]
  );
  res.json(result.rows);
});
