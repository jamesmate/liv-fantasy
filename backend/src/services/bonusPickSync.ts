import { query } from "../db/client";

export interface BonusCategory {
  key: string;
  label: string;
  description: string;
}

export const BONUS_CATEGORIES: BonusCategory[] = [
  { key: "EAGLE", label: "Eagle Hunter", description: "+40 points for every eagle (or better) scored this round." },
  { key: "BIRDIE", label: "Birdie Machine", description: "+4 points for every birdie scored this round." },
  { key: "BOGEY", label: "Bogey Boy", description: "+5 points for every bogey scored this round." },
  {
    key: "DOUBLE_PLUS",
    label: "Cody Brown",
    description: "+10 points for every double bogey (or worse) scored this round.",
  },
  {
    key: "POSITIONS_GAINED",
    label: "Climber",
    description: "+0.5 points (rounded) for every leaderboard position gained this round (relative to where they started the round).",
  },
  {
    key: "POSITIONS_LOST",
    label: "Bottler",
    description: "+0.5 points (rounded) for every leaderboard position lost this round (relative to where they started the round).",
  },
];

const POSITION_CATEGORIES = new Set(["POSITIONS_GAINED", "POSITIONS_LOST"]);
const HOLE_CATEGORIES = new Set(["EAGLE", "BIRDIE", "BOGEY", "DOUBLE_PLUS"]);
const PER_OCCURRENCE: Record<string, number> = { EAGLE: 40, BIRDIE: 4, BOGEY: 5, DOUBLE_PLUS: 10 };

export function pickRandomCategory(): string {
  return BONUS_CATEGORIES[Math.floor(Math.random() * BONUS_CATEGORIES.length)].key;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Space out consecutive scorecard-page fetches so this stays a
// reasonable citizen of ESPN's public site, even though (unlike the
// blocked API endpoint) there's no confirmed rate-limit issue here.
const REQUEST_DELAY_MS = 1500;

interface ScrapedHoleScore {
  number: number; // hole number
  mod: string; // "PAR" | "BIRDIE" | "BOGEY" | "DOUBLE_BOGEY" | "EAGLE" | etc
  par: number;
  val: string; // strokes, as a STRING in this embedded data (e.g. "4")
}

interface ScrapedRound {
  number: number; // round number
  scores?: ScrapedHoleScore[];
}

/**
 * Recursively searches a parsed object for a "rnds" array containing
 * round/hole data - deliberately not hardcoding the exact path from
 * root (e.g. `page.content.player.rnds`), since ESPN's embedded blob
 * structure isn't something we control or have full visibility into,
 * and a structural change elsewhere in the object shouldn't silently
 * break this as long as the "rnds" key itself still exists somewhere.
 */
function findRoundsArray(obj: unknown, depth = 0): ScrapedRound[] | null {
  if (depth > 15 || obj === null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findRoundsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;
  if (Array.isArray(record.rnds) && record.rnds.length > 0 && typeof record.rnds[0] === "object") {
    const candidate = record.rnds as ScrapedRound[];
    if (candidate[0] && "scores" in (candidate[0] as object)) return candidate;
  }
  for (const key of Object.keys(record)) {
    const found = findRoundsArray(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Extracts the `window['__espnfitt__'] = {...}` (ESPN's site-wide
 * client hydration data blob - "fitt" is their frontend framework,
 * visible in the script filenames this page loads) JSON from a raw
 * HTML page, using proper brace-matching rather than a regex, since
 * the object is deeply nested and a regex can't reliably find the
 * correct closing brace.
 */
function extractEmbeddedJson(html: string): unknown | null {
  const markers = ["window['__espnfitt__']=", 'window["__espnfitt__"]=', "window.__espnfitt__="];
  let startIdx = -1;
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx !== -1) {
      startIdx = idx + marker.length;
      break;
    }
  }
  if (startIdx === -1) return null;

  const braceStart = html.indexOf("{", startIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const jsonStr = html.slice(braceStart, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Scrapes one player's hole-by-hole scorecard from ESPN's public
 * scorecard page - used instead of the site.web.api.espn.com
 * competitorsummary endpoint, which was confirmed (via side-by-side
 * testing) to serve stripped/empty data specifically to this server,
 * even with realistic browser headers and request pacing added. The
 * public page doesn't appear to have the same restriction - likely
 * because it needs to stay freely crawlable for Google/social preview
 * purposes, unlike a "private" API subdomain.
 */
async function fetchScorecardFromPublicPage(
  espnEventId: string,
  espnPlayerId: string
): Promise<ScrapedRound[] | null> {
  const url = `https://www.espn.com/golf/player/scorecards/_/id/${espnPlayerId}/tournamentid/${espnEventId}`;
  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`scorecard page fetch failed (${res.status}) for player ${espnPlayerId}`);
  }
  const html = await res.text();
  console.log(
    `[bonusPickSync] scorecard page for ${espnPlayerId}: ${html.length} bytes, contains __espnfitt__=${html.includes(
      "__espnfitt__"
    )}, contains 'rnds'=${html.includes('"rnds"')}, contains 'DOUBLE_BOGEY'=${html.includes("DOUBLE_BOGEY")}`
  );
  const data = extractEmbeddedJson(html);
  if (!data) {
    console.log(`[bonusPickSync] extractEmbeddedJson returned null for player ${espnPlayerId}`);
    return null;
  }
  const rounds = findRoundsArray(data);
  console.log(
    `[bonusPickSync] findRoundsArray for player ${espnPlayerId}: ${rounds ? `found ${rounds.length} round(s), numbers=${JSON.stringify(rounds.map((r) => r.number))}` : "returned null"}`
  );
  return rounds;
}

function calculateHolePointsFromScrape(
  category: string,
  scores: ScrapedHoleScore[] | undefined
): { points: number; breakdown: Record<string, number> } {
  let count = 0;
  for (const hole of scores ?? []) {
    const diff = Number(hole.val) - hole.par;
    if (category === "EAGLE" && diff <= -2) count++;
    else if (category === "BIRDIE" && diff === -1) count++;
    else if (category === "BOGEY" && diff === 1) count++;
    else if (category === "DOUBLE_PLUS" && diff >= 2) count++;
  }
  return { points: count * (PER_OCCURRENCE[category] ?? 0), breakdown: { count } };
}

/**
 * Syncs live bonus points for every bonus pick made on a given round.
 *
 * Deliberately does NOTHING for a round that hasn't actually started
 * yet (no player_round_scores rows with a real score for it) - only
 * the CURRENT live round should ever show non-zero bonus activity,
 * not future rounds sitting at a stale/misleading zero.
 */
export async function syncBonusPicksForRound(roundId: string): Promise<void> {
  const roundResult = await query<{
    round_number: number;
    bonus_category: string | null;
    tournament_id: string;
    espn_event_id: string | null;
    espn_league_slug: string;
  }>(
    `select r.round_number, r.bonus_category, r.tournament_id, t.espn_event_id, t.espn_league_slug
       from rounds r
       join tournaments t on t.id = r.tournament_id
      where r.id = $1`,
    [roundId]
  );
  const round = roundResult.rows[0];
  if (!round || !round.bonus_category || !round.espn_event_id) return;

  // Has this round actually started for ANYONE yet? If not, there's
  // nothing meaningful to sync - skip entirely rather than computing
  // (and storing) a round of zeroes for a round that hasn't teed off.
  const startedCheck = await query<{ count: string }>(
    `select count(*) from player_round_scores where round_id = $1 and score_to_par is not null`,
    [roundId]
  );
  if (Number(startedCheck.rows[0].count) === 0) return;

  const picksResult = await query<{ id: string; tournament_player_id: string; espn_player_id: string | null }>(
    `select bp.id, bp.tournament_player_id, tp.espn_player_id
       from bonus_picks bp
       join tournament_players tp on tp.id = bp.tournament_player_id
      where bp.round_id = $1 and bp.manually_overridden = false`,
    [roundId]
  );
  if (picksResult.rows.length === 0) return;

  console.log(
    `[bonusPickSync] round ${roundId} (round ${round.round_number}, category ${round.bonus_category}): found ${picksResult.rows.length} bonus pick(s)`
  );

  if (POSITION_CATEGORIES.has(round.bonus_category)) {
    // Sourced entirely from player_round_scores (populated by the
    // main, reliably-working leaderboard sync) - no ESPN call needed
    // here at all.
    for (const pick of picksResult.rows) {
      const posResult = await query<{ start_position: number | null; current_position: number | null }>(
        `select start_position, current_position from player_round_scores where round_id = $1 and tournament_player_id = $2`,
        [roundId, pick.tournament_player_id]
      );
      const row = posResult.rows[0];
      let points = 0;
      if (row && row.start_position !== null && row.current_position !== null) {
        const gained = Math.max(0, row.start_position - row.current_position);
        const lost = Math.max(0, row.current_position - row.start_position);
        const positions = round.bonus_category === "POSITIONS_GAINED" ? gained : lost;
        points = Math.round(positions * 0.5);
      }
      console.log(
        `[bonusPickSync] player ${pick.tournament_player_id} round ${round.round_number} (${round.bonus_category}): rowFound=${!!row} startPosition=${row?.start_position ?? "null"} currentPosition=${row?.current_position ?? "null"} -> ${points}pts`
      );
      await query(`update bonus_picks set points = $1, breakdown = $2, last_synced_at = now() where id = $3`, [
        points,
        JSON.stringify({ startPosition: row?.start_position ?? null, currentPosition: row?.current_position ?? null }),
        pick.id,
      ]);
    }
    return;
  }

  if (!HOLE_CATEGORIES.has(round.bonus_category)) return;

  // Dedupe - if multiple members bonus-picked the same player this
  // round, only fetch ESPN once for that player.
  const byPlayer = new Map<string, { id: string; espn_player_id: string }[]>();
  for (const p of picksResult.rows) {
    if (!p.espn_player_id) continue;
    const list = byPlayer.get(p.espn_player_id) ?? [];
    list.push({ id: p.id, espn_player_id: p.espn_player_id });
    byPlayer.set(p.espn_player_id, list);
  }

  let first = true;
  for (const [espnPlayerId, bonusPickRows] of byPlayer) {
    if (!first) await sleep(REQUEST_DELAY_MS); // be a reasonable citizen even on the public page
    first = false;
    try {
      const rounds = await fetchScorecardFromPublicPage(round.espn_event_id, espnPlayerId);
      const roundData = rounds?.find((r) => r.number === round.round_number);
      const { points, breakdown } = calculateHolePointsFromScrape(round.bonus_category, roundData?.scores);
      console.log(
        `[bonusPickSync] player ${espnPlayerId} round ${round.round_number}: holesFound=${roundData?.scores?.length ?? 0} -> ${points}pts`
      );
      for (const pick of bonusPickRows) {
        await query(`update bonus_picks set points = $1, breakdown = $2, last_synced_at = now() where id = $3`, [
          points,
          JSON.stringify(breakdown),
          pick.id,
        ]);
      }
    } catch (err) {
      console.error(`[bonusPickSync] failed for player ${espnPlayerId} on round ${roundId}:`, err);
    }
  }
}
