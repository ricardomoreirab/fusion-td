# Global Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global online leaderboard where players submit their run at game-over, see the rank they earned, and browse the top-N board from the main menu and game-over screen.

**Architecture:** A Cloudflare Worker API + D1 (SQLite) database added to the *same* `wrangler deploy` that already ships the static game in `dist/`. The Worker handles `/api/scores` (GET top-N, POST submit); every other route falls through to static assets. Score validation is a pure, unit-tested function in `src/` shared by the Worker and the client. Same origin → no CORS, one deploy command, no new vendor.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Wrangler, BabylonJS GUI (`@babylonjs/gui`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-30-global-leaderboard-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/survivors/leaderboardValidation.ts` | Create | Pure types (`ScoreSubmission`, `LeaderboardEntry`) + `validateScore()`. Shared by Worker + client. No Babylon/DOM imports. |
| `tests/leaderboardValidation.spec.ts` | Create | Vitest coverage for `validateScore`. |
| `worker/schema.sql` | Create | D1 table + index DDL. |
| `worker/index.ts` | Create | Worker fetch handler: `/api/scores` GET/POST + D1 queries; falls through to `env.ASSETS`. |
| `wrangler.jsonc` | Modify | Add `main`, `assets.binding`, `d1_databases`. |
| `package.json` | Modify | Add `@cloudflare/workers-types` devDep; remove `vercel-build` script. |
| `src/survivors/Leaderboard.ts` | Create | Client `fetch` wrapper: `submitScore()`, `fetchTop()`. |
| `src/shared/GameSettings.ts` | Modify | Add persisted `leaderboardName`. |
| `src/game-over/GameOverState.ts` | Modify | Add `championType` to `SurvivorsRunSummary`; add submit UI section. |
| `src/survivors/SurvivorsGameplayState.ts` | Modify | Thread `championType` into the run summary. |
| `src/shared/ui/LeaderboardPanel.ts` | Create | Shared scrollable top-N viewer modal. |
| `src/menu/MenuState.ts` | Modify | Add a "LEADERBOARD" button that opens the panel. |
| `vercel.json` | Delete | Cloudflare only. |

---

## Task 1: Score validation (pure, TDD)

**Files:**
- Create: `src/survivors/leaderboardValidation.ts`
- Test: `tests/leaderboardValidation.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/leaderboardValidation.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateScore } from '../src/survivors/leaderboardValidation';

const valid = { name: 'Ricardo', wave: 12, timeSec: 305, kills: 240, gold: 1500, champion: 'mage' };

describe('validateScore', () => {
    it('accepts a valid submission', () => {
        const r = validateScore(valid);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.name).toBe('Ricardo');
            expect(r.value.wave).toBe(12);
            expect(r.value.champion).toBe('mage');
        }
    });

    it('rejects a non-object body', () => {
        expect(validateScore(null).ok).toBe(false);
        expect(validateScore('nope').ok).toBe(false);
        expect(validateScore(42).ok).toBe(false);
    });

    it('rejects empty / whitespace-only names', () => {
        expect(validateScore({ ...valid, name: '   ' }).ok).toBe(false);
        expect(validateScore({ ...valid, name: '' }).ok).toBe(false);
    });

    it('strips control characters and clamps name length to 16', () => {
        const r = validateScore({ ...valid, name: 'a\x00b'.padEnd(40, 'x') });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.name.includes('\x00')).toBe(false);
            expect(r.value.name.length).toBeLessThanOrEqual(16);
        }
    });

    it('rejects non-integer or out-of-range wave', () => {
        expect(validateScore({ ...valid, wave: 0 }).ok).toBe(false);
        expect(validateScore({ ...valid, wave: 2.5 }).ok).toBe(false);
        expect(validateScore({ ...valid, wave: 9999 }).ok).toBe(false);
    });

    it('rejects negative kills/gold and over-cap time', () => {
        expect(validateScore({ ...valid, kills: -1 }).ok).toBe(false);
        expect(validateScore({ ...valid, gold: -5 }).ok).toBe(false);
        expect(validateScore({ ...valid, timeSec: 99999 }).ok).toBe(false);
    });

    it('treats champion as optional', () => {
        const { champion, ...noChamp } = valid;
        const r = validateScore(noChamp);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.champion).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- leaderboardValidation`
Expected: FAIL — `Failed to resolve import "../src/survivors/leaderboardValidation"` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/survivors/leaderboardValidation.ts`:

```ts
/** A run score as submitted by the client and stored in D1. */
export interface ScoreSubmission {
    name: string;
    wave: number;
    timeSec: number;
    kills: number;
    gold: number;
    champion?: string;
}

/** A ranked row returned by the leaderboard API. */
export interface LeaderboardEntry extends ScoreSubmission {
    rank: number;
}

export type ValidationResult =
    | { ok: true; value: ScoreSubmission }
    | { ok: false; error: string };

const MAX = {
    nameLen: 16,
    wave: 200,
    timeSec: 7200,
    kills: 100000,
    gold: 10000000,
    championLen: 32,
};

function isFiniteInt(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
}

/** Remove control chars, trim, and clamp a free-text field. */
function sanitizeText(raw: string, maxLen: number): string {
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

/**
 * Casual server-side sanity validation for a submitted run. Trusts the client
 * but rejects clearly-impossible values and sanitizes the display name. Pure
 * (no I/O) so it is unit-tested and shared by the Worker and the client.
 */
export function validateScore(raw: unknown): ValidationResult {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' };
    const r = raw as Record<string, unknown>;

    const name = sanitizeText(typeof r.name === 'string' ? r.name : '', MAX.nameLen);
    if (name.length === 0) return { ok: false, error: 'name required' };

    if (!isFiniteInt(r.wave) || r.wave < 1 || r.wave > MAX.wave) return { ok: false, error: 'wave out of range' };
    if (!isFiniteInt(r.timeSec) || r.timeSec < 0 || r.timeSec > MAX.timeSec) return { ok: false, error: 'timeSec out of range' };
    if (!isFiniteInt(r.kills) || r.kills < 0 || r.kills > MAX.kills) return { ok: false, error: 'kills out of range' };
    if (!isFiniteInt(r.gold) || r.gold < 0 || r.gold > MAX.gold) return { ok: false, error: 'gold out of range' };

    let champion: string | undefined;
    if (r.champion !== undefined && r.champion !== null) {
        if (typeof r.champion !== 'string') return { ok: false, error: 'champion must be a string' };
        champion = sanitizeText(r.champion, MAX.championLen) || undefined;
    }

    return { ok: true, value: { name, wave: r.wave, timeSec: r.timeSec, kills: r.kills, gold: r.gold, champion } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- leaderboardValidation`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/survivors/leaderboardValidation.ts tests/leaderboardValidation.spec.ts
git commit -m "feat(leaderboard): pure score validation + types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Cloudflare D1 + Wrangler config

**Files:**
- Create: `worker/schema.sql`
- Modify: `wrangler.jsonc`
- Modify: `package.json` (add devDependency)

- [ ] **Step 1: Add the Cloudflare Workers types devDependency**

Run: `npm install --save-dev @cloudflare/workers-types`
Expected: package installs; `package.json` `devDependencies` gains `@cloudflare/workers-types`.

- [ ] **Step 2: Create the D1 schema file**

Create `worker/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  wave        INTEGER NOT NULL,
  time_sec    INTEGER NOT NULL,
  kills       INTEGER NOT NULL,
  gold        INTEGER NOT NULL,
  champion    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rank ON scores (wave DESC, time_sec DESC);
```

- [ ] **Step 3: Create the D1 database**

Run: `npx wrangler d1 create fusion-td-leaderboard`
Expected: prints a `database_id` (a UUID). Copy it.
(If this errors with an auth message, run `npx wrangler login` first — this opens a browser; the user can run `! npx wrangler login` in the session.)

- [ ] **Step 4: Wire the bindings into `wrangler.jsonc`**

Replace the entire contents of `wrangler.jsonc` with (paste the real `database_id` from Step 3 in place of `PASTE_DATABASE_ID_HERE`):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fusion-td",
  "main": "worker/index.ts",
  "compatibility_date": "2025-09-27",
  "observability": {
    "enabled": true
  },
  "assets": {
    "directory": "dist",
    "binding": "ASSETS"
  },
  "compatibility_flags": [
    "nodejs_compat"
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "fusion-td-leaderboard",
      "database_id": "PASTE_DATABASE_ID_HERE"
    }
  ]
}
```

Note: `/api/scores` matches no file in `dist/`, so the Worker runs for it; all other routes serve the static game. With `main` set, the Worker is only invoked for non-asset paths.

- [ ] **Step 5: Apply the schema to local + remote D1**

Run: `npx wrangler d1 execute fusion-td-leaderboard --local --file=worker/schema.sql`
Expected: "Executed ... commands" with no error (creates the local dev DB).

Run: `npx wrangler d1 execute fusion-td-leaderboard --remote --file=worker/schema.sql`
Expected: "Executed ... commands" against the live DB.

- [ ] **Step 6: Commit**

```bash
git add worker/schema.sql wrangler.jsonc package.json package-lock.json
git commit -m "chore(leaderboard): add D1 database + wrangler bindings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Worker API

**Files:**
- Create: `worker/index.ts`

- [ ] **Step 1: Write the Worker**

Create `worker/index.ts`:

```ts
/// <reference types="@cloudflare/workers-types" />
import { validateScore, type LeaderboardEntry } from '../src/survivors/leaderboardValidation';

interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
}

interface ScoreRow {
    name: string;
    wave: number;
    time_sec: number;
    kills: number;
    gold: number;
    champion: string | null;
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

async function handleGet(env: Env, url: URL): Promise<Response> {
    const rawLimit = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20;

    const result = await env.DB
        .prepare('SELECT name, wave, time_sec, kills, gold, champion FROM scores ORDER BY wave DESC, time_sec DESC LIMIT ?1')
        .bind(limit)
        .all<ScoreRow>();

    const scores: LeaderboardEntry[] = (result.results ?? []).map((row, i) => ({
        rank: i + 1,
        name: row.name,
        wave: row.wave,
        timeSec: row.time_sec,
        kills: row.kills,
        gold: row.gold,
        champion: row.champion ?? undefined,
    }));

    return json({ scores });
}

async function handlePost(request: Request, env: Env): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return json({ ok: false, error: 'invalid json' }, 400);
    }

    const v = validateScore(body);
    if (!v.ok) return json({ ok: false, error: v.error }, 400);
    const s = v.value;

    await env.DB
        .prepare('INSERT INTO scores (name, wave, time_sec, kills, gold, champion, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(s.name, s.wave, s.timeSec, s.kills, s.gold, s.champion ?? null, Date.now())
        .run();

    // Rank = number of rows that rank strictly higher, + 1. Ties on (wave, time)
    // share a rank; the just-inserted row is excluded by the strict comparison.
    const rankRow = await env.DB
        .prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE wave > ?1 OR (wave = ?1 AND time_sec > ?2)')
        .bind(s.wave, s.timeSec)
        .first<{ rank: number }>();

    return json({ ok: true, rank: rankRow?.rank ?? null });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/api/scores') {
            try {
                if (request.method === 'GET') return await handleGet(env, url);
                if (request.method === 'POST') return await handlePost(request, env);
                return json({ ok: false, error: 'method not allowed' }, 405);
            } catch (err) {
                console.error('leaderboard error', err);
                return json({ ok: false, error: 'internal error' }, 500);
            }
        }
        return env.ASSETS.fetch(request);
    },
};
```

- [ ] **Step 2: Build the game assets (required before `wrangler dev` can serve `dist/`)**

Run: `npm run build`
Expected: webpack production build completes, `dist/` populated.

- [ ] **Step 3: Start the local Worker + assets + local D1**

Run (in a separate terminal, leave it running): `npx wrangler dev`
Expected: serves on a local URL (e.g. `http://localhost:8787`), bindings `ASSETS` and `DB` listed.

- [ ] **Step 4: Manually verify POST then GET**

Run:
```bash
curl -s -X POST http://localhost:8787/api/scores \
  -H 'content-type: application/json' \
  -d '{"name":"Tester","wave":7,"timeSec":200,"kills":80,"gold":300,"champion":"mage"}'
```
Expected: `{"ok":true,"rank":1}`

Run: `curl -s 'http://localhost:8787/api/scores?limit=10'`
Expected: `{"scores":[{"rank":1,"name":"Tester","wave":7,"timeSec":200,...}]}`

Run (validation rejection):
```bash
curl -s -X POST http://localhost:8787/api/scores -H 'content-type: application/json' -d '{"name":"","wave":7}'
```
Expected: HTTP 400, `{"ok":false,"error":"name required"}`

Stop `wrangler dev` (Ctrl-C) when done.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts
git commit -m "feat(leaderboard): worker API for GET/POST /api/scores

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Client API wrapper + name persistence + summary threading

**Files:**
- Create: `src/survivors/Leaderboard.ts`
- Modify: `src/shared/GameSettings.ts`
- Modify: `src/game-over/GameOverState.ts` (interface only)
- Modify: `src/survivors/SurvivorsGameplayState.ts` (summary build)

- [ ] **Step 1: Add `championType` to the run summary interface**

In `src/game-over/GameOverState.ts`, modify the `SurvivorsRunSummary` interface (currently ends at `finalLoadout`):

```ts
export interface SurvivorsRunSummary {
    waveReached: number;
    timeSurvivedSec: number;
    kills: number;
    goldCollected: number;
    finalLoadout: { name: string; level: number; icon: string; tier?: string }[];
    championType?: string;
}
```

- [ ] **Step 2: Thread `championType` into the built summary**

In `src/survivors/SurvivorsGameplayState.ts`, in `buildAndSendRunSummary()`, add the field to the `summary` object literal:

```ts
        const summary: SurvivorsRunSummary = {
            waveReached,
            timeSurvivedSec,
            kills,
            goldCollected,
            finalLoadout,
            championType: this.currentChampionType,
        };
```

- [ ] **Step 3: Add `leaderboardName` to GameSettings**

In `src/shared/GameSettings.ts`:

Change the `SettingsShape` interface and `DEFAULTS`:

```ts
interface SettingsShape {
    graphicsQuality: GraphicsQuality;
    leaderboardName: string;
}

const DEFAULTS: SettingsShape = {
    graphicsQuality: 'high',
    leaderboardName: '',
};
```

In `load()`, replace the `_state = { graphicsQuality: quality };` assignment (inside the `if (raw)` block) with:

```ts
            const leaderboardName = typeof parsed.leaderboardName === 'string'
                ? parsed.leaderboardName.slice(0, 16)
                : DEFAULTS.leaderboardName;
            _state = { graphicsQuality: quality, leaderboardName };
            return _state;
```

Add two methods to the `GameSettings` object (after `setGraphicsQuality`):

```ts
    getLeaderboardName(): string {
        return load().leaderboardName;
    },

    setLeaderboardName(name: string): void {
        const s = load();
        const clean = name.slice(0, 16);
        if (s.leaderboardName === clean) return;
        s.leaderboardName = clean;
        persist();
        for (const fn of _listeners) fn(s);
    },
```

- [ ] **Step 4: Create the client API wrapper**

Create `src/survivors/Leaderboard.ts`:

```ts
import type { LeaderboardEntry, ScoreSubmission } from './leaderboardValidation';
import type { SurvivorsRunSummary } from '../game-over/GameOverState';

const API = '/api/scores';

/**
 * Submit a finished run to the global leaderboard. Returns the rank earned, or
 * null if the request failed (offline, the webpack dev server has no Worker, or
 * a server error) — callers must degrade gracefully.
 */
export async function submitScore(
    summary: SurvivorsRunSummary,
    name: string,
): Promise<{ rank: number } | null> {
    const payload: ScoreSubmission = {
        name,
        wave: Math.trunc(summary.waveReached),
        timeSec: Math.trunc(summary.timeSurvivedSec),
        kills: Math.trunc(summary.kills),
        gold: Math.trunc(summary.goldCollected),
        champion: summary.championType,
    };
    try {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { ok?: boolean; rank?: number };
        return data.ok && typeof data.rank === 'number' ? { rank: data.rank } : null;
    } catch {
        return null;
    }
}

/** Fetch the top-N leaderboard entries. Returns [] on any failure. */
export async function fetchTop(limit = 20): Promise<LeaderboardEntry[]> {
    try {
        const res = await fetch(`${API}?limit=${encodeURIComponent(limit)}`);
        if (!res.ok) return [];
        const data = (await res.json()) as { scores?: LeaderboardEntry[] };
        return Array.isArray(data.scores) ? data.scores : [];
    } catch {
        return [];
    }
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the unit tests (ensure nothing regressed)**

Run: `npm test`
Expected: all tests pass (PlayerStats, RunItems, leaderboardValidation).

- [ ] **Step 7: Commit**

```bash
git add src/survivors/Leaderboard.ts src/shared/GameSettings.ts src/game-over/GameOverState.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(leaderboard): client API wrapper, name persistence, champion in summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Shared LeaderboardPanel component

**Files:**
- Create: `src/shared/ui/LeaderboardPanel.ts`

- [ ] **Step 1: Write the panel component**

Create `src/shared/ui/LeaderboardPanel.ts`:

```ts
import { AdvancedDynamicTexture, Rectangle, TextBlock, Control, ScrollViewer, StackPanel } from '@babylonjs/gui';
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';
import { fetchTop } from '../../survivors/Leaderboard';
import type { LeaderboardEntry } from '../../survivors/leaderboardValidation';

/**
 * Full-screen modal leaderboard. Fetches the top-N runs and renders them as a
 * scrollable ranked list (rank, name, wave, time). Reused by the main menu and
 * the game-over screen. Call open() to fetch + display; dispose() removes it.
 *
 * Columns are aligned with a monospace font + string padding — simplest robust
 * approach for variable-length names in BabylonJS GUI.
 */
export class LeaderboardPanel {
    private root: Rectangle;
    private listStack: StackPanel;
    private statusText: TextBlock;

    constructor(private ui: AdvancedDynamicTexture, private onClose: () => void) {
        this.root = new Rectangle('lbBackdrop');
        this.root.width = '100%';
        this.root.height = '100%';
        this.root.thickness = 0;
        this.root.background = STYLE.backdropDim;
        this.root.isPointerBlocker = true;
        this.ui.addControl(this.root);

        const panel = makeFrame({ name: 'lbPanel', sizePx: 440, color: '#F5A623', cornerRadius: 14 });
        panel.width = '440px';
        panel.height = '560px';
        panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        this.root.addControl(panel);

        const title = new TextBlock('lbTitle', 'LEADERBOARD');
        title.color = '#F5A623';
        title.fontSize = 28;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.height = '40px';
        title.top = '14px';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        panel.addControl(title);

        const header = new TextBlock('lbHeader', this.formatRow('#', 'NAME', 'WAVE', 'TIME'));
        header.color = '#F5A623';
        header.fontSize = 15;
        header.fontFamily = 'Courier New';
        header.height = '24px';
        header.top = '58px';
        header.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        panel.addControl(header);

        const scroll = new ScrollViewer('lbScroll');
        scroll.width = '400px';
        scroll.height = '372px';
        scroll.top = '86px';
        scroll.thickness = 0;
        scroll.barColor = '#F5A623';
        scroll.barBackground = 'rgba(255,255,255,0.08)';
        scroll.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        scroll.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        panel.addControl(scroll);

        this.listStack = new StackPanel('lbList');
        this.listStack.width = '100%';
        this.listStack.isVertical = true;
        scroll.addControl(this.listStack);

        this.statusText = new TextBlock('lbStatus', 'Loading…');
        this.statusText.color = '#bbb';
        this.statusText.fontSize = 16;
        this.statusText.fontFamily = 'Arial';
        this.statusText.height = '40px';
        this.statusText.top = '40px';
        this.statusText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        panel.addControl(this.statusText);

        const closeBtn = makeFrame({ name: 'lbClose', sizePx: 200, color: '#888', cornerRadius: 10 });
        closeBtn.width = '200px';
        closeBtn.height = '48px';
        closeBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        closeBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        closeBtn.top = '-16px';
        const closeLabel = new TextBlock('lbCloseLabel', 'CLOSE');
        closeLabel.color = '#fff';
        closeLabel.fontSize = 20;
        closeLabel.fontWeight = 'bold';
        closeLabel.fontFamily = 'Arial';
        closeBtn.addControl(closeLabel);
        addPressFeedback(closeBtn, () => { this.dispose(); this.onClose(); });
        panel.addControl(closeBtn);
    }

    /** Fetch the board and render rows. Safe to call once after construction. */
    public async open(): Promise<void> {
        this.statusText.text = 'Loading…';
        this.statusText.isVisible = true;
        const entries = await fetchTop(50);
        if (entries.length === 0) {
            this.statusText.text = 'No scores yet — be the first!';
            return;
        }
        this.statusText.isVisible = false;
        for (const e of entries) this.listStack.addControl(this.makeRow(e));
    }

    public dispose(): void {
        this.root.dispose();
    }

    private formatRow(rank: string, name: string, wave: string, time: string): string {
        return `${rank.padEnd(4)}${name.padEnd(14)}${wave.padStart(5)}${time.padStart(8)}`;
    }

    private makeRow(e: LeaderboardEntry): Rectangle {
        const row = new Rectangle(`lbRow${e.rank}`);
        row.height = '30px';
        row.thickness = 0;
        row.background = e.rank % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent';

        const mins = Math.floor(e.timeSec / 60);
        const secs = Math.floor(e.timeSec % 60);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        const name = e.name.length > 13 ? e.name.slice(0, 12) + '…' : e.name;

        const t = new TextBlock(`lbRowT${e.rank}`, this.formatRow(`#${e.rank}`, name, `${e.wave}`, timeStr));
        t.color = e.rank <= 3 ? '#F5A623' : '#fff';
        t.fontSize = 15;
        t.fontFamily = 'Courier New';
        t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        row.addControl(t);
        return row;
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/ui/LeaderboardPanel.ts
git commit -m "feat(leaderboard): shared scrollable top-N viewer panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Game-over submit UI

**Files:**
- Modify: `src/game-over/GameOverState.ts`

- [ ] **Step 1: Add imports**

In `src/game-over/GameOverState.ts`, update the GUI import to include `InputText`, and add three new imports below the existing ones:

```ts
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle, InputText } from '@babylonjs/gui';
```

```ts
import { GameSettings } from '../shared/GameSettings';
import { submitScore } from '../survivors/Leaderboard';
import { LeaderboardPanel } from '../shared/ui/LeaderboardPanel';
```

- [ ] **Step 2: Call the new section at the end of `createSurvivorsUI`**

In `createSurvivorsUI`, immediately before its final closing brace (after the `menuBtn` block that calls `this.ui.addControl(menuBtn);`), add:

```ts
        this.addLeaderboardSection(isMobile, isLandscape);
```

- [ ] **Step 3: Add the `addLeaderboardSection` and `openLeaderboard` methods**

Add these two private methods to the `GameOverState` class (e.g. directly after `createSurvivorsUI`):

```ts
    /**
     * Bottom-anchored leaderboard submit row: a name field (pre-filled from the
     * last-used name) + a submit button. On success the button becomes a
     * "RANKED #N — VIEW BOARD" action that opens the full panel. Anchored to the
     * screen bottom so it never collides with the centered stats/buttons stack.
     */
    private addLeaderboardSection(isMobile: boolean, isLandscape: boolean): void {
        if (!this.ui || !this.survivorsSummary) return;
        const summary = this.survivorsSummary;

        const fieldWidthPx = isLandscape ? 200 : (isMobile ? 240 : 280);
        const rowHeightPx = isLandscape ? 34 : (isMobile ? 44 : 48);
        const fontSize = isLandscape ? 14 : (isMobile ? 16 : 18);
        const nameTop = isLandscape ? -92 : (isMobile ? -150 : -172);
        const submitTop = isLandscape ? -50 : (isMobile ? -98 : -112);

        const nameInput = new InputText('lbName');
        nameInput.width = `${fieldWidthPx}px`;
        nameInput.height = `${rowHeightPx}px`;
        nameInput.text = GameSettings.getLeaderboardName();
        nameInput.placeholderText = 'Enter your name';
        nameInput.placeholderColor = '#888';
        nameInput.color = '#FFFFFF';
        nameInput.background = STYLE.panelBg;
        nameInput.focusedBackground = STYLE.panelBg;
        nameInput.fontSize = fontSize;
        nameInput.fontFamily = 'Arial';
        nameInput.thickness = 2;
        nameInput.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameInput.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        nameInput.top = `${nameTop}px`;
        this.ui.addControl(nameInput);

        const submitBtn = makeFrame({ name: 'lbSubmit', sizePx: fieldWidthPx, color: '#F5A623', cornerRadius: 10 });
        submitBtn.width = `${fieldWidthPx}px`;
        submitBtn.height = `${rowHeightPx}px`;
        submitBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        submitBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        submitBtn.top = `${submitTop}px`;
        const submitLabel = new TextBlock('lbSubmitLabel', '🏆 SUBMIT SCORE');
        submitLabel.color = '#FFFFFF';
        submitLabel.fontSize = fontSize;
        submitLabel.fontWeight = 'bold';
        submitLabel.fontFamily = 'Arial';
        submitBtn.addControl(submitLabel);
        this.ui.addControl(submitBtn);

        let submitted = false;
        addPressFeedback(submitBtn, () => {
            if (submitted) {
                this.openLeaderboard();
                return;
            }
            const name = nameInput.text.trim();
            if (name.length === 0) {
                submitLabel.text = 'ENTER A NAME FIRST';
                return;
            }
            GameSettings.setLeaderboardName(name);
            submitLabel.text = 'SUBMITTING…';
            void submitScore(summary, name).then((result) => {
                if (result) {
                    submitted = true;
                    submitLabel.text = `RANKED #${result.rank} — VIEW BOARD`;
                    nameInput.isVisible = false;
                } else {
                    submitLabel.text = 'FAILED — TAP TO RETRY';
                }
            });
        });
    }

    private openLeaderboard(): void {
        if (!this.ui) return;
        const panel = new LeaderboardPanel(this.ui, () => { /* closed — nothing to restore */ });
        void panel.open();
    }
```

Note: `makeFrame`, `addPressFeedback`, and `STYLE` are already imported at the top of this file.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification (full stack)**

Run: `npm run build` then `npx wrangler dev`
Open the local URL, play until death (or trigger game-over), confirm:
- A name field (pre-filled if previously set) and "🏆 SUBMIT SCORE" button appear at the bottom.
- Submitting shows "RANKED #N — VIEW BOARD"; tapping again opens the panel with your entry.
- "PLAY AGAIN" / "MAIN MENU" still work.
Stop `wrangler dev` when done.

- [ ] **Step 6: Commit**

```bash
git add src/game-over/GameOverState.ts
git commit -m "feat(leaderboard): game-over submit UI with rank display

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Main-menu Leaderboard button

**Files:**
- Modify: `src/menu/MenuState.ts`

- [ ] **Step 1: Add the import**

At the top of `src/menu/MenuState.ts`, add:

```ts
import { LeaderboardPanel } from '../shared/ui/LeaderboardPanel';
```

- [ ] **Step 2: Add the button after the graphics selector**

In `createUI()`, immediately before the final `refreshGfx();` call at the end of the method, add a leaderboard button positioned below the graphics buttons:

```ts
        const lbButton = Button.CreateSimpleButton('leaderboardButton', '🏆 LEADERBOARD');
        lbButton.width = btnWidth;
        lbButton.height = isLandscape ? '34px' : (isMobile ? '44px' : '48px');
        lbButton.color = '#F5A623';
        lbButton.background = '#3a2a08';
        lbButton.cornerRadius = 6;
        lbButton.thickness = 2;
        lbButton.fontFamily = 'Georgia';
        lbButton.fontSize = isLandscape ? 14 : (isMobile ? 16 : 18);
        lbButton.fontWeight = 'bold';
        lbButton.top = isLandscape ? '108px' : (isMobile ? '118px' : '140px');
        if (lbButton.textBlock) lbButton.textBlock.color = '#F5A623';
        lbButton.onPointerUpObservable.add(() => {
            if (!this.ui) return;
            const panel = new LeaderboardPanel(this.ui, () => { /* closed */ });
            void panel.open();
        });
        touchBlocker.addControl(lbButton);
```

Note: `this.ui` is the `AdvancedDynamicTexture` created in `createUI`. Confirm the field name by checking how `touchBlocker` was added (`this.ui.addControl(touchBlocker)` near the top of `createUI`); if the texture is held in a differently-named field, use that field instead.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run build` then `npx wrangler dev`. Open the menu, confirm the "🏆 LEADERBOARD" button appears below the graphics selector and opens the panel (showing the entry submitted in Task 6). CLOSE returns to the menu.

- [ ] **Step 5: Commit**

```bash
git add src/menu/MenuState.ts
git commit -m "feat(leaderboard): main-menu leaderboard button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Drop Vercel config

**Files:**
- Delete: `vercel.json`
- Modify: `package.json`

- [ ] **Step 1: Remove the Vercel files/scripts**

Run: `git rm vercel.json`

In `package.json`, delete the `"vercel-build": "webpack --mode production",` line from `scripts`.

- [ ] **Step 2: Verify build + tests still pass**

Run: `npm run build`
Expected: build succeeds.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add vercel.json package.json
git commit -m "chore: drop Vercel config — Cloudflare only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Deploy and smoke-test production**

Run: `npm run deploy`
Expected: `wrangler deploy` uploads assets + Worker; prints the live URL.

Open the live URL: confirm the menu "LEADERBOARD" button opens the (initially empty or seeded) board; play a run, submit at game-over, confirm the rank shows and the entry appears on both the game-over and menu panels.

---

## Notes for the implementer

- **Worker code lives outside the app `tsconfig`** (`include: ["src/**/*"]`), so `npx tsc --noEmit` does *not* type-check `worker/index.ts`. The `/// <reference types="@cloudflare/workers-types" />` directive gives editor types; Wrangler bundles and validates it at `dev`/`deploy` time. This is intentional — the manual `wrangler dev` step in Task 3 is how the Worker is verified.
- **The webpack dev server (`npm start`) has no Worker**, so `/api/scores` will fail there; the client wrappers swallow that and the UI shows "No scores yet" / "FAILED — TAP TO RETRY". Use `npx wrangler dev` (after `npm run build`) for any end-to-end leaderboard testing.
- **Only `validateScore` is unit-tested** — it is the lone pure-logic unit, matching the project's "Vitest for pure-logic modules only" convention. Worker, client `fetch`, and BabylonJS GUI code are verified manually via `wrangler dev`.
- If `npx wrangler` prompts for auth, the user should run `! npx wrangler login` in the session (opens a browser).
