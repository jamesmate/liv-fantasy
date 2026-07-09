import express from "express";
import cors from "cors";
import { leagueRouter } from "./routes/leagues";
import { picksRouter } from "./routes/picks";
import { adminRouter } from "./routes/admin";
import { query } from "./db/client";
import { syncTournamentScores } from "./services/scoreSync";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/leagues", leagueRouter);
app.use("/rounds", picksRouter);
app.use("/admin", adminRouter);

// GET /tournaments/:id - basic tournament + rounds info for the frontend
app.get("/tournaments/:id", async (req, res) => {
  const tournament = await query(`select * from tournaments where id = $1`, [req.params.id]);
  if (tournament.rows.length === 0) return res.status(404).json({ error: "Not found." });
  const rounds = await query(
    `select * from rounds where tournament_id = $1 order by round_number asc`,
    [req.params.id]
  );
  res.json({ ...tournament.rows[0], rounds: rounds.rows });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LIV Fantasy API listening on port ${PORT}`);
});

/**
 * Score sync loop. Render's free web service tier sleeps after 15
 * minutes of inactivity, so this interval only actually runs while the
 * service is awake (i.e. while someone is using the app, or shortly
 * after). That's an acceptable trade-off for a free internal tool -
 * scores catch up as soon as someone opens the app during a live round.
 * If always-on freshness becomes important later, move this to a
 * Render Cron Job (or an external pinger) instead.
 */
const SYNC_INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes

async function runSyncForLiveTournaments() {
  try {
    const live = await query<{ id: string; espn_event_id: string | null }>(
      `select id, espn_event_id from tournaments where status = 'live'`
    );
    for (const t of live.rows) {
      await syncTournamentScores(t.id, t.espn_event_id);
    }
  } catch (err) {
    console.error("[syncLoop] failed:", err);
  }
}

setInterval(runSyncForLiveTournaments, SYNC_INTERVAL_MS);
