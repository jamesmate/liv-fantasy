/**
 * Seed: any ESPN golf event
 * ---------------------------
 * Generalized version of the old seed-scottish-open.ts. Instead of
 * hardcoding one event, this takes the ESPN event id, tournament name,
 * par, and round count as CLI arguments - use it for every future LIV
 * event, DP World event, or anything else ESPN's golf leaderboard
 * covers.
 *
 * What this does:
 *   1. Calls the real ESPN adapter (live network call - run this from a
 *      machine with normal internet access) to pull the current field
 *      for the given event id.
 *   2. Creates a tournament in your league via the admin API, with
 *      espnEventId set so the background sync loop can pick it up.
 *   3. Bulk-adds every player currently in the ESPN field (deduped -
 *      the adapter returns one row per round, so we collapse to one
 *      row per player).
 *   4. Flips the tournament to status "live", which is what turns on
 *      the 3-minute score sync loop in src/index.ts.
 *
 * Usage:
 *   cd backend
 *   API_BASE_URL=https://liv-fantasy.onrender.com SESSION_TOKEN=<owner token> \
 *     npx tsx src/scripts/seed-tournament.ts <espnEventId> "<Tournament Name>" [par] [totalRounds]
 *
 * Example:
 *   npx tsx src/scripts/seed-tournament.ts 401811955 "Genesis Scottish Open 2026" 70 4
 *
 * par and totalRounds are optional - default to 72 and 4 if omitted.
 *
 * Where to find the ESPN event id: search "<event name> espn leaderboard",
 * open ESPN's own leaderboard page for it, and pull the number out of
 * the URL - espn.com/golf/leaderboard?tournamentId=XXXXXX
 *
 * SESSION_TOKEN must belong to a league member with is_owner = true
 * (the admin routes are owner-only). Get it from localStorage on the
 * device you're logged into that league on (liv_fantasy_session_token).
 */

import { getLeaderboard } from "../adapters/espnGolf";

const [, , espnEventIdArg, nameArg, parArg, roundsArg] = process.argv;

if (!espnEventIdArg || !nameArg) {
  console.error(
    'Usage: npx tsx src/scripts/seed-tournament.ts <espnEventId> "<Tournament Name>" [par] [totalRounds]'
  );
  process.exit(1);
}

const ESPN_EVENT_ID = espnEventIdArg;
const TOURNAMENT_NAME = nameArg;
const PAR = parArg ? Number(parArg) : 72;
const TOTAL_ROUNDS = roundsArg ? Number(roundsArg) : 4;

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3001";
const SESSION_TOKEN = process.env.SESSION_TOKEN;

if (!SESSION_TOKEN) {
  console.error("Missing SESSION_TOKEN env var - this must be an owner's session token.");
  process.exit(1);
}

async function adminFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/admin${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SESSION_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method || "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

interface Tournament {
  id: string;
  name: string;
  espn_event_id: string | null;
}

async function main() {
  console.log(`Fetching live ESPN field for event ${ESPN_EVENT_ID}...`);
  const board = await getLeaderboard(ESPN_EVENT_ID);
  console.log(`ESPN reports: "${board.eventName}", round ${board.currentRound}, ${board.players.length} player-round rows.`);

  // Collapse the one-row-per-round shape down to one row per player.
  const byId = new Map<string, { espnPlayerId: string; fullName: string }>();
  for (const p of board.players) {
    if (!byId.has(p.espnPlayerId)) {
      byId.set(p.espnPlayerId, { espnPlayerId: p.espnPlayerId, fullName: p.fullName });
    }
  }
  const players = Array.from(byId.values());
  console.log(`${players.length} unique players in the field.`);

  console.log(`Creating tournament "${TOURNAMENT_NAME}" (par ${PAR}, ${TOTAL_ROUNDS} rounds)...`);
  const tournament = await adminFetch<Tournament>("/tournaments", {
    method: "POST",
    body: JSON.stringify({
      name: TOURNAMENT_NAME,
      parTotal: PAR,
      totalRounds: TOTAL_ROUNDS,
      espnEventId: ESPN_EVENT_ID,
    }),
  });
  console.log(`Created tournament ${tournament.id}.`);

  console.log(`Bulk-adding ${players.length} players...`);
  await adminFetch(`/tournaments/${tournament.id}/players/bulk`, {
    method: "POST",
    body: JSON.stringify({
      players: players.map((p) => ({
        fullName: p.fullName,
        espnPlayerId: p.espnPlayerId,
        // proTeamName left null - not applicable outside LIV team format
      })),
    }),
  });

  console.log(`Flipping tournament to "live" (starts the score sync loop)...`);
  await adminFetch(`/tournaments/${tournament.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "live" }),
  });

  console.log(`\nDone. Tournament ${tournament.id} is live and will sync scores every 3 minutes`);
  console.log(`while the server is running (see src/index.ts SYNC_INTERVAL_MS).`);
  console.log(`Open the app and point it at this tournament to start picking and testing.`);
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
