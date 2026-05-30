# Global Leaderboard — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Goal

Add a **global online leaderboard** so players' best runs are ranked against everyone else's. Players submit a run at game-over, see the rank they earned, and can browse the top-N board from both the game-over screen and the main menu.

## Approach

Reuse the existing **Cloudflare** deployment. The game already ships `dist/` as Cloudflare static assets via `wrangler deploy`. We add a **Cloudflare Worker API + a D1 (SQLite) database** to the *same* deployment.

- Worker handles `/api/*`; all other routes fall through to the static game in `dist/`.
- Same origin → no CORS.
- One deploy command (`npm run deploy` → `wrangler deploy`), no new vendor, generous free tier.
- **Vercel is dropped** — Cloudflare only.

```
Browser (BabylonJS game)
  │  fetch('/api/scores')        ← same origin, no CORS
  ▼
Cloudflare Worker (worker/index.ts)
  ├─ GET  /api/scores?limit=N    → top-N rows
  ├─ POST /api/scores            → insert one run, return its rank
  └─ all other paths             → env.ASSETS (static dist/)
  │
  ▼
Cloudflare D1 (SQLite) — table `scores`
```

## Design decisions (confirmed)

| Decision | Choice |
|---|---|
| Scope | Global online leaderboard (not local-only) |
| Ranking metric | **Wave reached**, with **time survived as tiebreaker** |
| Player identity | **Name prompt on game-over**, pre-filled from last-used name persisted in `GameSettings` (localStorage). No accounts. |
| Anti-cheat | **Casual** — trust the client; server does basic sanity bounds only |
| Hosting | **Cloudflare only** (remove Vercel config) |
| Viewing | Both **main menu** and **game-over** |
| Submission gating | **Always allow submit** (board self-sorts); no threshold |

## Components

### 1. Cloudflare config — `wrangler.jsonc`
Add to the existing config:
- `"main": "worker/index.ts"` — Worker entry point.
- `assets.binding: "ASSETS"` — so the Worker can delegate non-API requests to static assets.
- `d1_databases: [{ binding: "DB", database_name: "fusion-td-leaderboard", database_id: "<from wrangler d1 create>" }]`.

`/api/scores` matches no file in `dist/`, so the Worker runs for it; every other route serves the game. The `nodejs_compat` flag is already present.

### 2. Data model — D1
```sql
CREATE TABLE scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  wave        INTEGER NOT NULL,
  time_sec    INTEGER NOT NULL,
  kills       INTEGER NOT NULL,
  gold        INTEGER NOT NULL,
  champion    TEXT,                 -- champion type id, nullable
  created_at  INTEGER NOT NULL      -- epoch ms
);
CREATE INDEX idx_rank ON scores (wave DESC, time_sec DESC);
```
Schema lives in a migration file (e.g. `worker/schema.sql`) applied with `wrangler d1 execute`.

Ranking query:
```sql
SELECT name, wave, time_sec, kills, gold, champion
FROM scores
ORDER BY wave DESC, time_sec DESC
LIMIT ?;
```

### 3. Worker API — `worker/index.ts`
```ts
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/scores') return handleScores(request, env, url);
    return env.ASSETS.fetch(request); // static game
  }
}
```

- **`GET /api/scores?limit=20`** (default 20, clamp to ≤ 100)
  → `{ scores: [{ rank, name, wave, timeSec, kills, gold, champion }, ...] }`
  `rank` is the 1-based position from the ordered query.

- **`POST /api/scores`** body `{ name, wave, timeSec, kills, gold, champion }`
  → validate → insert → compute the inserted run's rank
  → `{ ok: true, rank }`.

- **Validation (casual, pure function — `validateScore`)**: trim name, strip control chars, length 1–16 (reject empty); integers only; bounds: `1 ≤ wave ≤ 200`, `0 ≤ timeSec ≤ 7200`, `0 ≤ kills ≤ 100000`, `0 ≤ gold ≤ 10000000`; champion optional string ≤ 32 chars. Invalid → `400 { ok: false, error }`.

- D1 errors → `500 { ok: false }`, logged via Cloudflare observability (already enabled).

### 4. Client API wrapper — `src/survivors/Leaderboard.ts`
Thin `fetch` module:
- `submitScore(summary: SurvivorsRunSummary, name: string, champion?: string): Promise<{ rank: number } | null>`
- `fetchTop(limit = 20): Promise<LeaderboardEntry[]>`

Returns `null` / empty on network failure (caller shows graceful fallback). Same-origin `fetch('/api/scores', ...)` in production.

### 5. Name & data threading
- New `GameSettings` key `leaderboardName` (uses existing localStorage pub-sub). Pre-fills the name field; updated whenever a player submits.
- `SurvivorsRunSummary` gains an optional `championType` so the board can record/show which hero. Threaded from `startRun(championType)` through to the summary built in `SurvivorsGameplayState`.

### 6. UI
- **Game-over** (`GameOverState.createSurvivorsUI`): after the run summary panel, render a name field (pre-filled from `leaderboardName`) + **"Submit to Leaderboard"** button. On success show **"You ranked #N"**, then a **"View Leaderboard"** button. Submission and viewing never block the existing "Play Again" / "Main Menu" buttons.
- **Shared leaderboard panel** (new component, e.g. `src/shared/ui/LeaderboardPanel.ts`): scrollable top-N list (rank, name, wave, time, optional champion icon). Reused on game-over and from the menu.
- **Main menu** (`MenuState`): a new **"Leaderboard"** button that opens the shared panel.

### 7. Error handling
- Submit failure / offline / `npm start` dev server (no Worker): catch, show a non-blocking "Leaderboard unavailable" state with optional retry. Never block navigation.
- Local end-to-end testing via `npm run preview` (`wrangler dev`) = static assets + Worker + local D1.

### 8. Testing
- Extract `validateScore` (and any rank/sanitize helpers) as **pure functions** → Vitest under `tests/`, matching the project's "pure-logic only" test convention (e.g. `tests/Leaderboard.spec.ts`).
- Manual E2E through `wrangler dev`: submit a run, fetch the board, confirm ordering and returned rank.

### 9. Cleanup
- Remove `vercel.json` and the `vercel-build` script from `package.json` (Cloudflare only).

## Implementation phases

1. **Cloudflare wiring** — `wrangler.jsonc` (`main`, `ASSETS`, `d1_databases`); `worker/schema.sql`; create D1 DB + apply schema.
2. **Worker API** — `worker/index.ts` with GET/POST `/api/scores`; `validateScore` pure function + Vitest tests.
3. **Client API + persistence** — `src/survivors/Leaderboard.ts`; `leaderboardName` in `GameSettings`; add `championType` to `SurvivorsRunSummary` and thread it.
4. **UI** — shared `LeaderboardPanel`; game-over submit + name entry + rank display; main-menu "Leaderboard" button.
5. **Cleanup** — remove Vercel config + script.

## Out of scope (YAGNI)

- User accounts / authentication.
- Server-authoritative or signed-run anti-cheat.
- Per-champion or seasonal boards, pagination beyond top-N, friend lists.
- Rate-limiting (can be added later if abuse appears).
