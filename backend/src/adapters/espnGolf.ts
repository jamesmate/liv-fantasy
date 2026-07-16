/**
 * ESPN Golf Adapter
 * ------------------
 * Wraps ESPN's unofficial/undocumented "hidden" golf leaderboard
 * endpoint. VERIFIED against a real completed event (LIV Golf
 * Andalucia 2026, event id 401809165) by capturing the actual network
 * request ESPN's own leaderboard page makes - this is not a guess
 * based on other sports' API shapes.
 *
 * IMPORTANT: This is not an official, supported API. ESPN can change or
 * remove it without notice. Everything that talks to ESPN lives in this
 * one file so that if it breaks, only this file needs to change - the
 * rest of the app talks to the normalized shape returned by
 * `getLeaderboard()`, not to ESPN's raw JSON.
 *
 * Verified endpoint pattern:
 *   GET https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard
 *       ?league=all&region=us&lang=en&event={espnEventId}
 *
 * Notes on the real shape (confirmed by inspecting a real response):
 * - There is NO per-league path segment (unlike most other ESPN
 *   sports) - "league=all" is a query param, and `event` is required
 *   to get a specific tournament. Without `event`, this likely returns
 *   whatever ESPN considers current/upcoming, which is not useful for
 *   targeting a specific past or scheduled LIV event.
 * - `events[0].competitions[0].competitors[]` holds one entry per
 *   golfer, each with:
 *     - `athlete.id`, `athlete.displayName`
 *     - `score.displayValue` - the player's TOTAL score to par (e.g. "-11")
 *     - `linescores[]` - one entry per round, each with:
 *         - `period` (1-4, the round number)
 *         - `displayValue` - score to par for that round (e.g. "-4", "E"),
 *           or "-" if the round was not played (e.g. after a withdrawal)
 *         - `value` - RAW STROKES for that round (e.g. 67), NOT to-par -
 *           do not confuse this with displayValue
 *     - `status.displayValue` - short code: "F" (finished), "WD"
 *       (withdrawn), etc.
 *     - `status.type.description` - human-readable status, more
 *       reliable for withdrawal detection than `type.name`, which uses
 *       the confusingly-named "STATUS_CUT" for withdrawals (LIV has no
 *       cut, so this is just ESPN's status enum being reused loosely).
 *       On events that DO have a real cut (PGA/DP World co-sanctioned
 *       events like the Scottish Open), `description` says "Cut" for
 *       players who missed it - distinct from "Withdrawn".
 *     - `status.thru` - holes completed in the CURRENT/most recent round
 *   There is no team/pro-team field on the competitor or athlete
 *   objects - LIV pro team affiliation is not exposed here, which
 *   matches this app's existing design of entering it manually.
 */

const ESPN_LEADERBOARD_URL = "https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard";

export interface NormalizedPlayerRound {
  espnPlayerId: string;
  fullName: string;
  proTeamName: string | null;
  roundNumber: number;
  scoreToPar: number | null; // null = round not played (not started, or withdrew before this round)
  thru: number; // holes completed in the current/most recent round, 0-18
  teeTime: string | null; // ISO timestamp - meaningful mainly when status is not_started
  status: "not_started" | "in_progress" | "completed" | "withdrawn" | "missed_cut";
  // Leaderboard position at the START and CURRENT point of this round
  // specifically (not overall tournament position) - used for the
  // Positions Gained/Lost bonus pick categories. Null for a round
  // that hasn't started yet, or wasn't available from ESPN.
  startPosition: number | null;
  currentPosition: number | null;
}

export interface NormalizedLeaderboard {
  espnEventId: string;
  eventName: string;
  currentRound: number;
  eventCompleted: boolean;
  players: NormalizedPlayerRound[];
}

/**
 * Maps ESPN's status to our internal enum.
 *
 * Withdrawal detection checks every subfield ESPN might populate
 * (name, description, shortDetail, detail) - this needs to stay
 * broad, since LIV events (which have no real cut) use the literal
 * enum name "STATUS_CUT" to represent a withdrawal, and that's the
 * one already-verified-reliable signal for LIV.
 *
 * Missed-cut detection deliberately does NOT check `type.name`, only
 * the human-readable fields (description, shortDetail, detail) - if
 * it included `name`, every LIV withdrawal ("STATUS_CUT" in name)
 * would risk being misread as a missed cut instead, on any event
 * where the human-readable withdrawal text happens to be missing.
 * Keeping the two checks on non-overlapping field sets means a LIV
 * event can never produce a false "missed_cut" no matter what ESPN
 * does or doesn't populate - there's no field a LIV withdrawal could
 * hit that this cut-check also reads from.
 */
function normalizeStatus(type: { description?: string; name?: string; shortDetail?: string; detail?: string } | undefined): NormalizedPlayerRound["status"] {
  const withdrawalText = [type?.description, type?.name, type?.shortDetail, type?.detail]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (withdrawalText.includes("withdr") || /\bwd\b/.test(withdrawalText)) return "withdrawn";

  const cutText = [type?.description, type?.shortDetail, type?.detail].filter(Boolean).join(" ").toLowerCase();
  if (cutText.includes("cut") || /\bmc\b/.test(cutText)) return "missed_cut";

  if (withdrawalText.includes("finish") || withdrawalText.includes("final") || withdrawalText.includes("complete"))
    return "completed";
  if (withdrawalText.includes("progress") || withdrawalText.includes("active")) return "in_progress";
  return "not_started";
}

/**
 * Fetches and normalizes the leaderboard for a specific LIV event.
 * espnEventId is required in practice - without it, ESPN returns
 * whatever event it considers "current", which is rarely the one you
 * want for a scheduled sync against a specific tournament.
 * Throws on network/parse failure - callers should catch and fall back
 * to the cached snapshot (see services/scoreSync.ts).
 */
export async function getLeaderboard(espnEventId: string): Promise<NormalizedLeaderboard> {
  const url = `${ESPN_LEADERBOARD_URL}?league=all&region=us&lang=en&event=${espnEventId}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`ESPN leaderboard fetch failed: ${res.status} ${res.statusText}`);
  }

  const raw = await res.json();
  return normalizeEspnResponse(raw);
}

/** Converts ESPN's raw leaderboard JSON into our normalized shape. */
function normalizeEspnResponse(raw: any): NormalizedLeaderboard {
  const event = raw?.events?.[0];
  if (!event) {
    throw new Error("ESPN response contained no events - check the event id.");
  }

  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const eventCompleted = !!event.status?.type?.completed;

  const players: NormalizedPlayerRound[] = [];

  for (const c of competitors) {
    const athlete = c.athlete ?? {};
    const espnPlayerId = String(athlete.id ?? c.id ?? "");
    const fullName = athlete.displayName ?? "Unknown Player";
    const overallStatus = normalizeStatus(c.status?.type);
    const linescores = c.linescores ?? [];

    // Emit one NormalizedPlayerRound per round that ESPN has a
    // linescore entry for. A withdrawn player's not-played round has
    // displayValue "-" (parses to null) rather than being absent
    // entirely, so we still get a row for it with scoreToPar: null.
    for (const ls of linescores) {
      const roundNumber = Number(ls.period);
      const scoreToPar = parseScoreToPar(ls.displayValue);

      // A round reads as "withdrawn"/"missed_cut" only if it has no
      // score AND the player's overall status matches (i.e. this is
      // the round they didn't play because of it). Any round that DOES
      // have a score was actually played, so it reads as "completed"
      // even if the player withdrew/missed the cut later - their
      // earlier rounds still count.
      const roundStatus: NormalizedPlayerRound["status"] =
        scoreToPar === null
          ? overallStatus === "withdrawn"
            ? "withdrawn"
            : overallStatus
          : "completed";

      players.push({
        espnPlayerId,
        fullName,
        proTeamName: null, // not exposed by this endpoint - entered manually in admin
        roundNumber,
        scoreToPar,
        thru: roundNumber === (competition?.status?.period ?? roundNumber) ? Number(c.status?.thru ?? 0) : 18,
        status: roundStatus,
        teeTime: ls.teeTime ?? null,
        startPosition: ls.startPosition ?? null,
        currentPosition: ls.currentPosition ?? null,
      });
    }

    // ESPN appears to stop emitting a linescore entry entirely for
    // future rounds once a player is cut/withdrawn, rather than
    // including one with a "Cut"/"Withdrawn" status - so there may be
    // no row above that actually carries overallStatus. Without an
    // explicit marker, that player's tournament_players row never
    // gets deactivated (nothing for writeScoresToDb to key off of).
    // If their last emitted round is behind the tournament's current
    // round, push one synthetic row for the round they're missing,
    // carrying the cut/withdrawn status - this never overwrites a
    // real played round, since it only fires for a round number
    // strictly after anything they actually have a score for.
    if (overallStatus === "missed_cut" || overallStatus === "withdrawn") {
      const maxRowRound = linescores.reduce((max: number, ls: any) => Math.max(max, Number(ls.period) || 0), 0);
      const currentRound = competition?.status?.period ?? maxRowRound + 1;
      if (currentRound > maxRowRound) {
        players.push({
          espnPlayerId,
          fullName,
          proTeamName: null,
          roundNumber: currentRound,
          scoreToPar: null,
          thru: 0,
          status: overallStatus,
          teeTime: null,
          startPosition: null,
          currentPosition: null,
        });
      }
    }
  }

  return {
    espnEventId: String(event.id ?? ""),
    eventName: event.name ?? "LIV Golf Event",
    currentRound: competition?.status?.period ?? 1,
    eventCompleted,
    players,
  };
}

/**
 * Parses ESPN's round-level displayValue into a numeric score-to-par.
 * Handles "E" (even par -> 0), "-4", "+2", and "-" (round not played,
 * e.g. after a withdrawal) which correctly returns null rather than 0
 * - treating an unplayed round as "even par" would be wrong.
 */
function parseScoreToPar(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (v === "-" || v === "") return null;
  if (v === "E") return 0;
  const n = Number(v.replace("+", ""));
  return Number.isNaN(n) ? null : n;
}

/**
 * One-off diagnostic to run manually:
 *   npx tsx src/adapters/espnGolf.ts [espnEventId]
 * Defaults to LIV Golf Andalucia 2026 (401809165), the completed event
 * this adapter was verified against, if no id is passed.
 */
if (require.main === module) {
  const testEventId = process.argv[2] || "401809165";
  getLeaderboard(testEventId)
    .then((board) => {
      console.log(JSON.stringify(board, null, 2));
      console.log(`\n${board.players.length} player-round rows for "${board.eventName}".`);
    })
    .catch((err) => {
      console.error("ESPN adapter check failed:", err.message);
    });
}
