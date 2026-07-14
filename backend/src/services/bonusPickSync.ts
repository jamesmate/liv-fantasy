import { query } from "../db/client";

export interface BonusCategory {
  key: string;
  label: string;
  description: string;
}

/**
 * All six categories are deliberately LIVE-TICKING - points update
 * hole by hole (or position by position) as the round is played,
 * rather than only resolving at the end of the round. Categories that
 * can only be judged once a round is complete (bogey-free round,
 * lowest round of the day, etc) were considered and dropped
 * specifically because they'd leave the bonus pick showing zero all
 * day with no feedback until the round finished - the whole point of
 * this feature is watching the points climb in real time.
 */
export const BONUS_CATEGORIES: BonusCategory[] = [
  { key: "EAGLE", label: "Eagle Hunter", description: "+25 points for every eagle (or better) scored today." },
  { key: "BIRDIE", label: "Birdie Machine", description: "+4 points for every birdie scored today." },
  { key: "BOGEY", label: "Bogey Watch", description: "+5 points for every bogey scored today." },
  {
    key: "DOUBLE_PLUS",
    label: "Chaos Agent",
    description: "+10 points for every double bogey (or worse) scored today.",
  },
  {
    key: "POSITIONS_GAINED",
    label: "Climber",
    description: "+1 point for every leaderboard position gained today (relative to where they started the round).",
  },
  {
    key: "POSITIONS_LOST",
    label: "Freefall",
    description: "+1 point for every leaderboard position lost today (relative to where they started the round).",
  },
];

export function pickRandomCategory(): string {
  return BONUS_CATEGORIES[Math.floor(Math.random() * BONUS_CATEGORIES.length)].key;
}

interface EspnLinescore {
  value: number;
  period: number;
  par: number;
}

interface EspnCompetitorRound {
  period: number;
  startPosition?: number;
  currentPosition?: number;
  linescores?: EspnLinescore[];
}

interface EspnCompetitorSummary {
  rounds?: EspnCompetitorRound[];
}

/**
 * Pulls one player's full tournament summary (hole-by-hole scores,
 * per-round leaderboard position) from ESPN. This is a DIFFERENT
 * endpoint from the main leaderboard sync (site.web.api.espn.com/.../
 * leaderboard) - that one only has per-round TOTALS, no hole detail.
 * This one is per-athlete, which is exactly why bonus pick scoring
 * only ever calls it for players who were actually bonus-picked that
 * round (at most one per team), not the whole ~150-player field.
 */
async function fetchCompetitorSummary(
  leagueSlug: string,
  espnEventId: string,
  espnPlayerId: string
): Promise<EspnCompetitorSummary | null> {
  const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/${leagueSlug}/leaderboard/${espnEventId}/competitorsummary/${espnPlayerId}?region=us&lang=en`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`competitorsummary fetch failed (${res.status}) for player ${espnPlayerId}`);
  }
  const data = (await res.json()) as { competitor?: EspnCompetitorSummary };
  return data.competitor ?? null;
}

/**
 * Computes this player's bonus points for ONE round, given the
 * category assigned to that round. Reads strokes-vs-par directly
 * (rather than trusting ESPN's own scoreType.name string) so eagles,
 * albatrosses, etc all fall out of the same simple comparison instead
 * of needing to match every possible label ESPN might use.
 */
function calculateBonusPoints(
  category: string,
  roundData: EspnCompetitorRound | undefined
): { points: number; breakdown: Record<string, number> } {
  if (!roundData) return { points: 0, breakdown: {} };

  if (category === "POSITIONS_GAINED" || category === "POSITIONS_LOST") {
    const { startPosition, currentPosition } = roundData;
    // Round 1 (and any round with no prior day) has no meaningful
    // "start" position to compare against - degrade to 0 rather than
    // erroring or producing a nonsense number.
    if (startPosition === undefined || currentPosition === undefined) {
      return { points: 0, breakdown: {} };
    }
    const gained = Math.max(0, startPosition - currentPosition);
    const lost = Math.max(0, currentPosition - startPosition);
    const positions = category === "POSITIONS_GAINED" ? gained : lost;
    return { points: positions, breakdown: { positions } };
  }

  const holes = roundData.linescores ?? [];
  let count = 0;
  for (const hole of holes) {
    const diff = hole.value - hole.par;
    if (category === "EAGLE" && diff <= -2) count++;
    else if (category === "BIRDIE" && diff === -1) count++;
    else if (category === "BOGEY" && diff === 1) count++;
    else if (category === "DOUBLE_PLUS" && diff >= 2) count++;
  }

  const perOccurrence: Record<string, number> = { EAGLE: 25, BIRDIE: 4, BOGEY: 5, DOUBLE_PLUS: 10 };
  const points = count * (perOccurrence[category] ?? 0);
  return { points, breakdown: { count } };
}

/**
 * Syncs live bonus points for every bonus pick made on a given round.
 * Only fetches ESPN data for the DISTINCT players actually picked
 * (usually far fewer than the full field), and only for rounds that
 * actually have at least one bonus pick - a round nobody used the
 * bonus slot on costs nothing to skip.
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

  const picksResult = await query<{ id: string; espn_player_id: string }>(
    `select bp.id, tp.espn_player_id
       from bonus_picks bp
       join tournament_players tp on tp.id = bp.tournament_player_id
      where bp.round_id = $1`,
    [roundId]
  );
  if (picksResult.rows.length === 0) return;

  // Dedupe - if multiple members bonus-picked the same player this
  // round (very likely in a small league), only fetch ESPN once for
  // that player, not once per member who picked them.
  const byPlayer = new Map<string, { id: string; espn_player_id: string }[]>();
  for (const p of picksResult.rows) {
    const list = byPlayer.get(p.espn_player_id) ?? [];
    list.push(p);
    byPlayer.set(p.espn_player_id, list);
  }

  for (const [espnPlayerId, bonusPickRows] of byPlayer) {
    try {
      const summary = await fetchCompetitorSummary(round.espn_league_slug, round.espn_event_id, espnPlayerId);
      const roundData = summary?.rounds?.find((r) => r.period === round.round_number);
      const { points, breakdown } = calculateBonusPoints(round.bonus_category, roundData);

      for (const pick of bonusPickRows) {
        await query(
          `update bonus_picks set points = $1, breakdown = $2, last_synced_at = now() where id = $3`,
          [points, JSON.stringify(breakdown), pick.id]
        );
      }
    } catch (err) {
      console.error(`[bonusPickSync] failed for player ${espnPlayerId} on round ${roundId}:`, err);
      // Keep going with other players rather than letting one bad
      // fetch stop the rest of the round's bonus picks from syncing.
    }
  }
}
