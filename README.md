# Guess the Admit Rate 🎓

An 8-bit arcade game about college selectivity, with two modes:

- **🎯 Guess the Rate** — a college appears; guess its acceptance rate. Closest guess banks
  the most coins. Hints (rank / applicants / enrollment) cost points, and the reveal shows a
  data-centered breakdown (histogram + boxplot + selectivity percentile).
- **⚔️ Head-to-Head** — two colleges appear; pick the more selective one (lower acceptance
  rate). Build the longest streak; one wrong pick ends the run.

Each mode has its own per-difficulty online leaderboard, plus light/dark themes and a
how-to-play page.

## Files

| File | Purpose |
|------|---------|
| `game.html` | The entire game (HTML + CSS + JS + embedded data). Static, self-contained. |
| `server.js` | Tiny zero-dependency Node server: serves `game.html` **and** the leaderboard API. |
| `acceptance_rates_ranked_universe_2024_25.csv` | Source data (already baked into `game.html`; not needed at runtime). |
| `leaderboard.db` | SQLite database, created automatically on first run. |

## Requirements

- **Node.js ≥ 22.5** (uses the built-in `node:sqlite` module — no `npm install`, no native build).
  Tested on Node 24. Check with `node --version`.

## Run locally

```bash
node server.js
# → http://localhost:8765
```

Optional environment variables:

```bash
PORT=3000 DB_PATH=/var/data/leaderboard.db node server.js
```

## Hosting on your server

1. Copy `game.html` and `server.js` to the server.
2. Run it (pick the port your host expects):
   ```bash
   PORT=8080 node server.js
   ```
3. Keep it alive across reboots/crashes with a process manager, e.g. **pm2**:
   ```bash
   npm i -g pm2
   PORT=8080 pm2 start server.js --name admit-rate
   pm2 save && pm2 startup
   ```
   …or a systemd unit, or `screen`/`tmux` for a quick-and-dirty setup.
4. **Behind Apache/Nginx:** proxy your public URL to `http://localhost:8080`. The game
   calls the API at the same origin (relative `/api/...`), so no CORS config is needed.
   If you instead serve `game.html` from a *different* origin than the API, set the
   `API` constant near the bottom of `game.html` to the API base URL.

## The database

- Plain SQLite file (`leaderboard.db`). One table, `scores`.
- **Back it up** by copying the file (safe to copy while running).
- Inspect or moderate it with the `sqlite3` CLI:
  ```bash
  sqlite3 leaderboard.db "SELECT initials,score,difficulty,round FROM scores ORDER BY score DESC LIMIT 20;"
  sqlite3 leaderboard.db "DELETE FROM scores WHERE initials='XXX';"   # remove a bad entry
  ```

## API

- `GET  /api/leaderboard?difficulty=easy&limit=10` → `{ difficulty, top:[…], total }`
- `POST /api/score` with JSON `{ initials, score, difficulty, round, meanError }`
  → `{ ok, id, rank, total, top:[…] }`

`difficulty` is one of `easy` / `medium` / `hard` for Guess-the-Rate, or `vs-easy` /
`vs-medium` / `vs-hard` for Head-to-Head — six independent boards in total. For
Head-to-Head rows, `round` holds the run's longest streak and `mean_error` is unused.

## ⚠️ A note on cheating

Scores are submitted by the browser, so a determined user could POST a fake score with
`curl`. The server validates types/ranges and rate-limits per IP, which is plenty for a
class or friendly competition. If you ever need it to be tamper-resistant (e.g. a public
contest with prizes), the fix is to score the run server-side or sign it with a secret —
ask and I'll add it.
