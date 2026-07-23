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
  // The "Hole" column from the leaderboard. CONFIRMED semantics from
  // watching a real live round: during play this is the hole the
  // player is currently ON (not holes completed - shotgun starts mean
  // those differ); between rounds it shows their NEXT round's starting
  // hole; "F" means they have finished the current round.
  holeToken: string;
  rounds: (number | null)[]; // index 0=R1...3=R4, null if not played
  currentRoundScore: number | null; // the second-to-last column
  total: number | null; // the last column
  withdrawn: boolean;
}

export interface LivLeaderboardParse {
  rows: LivScoreRow[];
  // Which round the page considers current (from the round banner,
  // e.g. "Round 2 Jul 24, 12:15 PM UTC" -> 2). Rounds BEFORE this are
  // definitively complete.
  currentRound: number;
  // True when the banner says "Round N has now finished" (only shown
  // once the whole event is over).
  currentRoundFinished: boolean;
}

function parseScoreToken(raw: string): number | null {
  const s = raw.trim();
  if (!s || s === "-" || s === "—") return null;
  if (s === "E") return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

/**
 * Scrapes live/final scores for all players from livgolf.com's
 * leaderboard page for a given event slug (e.g. "uk", "andalucia-2026").
 */
export async function getLivLeaderboard(
  eventSlug: string,
  season: number = 2026
): Promise<LivLeaderboardParse> {
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
 * Parses the leaderboard page. Each player's score summary renders
 * (after tag-stripping) as a single line with SEVEN columns run
 * together, matching the on-page table header
 * "Hole | Round 1 | Round 2 | Round 3 | Round 4 | R{n} | Tot":
 *
 *   {Hole}{R1}{R2}{R3}{R4}{currentRound}{Total}
 *
 * where unplayed rounds are em-dashes. Real examples (from the live
 * UK 2026 event):
 *   "1-11———-11-11"   -> hole 1 (next-round start), R1=-11, tot=-11
 *   "15+1———+1+1"     -> hole 15, R1=+1, tot=+1
 *   "F-4-2-4-1-1-11"  -> finished, R1..R4 = -4,-2,-4,-1, tot=-11
 *
 * IMPORTANT (learned the hard way from a real live round): the last
 * TWO values are current-round-score and total, NOT round scores -
 * naively reading all values as rounds double-counts and corrupts
 * totals mid-event.
 */
export function parseLivLeaderboardHtml(html: string): LivLeaderboardParse {
  const cleaned = html.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");

  // Round state banner - authoritative signal for which rounds are
  // definitively complete.
  let currentRound = 1;
  let currentRoundFinished = false;
  const finishedMatch = cleaned.match(/Round\s*(\d)\s*has now finished/i);
  if (finishedMatch) {
    currentRound = parseInt(finishedMatch[1], 10);
    currentRoundFinished = true;
  } else {
    const bannerMatch = cleaned.match(/Round\s*(\d)/);
    if (bannerMatch) currentRound = parseInt(bannerMatch[1], 10);
  }

  const withdrawnSection = cleaned.split(/Withdrawn\s*&\s*Reserves/)[1] ?? "";

  const lines = cleaned
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: LivScoreRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A score summary line: hole token (1-18 or F) followed by a run
    // of score tokens ("+1", "-11", "E") and em-dashes.
    const m = line.match(/^(\d{1,2}|F)((?:[-+]\d{1,2}|E|—)+)$/);
    if (!m) continue;

    const holeToken = m[1];
    const valueTokens = m[2].match(/[-+]\d{1,2}|E|—/g) ?? [];
    // Exactly 6 value slots: R1, R2, R3, R4, current-round, total.
    if (valueTokens.length !== 6) continue;

    // Find the player's short name in the preceding lines.
    let shortName: string | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      const candidate = lines[j];
      if (/^[A-Z]\.\s?[A-Za-z]/.test(candidate) && candidate.length < 40) {
        shortName = candidate;
        break;
      }
    }
    if (!shortName) continue;
    if (rows.some((r) => r.shortName === shortName)) continue;

    rows.push({
      shortName,
      holeToken,
      rounds: valueTokens.slice(0, 4).map(parseScoreToken),
      currentRoundScore: parseScoreToken(valueTokens[4]),
      total: parseScoreToken(valueTokens[5]),
      withdrawn: false,
    });
  }

  // Withdrawn players
  const wdNameRegex = /([A-Z]\.\s[A-Za-z][A-Za-z\s'\-]{2,30})/g;
  let wdMatch;
  while ((wdMatch = wdNameRegex.exec(withdrawnSection)) !== null) {
    const shortName = wdMatch[1].trim();
    if (!rows.some((r) => r.shortName === shortName)) {
      rows.push({
        shortName,
        holeToken: "0",
        rounds: [null, null, null, null],
        currentRoundScore: null,
        total: null,
        withdrawn: true,
      });
    }
  }

  return { rows, currentRound, currentRoundFinished };
}

/**
 * Converts a livgolf.com player name like "L. Herbert" to just the
 * surname "Herbert" for fuzzy-matching against full names in our DB.
 */
export function livShortNameToSurname(shortName: string): string {
  const parts = shortName.split(" ");
  const surname = parts.filter((p) => !/^[A-Z]\.$/.test(p)).join(" ");
  return surname.trim();
}

/**
 * Converts a LivScoreRow into NormalizedPlayerRound entries.
 *
 * Round status logic uses the page's round banner as ground truth:
 * - rounds before `currentRound` are definitively completed (thru 18)
 * - the current round is completed if the event is over
 *   (`currentRoundFinished`) or this player's hole token is "F";
 *   otherwise it's in progress, with `thru` approximated by the hole
 *   they're currently on (exact holes-completed isn't derivable from
 *   the leaderboard under shotgun starts - it self-corrects to 18 at
 *   round end).
 */
export function livRowToNormalizedRounds(
  row: LivScoreRow,
  espnPlayerId: string,
  fullName: string,
  currentRound: number,
  currentRoundFinished: boolean
): NormalizedPlayerRound[] {
  const result: NormalizedPlayerRound[] = [];

  for (let roundIdx = 0; roundIdx < row.rounds.length; roundIdx++) {
    const roundNumber = roundIdx + 1;
    const scoreToPar = row.rounds[roundIdx];
    if (scoreToPar === null) continue;

    const isCompleted =
      roundNumber < currentRound ||
      currentRoundFinished ||
      (roundNumber === currentRound && row.holeToken === "F");

    const thru = isCompleted
      ? 18
      : /^\d+$/.test(row.holeToken)
      ? Math.min(18, Math.max(1, parseInt(row.holeToken, 10)))
      : 0;

    result.push({
      espnPlayerId,
      fullName,
      proTeamName: null,
      roundNumber,
      scoreToPar,
      thru,
      teeTime: null,
      status: row.withdrawn ? "withdrawn" : isCompleted ? "completed" : "in_progress",
      startPosition: null,
      currentPosition: null,
    });
  }

  if (result.length === 0 && row.withdrawn) {
    result.push({
      espnPlayerId,
      fullName,
      proTeamName: null,
      roundNumber: 1,
      scoreToPar: null,
      thru: 0,
      teeTime: null,
      status: "withdrawn",
      startPosition: null,
      currentPosition: null,
    });
  }

  return result;
}

/**
 * Top-level: fetches + normalizes the full LIV leaderboard for an
 * event slug, matching players by surname against the provided map
 * (built from tournament_players in the DB).
 */
export async function getLivNormalizedLeaderboard(
  eventSlug: string,
  surnameToPlayer: Map<string, { espnPlayerId: string; fullName: string }>,
  season: number = 2026
): Promise<NormalizedLeaderboard> {
  const parse = await getLivLeaderboard(eventSlug, season);
  const players: NormalizedPlayerRound[] = [];

  for (const row of parse.rows) {
    const surname = livShortNameToSurname(row.shortName);
    const player = surnameToPlayer.get(surname.toLowerCase());
    if (!player) {
      console.log(`[livAdapter] no player match for "${row.shortName}" (surname: "${surname}")`);
      continue;
    }
    players.push(
      ...livRowToNormalizedRounds(row, player.espnPlayerId, player.fullName, parse.currentRound, parse.currentRoundFinished)
    );
  }

  return {
    espnEventId: eventSlug,
    eventName: `LIV Golf ${eventSlug}`,
    currentRound: parse.currentRound,
    eventCompleted: parse.currentRoundFinished && parse.currentRound >= 4,
    players,
  };
}


/* ------------------------------------------------------------------ */
/* Hole-by-hole scorecards                                             */
/* ------------------------------------------------------------------ */

/**
 * livgolf.com serves per-player scorecard pages that are fully
 * server-rendered (confirmed by fetching a real one during the UK 2026
 * event - Bryson DeChambeau's page contained all 18 pars and all 18
 * hole scores as plain text with no JavaScript needed):
 *
 *   https://www.livgolf.com/leaderboard/{season}/{eventSlug}/player/{playerSlug}
 *
 * The stripped page text contains, in order:
 *   - round summary rows (R1..R4 with strokes + to-par, "-" if unplayed)
 *   - hole numbers 1..18 as consecutive lines
 *   - 18 par values
 *   - 18 hole scores per PLAYED round, in round order (R1 first)
 *
 * This parser anchors on the "1..18 consecutive lines" hole-number
 * sequence, takes the next 18 numbers as pars, then chunks everything
 * numeric after that into groups of 18 as per-round hole scores.
 */

export interface LivHoleScore {
  hole: number;
  par: number;
  score: number;
}

export interface LivScorecardRound {
  roundNumber: number;
  holes: LivHoleScore[];
}

/**
 * Converts a player's full name into livgolf.com's URL slug format:
 * lowercase, accents stripped, non-alphanumerics collapsed to hyphens.
 * e.g. "Joaquín Niemann" -> "joaquin-niemann",
 *      "Richard T. Lee"  -> "richard-t-lee"
 */
export function playerNameToLivSlug(fullName: string): string {
  return fullName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function getLivPlayerScorecard(
  eventSlug: string,
  playerSlug: string,
  season: number = 2026
): Promise<LivScorecardRound[]> {
  const url = `https://www.livgolf.com/leaderboard/${season}/${eventSlug}/player/${playerSlug}`;
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`livgolf.com scorecard fetch failed (${res.status}) for ${playerSlug} @ ${eventSlug}`);
  }
  const html = await res.text();
  return parseLivScorecardHtml(html);
}

export function parseLivScorecardHtml(html: string): LivScorecardRound[] {
  const lines = html
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Find the anchor: 18 consecutive lines that are exactly "1".."18".
  let holeStart = -1;
  for (let i = 0; i + 18 <= lines.length; i++) {
    let ok = true;
    for (let h = 0; h < 18; h++) {
      if (lines[i + h] !== String(h + 1)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      holeStart = i;
      break;
    }
  }
  if (holeStart === -1) return [];

  // Everything after the hole numbers: numeric lines are pars then
  // round scores; "-" or non-numeric lines end a partial round /
  // are skipped. The legend words ("Eagle or Better" etc.) terminate
  // the numeric run naturally since they're not numeric.
  const numbersAfter: number[] = [];
  for (let i = holeStart + 18; i < lines.length; i++) {
    const line = lines[i];
    if (/^\d{1,2}$/.test(line)) {
      numbersAfter.push(parseInt(line, 10));
    } else if (numbersAfter.length >= 18) {
      // Stop at the first non-number once we have at least pars -
      // anything after the numeric run is legend/footer text.
      break;
    }
  }

  if (numbersAfter.length < 18) return [];

  const pars = numbersAfter.slice(0, 18);
  const scoreNumbers = numbersAfter.slice(18);

  const rounds: LivScorecardRound[] = [];
  for (let r = 0; r * 18 < scoreNumbers.length; r++) {
    const chunk = scoreNumbers.slice(r * 18, r * 18 + 18);
    const holes: LivHoleScore[] = chunk.map((score, idx) => ({
      hole: idx + 1,
      par: pars[idx],
      score,
    }));
    rounds.push({ roundNumber: r + 1, holes });
  }
  return rounds;
}
