import { Request, Response, NextFunction } from "express";
import { query } from "../db/client";

declare global {
  namespace Express {
    interface Request {
      member?: {
        id: string;
        leagueId: string;
        teamName: string;
        displayName: string;
        isOwner: boolean;
      };
    }
  }
}

/**
 * Expects header: Authorization: Bearer <sessionToken>
 * This is intentionally simple (no passwords, no JWT) since this is a
 * private app for a small group of colleagues joining via a league
 * code. Tokens live in the `sessions` table (one member can have
 * several - laptop, phone, etc - all valid at once), generated at
 * join/create/login time and stored by the client (localStorage) for
 * subsequent requests.
 */
export async function requireMember(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing session token." });
  }

  const result = await query<{
    id: string;
    league_id: string;
    team_name: string;
    display_name: string;
    is_owner: boolean;
  }>(
    `select m.id, m.league_id, m.team_name, m.display_name, m.is_owner
       from sessions s
       join members m on m.id = s.member_id
      where s.token = $1`,
    [token]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "Invalid session token." });
  }

  const row = result.rows[0];
  req.member = {
    id: row.id,
    leagueId: row.league_id,
    teamName: row.team_name,
    displayName: row.display_name,
    isOwner: row.is_owner,
  };
  next();
}

/**
 * Use after requireMember on routes that mutate league-wide state
 * (adding tournaments, editing the player pool, marking withdrawals).
 * Only the member who created the league has is_owner = true.
 */
export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.member?.isOwner) {
    return res.status(403).json({ error: "Only the league owner can do this." });
  }
  next();
}
