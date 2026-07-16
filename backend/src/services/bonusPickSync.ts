import { query } from "../db/client";

export interface BonusCategory {
  key: string;
  label: string;
  description: string;
}

export const BONUS_CATEGORIES: BonusCategory[] = [
  { key: "EAGLE", label: "Eagle Hunter", description: "+25 points for every eagle (or better) scored today." },
  { key: "BIRDIE", label: "Birdie Machine", description: "+4 points for every birdie scored today." },
  { key: "BOGEY", label: "Bogey Boy", description: "+5 points for every bogey scored today." },
  {
    key: "DOUBLE_PLUS",
    label: "Bogey Monster",
    description: "+10 points for every double bogey (or worse) scored today.",
  },
  {
    key: "POSITIONS_GAINED",
    label: "Climber",
    description: "+1 point for every leaderboard position gained today (relative to where they started the round).",
  },
  {
    key: "POSITIONS_LOST",
    label: "Bottler",
    description: "+1 point for every leaderboard position lost today (relative to where they started the round).",
  },
];

const POSITION_CATEGORIES = new Set(["POSITIONS_GAINED", "POSITIONS_LOST"]);
const HOLE_CATEGORIES = new Set(["EAGLE", "BIRDIE", "BOGEY", "DOUBLE_PLUS"]);
const PER_OCCURRENCE: Record<string, number> = { EAGLE: 25, BIRDIE: 4, BOGEY: 5, DOUBLE_PLUS: 10 };

export function pickRandomCategory(): string {
  return BONUS_CATEGORIES[Math.floor(Math.random() * BONUS_CATEGORIES.length)].key;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface EspnLinescore {
  value: number;
  period: number;
  par: number;
}

interface EspnCompetitorRound {
  period: number;
  linescores?: EspnLinescore[];
}

interface EspnCompetitorSummary {
  rounds?: EspnCompetitorRound[];
}

/**
 * Pulls one player's hole-by-hole scores from ESPN, for the HOLE-BASED
 * categories only (Eagle/Birdie/Bogey/Bogey Monster) - Positions
 * Gained/Lost no longer uses this endpoint at all, see below.
 *
 * This endpoint has proven unreliable from this server specifically:
 * confirmed via side-by-side testing that an identical request for a
 * player with a confirmed double bogey returned full data from a
 * normal machine but an empty rounds array from here, even after
 * adding full browser-style headers. The leading remaining theory is
 * ESPN's CDN rate-limiting/throttling rapid same-endpoint requests
 * from a single source - ADD_DELAY_MS below spaces consecutive calls
 * out to test that. If hole-based categories are still unreliable
 * even with this, treat that as evidence it's an IP-level block
 * rather than a burst/rate issue, which would need a different
 * approach entirely (e.g. routing through a residential proxy).
 */
const REQUEST_DELAY_MS = 2000;

async function fetchCompetitorSummary(
  leagueSlug: string,
  espnEventId: string,
  espnPlayerId: string
): Promise<EspnCompetitorSummary | null> {
  const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/${leagueSlug}/leaderboard/${espnEventId}/competitorsummary/${espnPlayerId}?region=us&lang=en`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      origin: "https://www.espn.com",
      referer: "https://www.espn.com/",
    },
  });
  if (!res.ok) {
    throw new Error(`competitorsummary fetch failed (${res.status}) for player ${espnPlayerId}`);
  }
  const data = (await res.json()) as { competitor?: EspnCompetitorSummary };
  return data.competitor ?? null;
}

function calculateHolePoints(
  category: string,
  roundData: EspnCompetitorRound | undefined
): { points: number; breakdown: Record<string, number> } {
  const holes = roundData?.linescores ?? [];
  let count = 0;
  for (const hole of holes) {
    const diff = hole.value - hole.par;
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
      where bp.round_id = $1`,
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
        points = round.bonus_category === "POSITIONS_GAINED" ? gained : lost;
      }
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
    if (!first) await sleep(REQUEST_DELAY_MS); // space out requests - see REQUEST_DELAY_MS comment above
    first = false;
    try {
      const summary = await fetchCompetitorSummary(round.espn_league_slug, round.espn_event_id, espnPlayerId);
      const roundData = summary?.rounds?.find((r) => r.period === round.round_number);
      const { points, breakdown } = calculateHolePoints(round.bonus_category, roundData);
      console.log(
        `[bonusPickSync] player ${espnPlayerId} round ${round.round_number}: holesFound=${roundData?.linescores?.length ?? 0} -> ${points}pts`
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
