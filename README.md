# LIV Fantasy

A private fantasy golf app for LIV Golf events, built for a small group
(colleagues, friends) joining via a league code on their phones.

- Pick 4 LIV players per round (4 rounds per LIV 2026 event), scores summed
  to par.
- Can't repeat a player within the same tournament.
- One "Double Play" token per member per tournament: doubles a player's
  round score if they're under par, halves-and-rounds-up if over par.
  Transfers automatically through swaps; lost if unused.
- If a picked player withdraws, swap them out without losing your "used
  player" progress for that tournament.
- Round locking (e.g. at tee time) - no changes after lock.
- Team names and career wins/accumulated score persist across tournaments
  within a league - only the picks/live scores reset each event.
- Live scores pulled from ESPN's public (unofficial) golf scoreboard
  endpoint - free, no API key, but undocumented and could change.

## Stack

- **Backend**: Node + Express + TypeScript, Postgres via `pg`
- **Frontend**: React + Vite + TypeScript, Mantine UI, installable as a PWA
- **Hosting** (both free tier, no credit card): backend on
  Render (render.com), database on Supabase (supabase.com)

## Project layout

```
backend/
  src/
    db/
      schema.sql              # tables
      triggers_and_views.sql  # pick-cap trigger, scoring views, Double Play math
      migrate.ts               # applies both .sql files - run after setting DATABASE_URL
      client.ts                # pg Pool wrapper
    adapters/
      espnGolf.ts              # ESPN scoreboard adapter - isolated, swappable
    services/
      picks.ts                 # pick submission, swaps, Double Play token logic
      scoreSync.ts             # pulls live scores from ESPN into the DB
      tournamentResults.ts     # finalizes a completed tournament into the career ledger
    routes/
      leagues.ts               # create/join league, standings, career standings
      picks.ts                 # available players, submit picks, swap, double-play status
      admin.ts                 # owner-only: tournaments, player pool, round locks, win overrides
    middleware/
      auth.ts                  # session token auth, requireOwner guard
    index.ts                   # Express app + score sync loop

frontend/
  src/
    api/client.ts              # typed fetch wrapper for the backend API
    theme.ts                   # Mantine theme (Jamdog mint/forest/coral/tangerine palette)
    pages/                     # one file per screen
    components/TopBar.tsx
    App.tsx                    # router + layout shell
    main.tsx                   # entry point
```

## Local development

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env and set DATABASE_URL to your Supabase connection string
npm run migrate   # applies schema.sql + triggers_and_views.sql
npm run dev        # starts on http://localhost:3001
```

To sanity-check the ESPN adapter on its own (useful after any ESPN
endpoint changes):

```bash
npm run check-espn
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev   # starts on http://localhost:5173, proxies /api to localhost:3001
```

Open the printed local URL on your phone (same wifi network) to test the
mobile layout, or use your browser's device toolbar.

## Deploying for real (free tier)

### Step 1: Database (Supabase)

1. Create a free project at supabase.com.
2. Go to Project Settings -> Database -> Connection string -> URI. Copy it.
3. Locally, set `DATABASE_URL` in `backend/.env` to that string and run:
   ```bash
   cd backend
   npm run migrate
   ```
   This creates all tables, the pick-cap trigger, and the scoring views.

### Step 2: Backend (Render)

1. Push this repo to GitHub (or GitLab).
2. In Render, create a New Web Service, point it at the repo, root
   directory `backend`.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add an environment variable `DATABASE_URL` set to your Supabase
   connection string.
6. Deploy. Note the resulting URL, e.g. `https://liv-fantasy-api.onrender.com`.

Render's free tier sleeps after 15 minutes of inactivity and takes about
a minute to wake up on the next request - fine for a casual league app,
but the first request after a quiet spell will be slow. The score sync
loop (every 3 minutes, see `index.ts`) only actually runs while the
service is awake.

### Step 3: Verify the ESPN endpoint

This is the one piece that couldn't be tested before deployment, since
the dev sandbox used to build this had no general internet access. Once
the backend is live, check the logs after `setTournamentStatus('live')`
triggers the first sync, and confirm:

- The league slug in `backend/src/adapters/espnGolf.ts`
  (`LIV_LEAGUE_SLUG = "liv"`) is correct. If 0 events come back, try
  inspecting network requests on espn.com's LIV leaderboard page
  directly (browser dev tools -> Network tab) to find the real endpoint
  ESPN's own site calls.
- The JSON field paths in `normalizeEspnResponse()` match what ESPN
  actually returns - the function has comments marking the parts most
  likely to need adjusting.

Everything else in the app is decoupled from this - if the adapter
breaks, only `espnGolf.ts` needs fixing.

### Step 4: Frontend (Render static site or Vercel)

1. New Static Site on Render (or import to Vercel), root directory
   `frontend`.
2. Build command: `npm install && npm run build`
3. Publish directory: `dist`
4. Add an environment variable `VITE_API_BASE_URL` set to your backend's
   Render URL from Step 2 (e.g. `https://liv-fantasy-api.onrender.com`).
5. Deploy. Open the resulting URL on your phone and "Add to Home Screen"
   for the installable PWA experience.

## Running it every tournament

1. Owner opens League Admin, creates a new tournament (4 rounds are
   auto-created).
2. Paste the field into the bulk player-add box (`Name, Pro Team` per
   line).
3. Set each round's lock time (tee time) if desired.
4. Flip status to Live once the event starts - this turns on score
   syncing.
5. When the event finishes, flip status to Completed - this
   finalizes results into the permanent career ledger (wins, accumulated
   score). You can override who's credited with the win from the same
   screen if needed (e.g. a tie-break).
6. Team names and career stats carry over automatically; only picks and
   live scores reset when you create the next tournament.

## Known gaps / things to double check after deploying

- The ESPN league slug needs live verification (see Step 3 above).
- There's no automated reminder if you forget to flip a finished
  tournament to "completed" - career stats just won't include it until
  you do.
- Auth is a bare session token in localStorage, no password - fine for
  a private friend-group app, not meant for anything sensitive.
- Render's free Postgres (if you use that instead of Supabase) expires
  after 30 days; Supabase's free tier doesn't have that limit, which is
  why it's the recommended pairing here.
