import { Router } from "express";
import crypto from "crypto";
import { query } from "../db/client";
import { requireMember } from "../middleware/auth";
import { hashPasscode, verifyPasscode } from "../utils/passcode";
import { maybeSync } from "../services/scoreSync";
import { generateHeadlines } from "../services/headlines";
import { generateRecap } from "../services/recap";

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
// GET /leagues/:id - just the name, for the top bar to fall back to
// fetching if a session predates when the league name started being
// cached in localStorage at login time.
leagueRouter.get("/:id", async (req, res) => {
  const result = await query<{ name: string }>(`select name from leagues where id = $1`, [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "League not found." });
  }
  res.json({ id: req.params.id, name: result.rows[0].name });
});

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

// GET /leagues/:id/career-stats - persistent, cross-tournament stats
// per member (average/best Hot Hand Score, favourite player, best
// single round ever) - computed once at each tournament's
// finalization, not live. See services/careerStats.ts.
// GET /leagues/:id/schedule - upcoming (and recent past) events for
// this league, soonest first. See schema.sql for why this is separate
// from `tournaments` - it's a calendar entered ahead of time, not
// necessarily wired up for picking yet.
leagueRouter.get("/:id/schedule", async (req, res) => {
  try {
    const result = await query(
      `select id, name, tour, start_date, end_date, espn_event_id
         from schedule_events
        where league_id = $1
        order by start_date asc`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("schedule query failed:", err);
    res.json([]);
  }
});

leagueRouter.get("/:id/career-stats", async (req, res) => {
  try {
    const result = await query<{
      member_id: string;
      tournaments_with_hot_hand: number;
      hot_hand_score_sum: number;
      best_hot_hand_score: number | null;
      best_hot_hand_tournament_name: string | null;
      best_round_score: number | null;
      best_round_tournament_name: string | null;
      best_round_number: number | null;
      favourite_player_name: string | null;
      favourite_player_use_count: number | null;
    }>(
      `select mcs.*
         from member_career_stats mcs
         join members m on m.id = mcs.member_id
        where m.league_id = $1`,
      [req.params.id]
    );
    const stats = result.rows.map((r) => ({
      memberId: r.member_id,
      avgHotHandScore:
        r.tournaments_with_hot_hand > 0 ? Math.round(r.hot_hand_score_sum / r.tournaments_with_hot_hand) : null,
      tournamentsWithHotHand: r.tournaments_with_hot_hand,
      bestHotHandScore: r.best_hot_hand_score,
      bestHotHandTournamentName: r.best_hot_hand_tournament_name,
      bestRoundScore: r.best_round_score,
      bestRoundTournamentName: r.best_round_tournament_name,
      bestRoundNumber: r.best_round_number,
      favouritePlayerName: r.favourite_player_name,
      favouritePlayerUseCount: r.favourite_player_use_count,
    }));
    res.json(stats);
  } catch (err) {
    // Degrade gracefully (e.g. member_career_stats doesn't exist yet
    // because the migration hasn't been run) rather than leaving the
    // request hanging with no response at all - an unguarded throw in
    // an Express 4 async handler never sends anything back, which
    // looks like an infinite loading spinner on the frontend rather
    // than a clear error.
    console.error("career-stats query failed:", err);
    res.json([]);
  }
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

// GET /leagues/:id/headlines
// Auto-generated news feed about this league's picks in the CURRENT
// live round - double plays paying off/backfiring, who's leading,
// missed-cut disasters. See services/headlines.ts for the actual
// logic. Regenerated fresh each request, nothing stored.
leagueRouter.get("/:id/headlines", async (req, res) => {
  try {
    const tournament = await query<{ id: string }>(
      `select id from tournaments where league_id = $1 order by created_at desc limit 1`,
      [req.params.id]
    );
    if (tournament.rows.length === 0) {
      return res.json({ headlines: [] });
    }
    const headlines = await generateHeadlines(tournament.rows[0].id);
    res.json({ headlines });
  } catch (err) {
    console.error("headlines query failed:", err);
    res.json({ headlines: [] });
  }
});

// GET /leagues/:id/recap
// "Awards ceremony" for the most recent tournament, only populated
// once it's marked completed - see services/recap.ts.
leagueRouter.get("/:id/recap", async (req, res) => {
  try {
    const recap = await generateRecap(req.params.id);
    res.json(recap);
  } catch (err) {
    console.error("recap query failed:", err);
    res.json({ available: false, awards: [] });
  }
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
    tournament_player_id: string;
    player_name: string;
    pro_team_name: string | null;
    country_code: string | null;
    score_to_par: number;
    has_double_play: boolean;
    player_status: string;
  }>(
    `select member_id, round_number, tournament_player_id, player_name, pro_team_name, country_code,
            score_to_par, has_double_play, player_status
       from pick_scores
      where tournament_id = $1
      order by round_number asc`,
    [tournamentId]
  );

  // Every played round for every player who's been picked at least
  // once - used both for the sparklines (full round-by-round line)
  // and for computing "was this the round they were picked for their
  // best round, or their worst" (see timingRank below). Deliberately
  // NOT scoped to only the specific round each pick was for - we need
  // each player's OTHER rounds too, to know where the picked one
  // ranks among them.
  const playerRounds = await query<{ tournament_player_id: string; round_number: number; score_to_par: number }>(
    `select prs.tournament_player_id, r.round_number, prs.score_to_par
       from player_round_scores prs
       join rounds r on r.id = prs.round_id
      where r.tournament_id = $1
        and prs.score_to_par is not null
        and prs.tournament_player_id in (
          select distinct p.tournament_player_id
            from picks p
            join rounds r2 on r2.id = p.round_id
           where r2.tournament_id = $1
        )
      order by r.round_number asc`,
    [tournamentId]
  );
  const roundsByPlayer = new Map<string, { roundNumber: number; scoreToPar: number }[]>();
  for (const row of playerRounds.rows) {
    const list = roundsByPlayer.get(row.tournament_player_id) ?? [];
    list.push({ roundNumber: row.round_number, scoreToPar: row.score_to_par });
    roundsByPlayer.set(row.tournament_player_id, list);
  }

  // Field average score for each round - the WHOLE field that played
  // it, not just picked players. Used to tell "genuinely a good/bad
  // round" apart from "the course played hard/easy that day": a +3 on
  // a day the field averaged +5 is actually a strong relative
  // performance, even though a raw -1 on an easy day looks better on
  // paper. Comparing a player's rounds to EACH OTHER using raw scores
  // (the original version of this feature) would rank that +3 as
  // their worst round even though it may have been their sharpest
  // relative to the conditions everyone else was facing that day.
  const fieldAverages = await query<{ round_number: number; field_avg: string; field_best: number }>(
    `select r.round_number, avg(prs.score_to_par) as field_avg, min(prs.score_to_par) as field_best
       from player_round_scores prs
       join rounds r on r.id = prs.round_id
      where r.tournament_id = $1
        and prs.score_to_par is not null
      group by r.round_number`,
    [tournamentId]
  );
  const fieldAvgByRound = new Map<number, number>(
    fieldAverages.rows.map((r) => [r.round_number, Number(r.field_avg)])
  );
  const fieldBestByRound = new Map<number, number>(fieldAverages.rows.map((r) => [r.round_number, r.field_best]));

  // For a single pick, where does the round it was made for rank
  // among that SAME player's other rounds (1 = their best round of
  // the tournament so far, higher = worse)? Only meaningful once the
  // player has 2+ rounds played - with just one round there's nothing
  // to compare it against, so timingRank is null until then.
  function getTimingRank(tournamentPlayerId: string, roundNumber: number): { rank: number; of: number } | null {
    const rounds = roundsByPlayer.get(tournamentPlayerId);
    if (!rounds || rounds.length < 2) return null;
    // Field-adjusted: how much better/worse than that day's field
    // average this round was, not the raw score - see comment above
    // fieldAvgByRound for why.
    const adjusted = (r: { roundNumber: number; scoreToPar: number }) =>
      r.scoreToPar - (fieldAvgByRound.get(r.roundNumber) ?? 0);
    const sorted = [...rounds].sort((a, b) => adjusted(a) - adjusted(b));
    const rank = sorted.findIndex((r) => r.roundNumber === roundNumber) + 1;
    if (rank === 0) return null; // this round's score isn't in yet
    return { rank, of: rounds.length };
  }

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
        picks: roundPicks.map((p) => {
          const timing = getTimingRank(p.tournament_player_id, p.round_number);
          return {
            playerName: p.player_name,
            proTeamName: p.pro_team_name,
            countryCode: p.country_code,
            scoreToPar: p.score_to_par,
            hasDoublePlay: p.has_double_play,
            status: p.player_status,
            // Full round-by-round line for this player, for the
            // sparkline - empty/short until they've played enough to
            // be worth graphing. fieldAvg alongside each round lets
            // the frontend show field-adjusted magnitude (a round
            // that beat a brutal scoring day should look "big" even
            // if the raw number isn't pretty).
            playerRoundScores: (roundsByPlayer.get(p.tournament_player_id) ?? []).map((r) => ({
              ...r,
              fieldAvg: fieldAvgByRound.get(r.roundNumber) ?? null,
              fieldBest: fieldBestByRound.get(r.roundNumber) ?? null,
            })),
            // Where this specific pick's round ranked among that
            // player's OWN rounds (1 = best) - null until that player
            // has 2+ rounds in, per the "not meaningful with only one
            // data point" reasoning.
            timingRank: timing?.rank ?? null,
            timingOf: timing?.of ?? null,
          };
        }),
      };
    });

    const overallTotal = teamRoundTotals.reduce((sum, r) => sum + Number(r.round_total), 0);

    // Aggregate "Timing Score": average, across every pick that has a
    // meaningful timingRank (player had 2+ rounds), of how close to
    // "their best round" the pick landed - 100% = every pick captured
    // that player's single best round, 0% = every pick landed on
    // their worst. Only worth displaying once there are at least 2
    // qualifying picks (see rationale in the pick_scores comment
    // above) - the frontend decides the display threshold, but we
    // still tell it exactly how many qualify so it can show "(2 of 4
    // picks scored)" style context either way.
    const qualifyingPicks = teamPicks
      .map((p) => getTimingRank(p.tournament_player_id, p.round_number))
      .filter((t): t is { rank: number; of: number } => t !== null && t.of > 1);
    const timingScore =
      qualifyingPicks.length > 0
        ? Math.round(
            (qualifyingPicks.reduce((sum, t) => sum + (t.of - t.rank) / (t.of - 1), 0) / qualifyingPicks.length) * 100
          )
        : null;

    return {
      memberId: team.member_id,
      teamName: team.team_name,
      displayName: team.display_name,
      rounds,
      overallTotal,
      timingScore,
      timingScoreQualifyingPicks: qualifyingPicks.length,
      totalPicksMade: teamPicks.length,
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
