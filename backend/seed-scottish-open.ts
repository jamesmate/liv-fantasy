/**
 * Seed: Genesis Scottish Open 2026 (DP World Tour / PGA TOUR co-sanctioned)
 * --------------------------------------------------------------------------
 * One-off script for testing the whole app against a REAL live event
 * instead of the bundled Andalucia simulation data.
 *
 * ESPN event id 401811955 was confirmed by looking up ESPN's own
 * leaderboard page for the tournament:
 *   https://www.espn.com/golf/leaderboard?tournamentId=401811955
 * Event: Genesis Scottish Open, The Renaissance Club, July 9-12 2026.
 *
 * What this does:
 *   1. Calls the real ESPN adapter (live network call - run this from a
 *      machine with normal internet access) to pull the current field
 *      for event 401811955.
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
 *   API_BASE_URL=http://localhost:3001 SESSION_TOKEN=<your owner token> \
 *     npx tsx src/scripts/seed-scottish-open.ts
 *
 * SESSION_TOKEN must belong to a league member with is_owner = true
 * (the admin routes are owner-only). Get it the same way you normally
 * authenticate to the app locally (check what the frontend stores after
 * you join/create your league - see src/api/client.ts).
 */

import { getLeaderboard } from "../adapters/espnGolf";

const ESPN_EVENT_ID = "401811955";
const TOURNAMENT_NAME = "Genesis Scottish Open 2026";
const PAR = 70; // The Renaissance Club plays to a par of 70
const TOTAL_ROUNDS = 4;

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

  console.log(`Creating tournament "${TOURNAMENT_NAME}"...`);
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
