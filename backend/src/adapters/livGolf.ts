/**
 * LIV Golf Website Adapter
 * -------------------------
 * Scrapes player scores from livgolf.com's leaderboard page since
 * ESPN does NOT provide live scoring data for LIV events - their feed
 * stays on "STATUS_SCHEDULED" throughout the whole tournament, even
 * after play has finished. LIV's own site publishes live data first
 * and is the authoritative source.
 *
 * URL pattern (confirmed against multiple real events):
 *   https://www.livgolf.com/leaderboard/2026/{event-slug}
 *
 * The page is server-side rendered HTML - player names, scores, hole
 * "thru" values, and withdrawn/reserve status are all embedded
 * directly in the page text. No JavaScript execution required.
 *
 * Data format extracted from the page text pattern:
 *   "L. Herbert\n...\nRipper GC\n1-11———-11-11"
 *   Position, short name, thru (hole number), R1, R2, R3, R4, total
 *
 * The page is matched against our existing tournament_players rows
 * by LAST NAME ONLY (since livgolf.com only shows shortened names
 * like "L. Herbert", not full names). This is the same approach
 * confirmed reliable from scraping the Andalucia event previously.
 *
 * Important: this adapter is ONLY invoked for tournaments tagged
 * tour='LIV' in the tournaments table. PGA/DP World events continue
 * to use the ESPN adapter (espnGolf.ts), which works reliably for
 * those.
 */

import { NormalizedLeaderboard, NormalizedPlayerRound } from "./espnGolf";

export interface LivScoreRow {
  shortName: string; // e.g. "L. Herbert"
  thru: number;      // 0-18
  rounds: (number | null)[]; // index 0=R1...3=R4, null if not played
  status: "in_progress" | "completed" | "withdrawn";
}

/**
 * Parses a score string like "-11", "+3", "E" into a numeric value.
 * Returns null for dashes (round not played), blanks, or unrecognised values.
 */
function parseScore(raw: string): number | null {
  const s = raw.trim();
  if (!s || s === "-" || s === "—" || s === "———") return null;
  if (s === "E") return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

/**
 * Scrapes live/final scores for all players from livgolf.com's
 * leaderboard page for a given event slug (e.g. "uk", "andalucia-2026").
 * Returns one row per player in the field, plus withdrawn/reserve
 * entries with status "withdrawn".
 */
export async function getLivLeaderboard(
  eventSlug: string,
  season: number = 2026
): Promise<LivScoreRow[]> {
  const url = `https://www.livgolf.com/leaderboard/${season}/${eventSlug}`;
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`livgolf.com fetch failed (${res.status}) for slug ${eventSlug}`);
  }
  const html = await res.text();
  return parseLivLeaderboardHtml(html);
}

/**
 * Parses the raw HTML from livgolf.com's leaderboard page.
 * The relevant data pattern for each player looks like:
 *
 *   P. LASTNAME\n...\nTeam Name\n{thru}-{R1}———{R2}{R3}{R4}-{tot}
 *
 * This regex finds player entries by looking for a hole number
 * followed by the score pattern for up to 4 rounds.
 */
export function parseLivLeaderboardHtml(html: string): LivScoreRow[] {
  const results: LivScoreRow[] = [];

  // The score line pattern: a hole number (1-18 or "F" for finished)
  // followed by round scores. On livgolf.com this renders as text like:
  // "1-11———-11-11" for a round 1 only entry, holes thru = 1, R1=-11
  // "F-11———-11-11" for a completed round
  // We extract player rows by scanning for the shortName + score block.

  // Extract the main player table section (between main leaderboard
  // and Withdrawn section)
  const mainSection = html.split("Withdrawn")[0] ?? html;
  const withdrawnSection = html.split("Withdrawn &amp; Reserves")[1] ?? "";

  // Pattern: short name line followed eventually by thru-score pattern
  // We look for "F. Lastname" style names then find the adjacent score
  const nameScoreRegex =
    /([A-Z]\.\s[A-Za-zÁÉÍÓÚÜÑáéíóúüñ''\-]+(?:\s[A-Z]{1,3}\.?)?(?:\s[A-Za-z]+)?)\n[\s\S]{0,300}?\n(\d+|F|WD)([-+E\d—\-]+)/g;

  // Simpler approach: find each row from structured text blocks
  // The page text for each player looks like:
  // "{pos}\n{name}\n{team}\n{hole}{R1}———{R2}{R3}{R4}{tot}"
  // We parse by finding lines that match the score pattern directly

  const lines = html
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "\n")  // strip HTML tags
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Scan for lines that look like: "1-11———-11-11" or "F-8———-8-8"
  // which are the score summary lines on livgolf.com's leaderboard
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Score summary line: starts with hole number (1-18) or "F"
    // followed by round scores. Pattern: digit(s) or F, then +/-/E/digit
    const scoreMatch = line.match(
      /^(\d{1,2}|F)\s*([-+]?\d+|E)\s*(?:—+)?\s*([-+]?\d+|E)?\s*(?:—+)?\s*([-+]?\d+|E)?\s*(?:—+)?\s*([-+]?\d+|E)?\s*(?:—+)?\s*([-+]?\d+|E)?/
    );
    if (!scoreMatch) continue;

    const thruRaw = scoreMatch[1];
    const thru = thruRaw === "F" ? 18 : parseInt(thruRaw, 10);

    // Round scores: positions 2,3,4,5 = R1,R2,R3,R4 (scoreMatch[6] is total, we skip it)
    const r1 = parseScore(scoreMatch[2] ?? "");
    const r2 = parseScore(scoreMatch[3] ?? "");
    const r3 = parseScore(scoreMatch[4] ?? "");
    const r4 = parseScore(scoreMatch[5] ?? "");

    // Find the player name in the preceding lines (look back up to 10 lines)
    let shortName: string | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      const candidate = lines[j];
      // Short name format: "F. Lastname" or "A. B. Lastname"
      if (/^[A-Z]\.\s[A-Za-z]/.test(candidate) && candidate.length < 40) {
        shortName = candidate;
        break;
      }
    }
    if (!shortName) continue;
    if (results.some((r) => r.shortName === shortName)) continue; // dedupe

    const status = thruRaw === "F" ? "completed" : "in_progress";

    results.push({
      shortName,
      thru,
      rounds: [r1, r2, r3, r4],
      status,
    });
  }

  // Parse withdrawn players from the Withdrawn & Reserves section
  const wdNameRegex = /([A-Z]\.\s[A-Za-z][A-Za-z\s'\-]{2,30})/g;
  let wdMatch;
  while ((wdMatch = wdNameRegex.exec(withdrawnSection)) !== null) {
    const shortName = wdMatch[1].trim();
    if (!results.some((r) => r.shortName === shortName)) {
      results.push({ shortName, thru: 0, rounds: [null, null, null, null], status: "withdrawn" });
    }
  }

  return results;
}

/**
 * Converts a livgolf.com player name like "L. Herbert" to just the
 * surname "Herbert" for fuzzy-matching against full names in our DB.
 */
export function livShortNameToSurname(shortName: string): string {
  const parts = shortName.split(" ");
  // Drop the initial (e.g. "L.") and any middle initials
  const surname = parts.filter((p) => !/^[A-Z]\.$/.test(p)).join(" ");
  return surname.trim();
}

/**
 * Converts a LivScoreRow into the NormalizedPlayerRound shape the
 * rest of the sync pipeline expects (same shape as espnGolf.ts output).
 * espnPlayerId and fullName must be provided by the caller from DB lookups.
 */
export function livRowToNormalizedRounds(
  row: LivScoreRow,
  espnPlayerId: string,
  fullName: string
): NormalizedPlayerRound[] {
  const result: NormalizedPlayerRound[] = [];

  for (let roundIdx = 0; roundIdx < row.rounds.length; roundIdx++) {
    const roundNumber = roundIdx + 1;
    const scoreToPar = row.rounds[roundIdx];

    // Skip rounds that haven't been played at all (null score, round > current)
    if (scoreToPar === null && row.status !== "withdrawn") continue;

    const isCurrentRound = scoreToPar !== null && row.rounds.slice(roundIdx + 1).every((s) => s === null);
    const thru = isCurrentRound ? row.thru : scoreToPar !== null ? 18 : 0;
    const status: NormalizedPlayerRound["status"] =
      row.status === "withdrawn"
        ? "withdrawn"
        : isCurrentRound && thru < 18
        ? "in_progress"
        : scoreToPar !== null
        ? "completed"
        : "not_started";

    result.push({
      espnPlayerId,
      fullName,
      proTeamName: null,
      roundNumber,
      scoreToPar: scoreToPar ?? null,
      thru,
      teeTime: null,
      status,
      startPosition: null,
      currentPosition: null,
    });
  }

  return result;
}

/**
 * Top-level function: fetches and normalizes the full LIV leaderboard
 * for a given event slug into the NormalizedLeaderboard shape,
 * cross-referencing names against a map of surname → ESPN player ID
 * provided by the caller (built from tournament_players in the DB).
 */
export async function getLivNormalizedLeaderboard(
  eventSlug: string,
  surnameToPlayer: Map<string, { espnPlayerId: string; fullName: string }>,
  season: number = 2026
): Promise<NormalizedLeaderboard> {
  const rows = await getLivLeaderboard(eventSlug, season);
  const players: NormalizedPlayerRound[] = [];

  for (const row of rows) {
    const surname = livShortNameToSurname(row.shortName);
    const player = surnameToPlayer.get(surname.toLowerCase());
    if (!player) {
      console.log(`[livAdapter] no player match for "${row.shortName}" (surname: "${surname}")`);
      continue;
    }
    const normalized = livRowToNormalizedRounds(row, player.espnPlayerId, player.fullName);
    players.push(...normalized);
  }

  return {
    espnEventId: eventSlug,
    eventName: `LIV Golf ${eventSlug}`,
    currentRound: Math.max(1, ...rows.flatMap((r) => r.rounds.map((s, i) => (s !== null ? i + 1 : 0)))),
    eventCompleted: rows.length > 0 && rows.every((r) => r.status === "completed" || r.status === "withdrawn"),
    players,
  };
}
