# Off-Screen Enemy Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing screen-edge dot indicator from elites-only to every alive off-screen enemy, with size/color encoding the tier (regular / elite / boss).

**Architecture:** Rename `src/survivors/ui/EliteIndicators.ts` to `OffscreenEnemyIndicators.ts` and rewrite its `update()` loop to handle all enemies. Per-frame dot style (width/height/background/thickness/cornerRadius) is reassigned every frame so a tier upgrade mid-life (e.g., `EliteSpawner` promoting a regular spawn to elite) automatically reflects in the dot. The single call-site in `SurvivorsGameplayState.ts` updates its import, field, constructor call, dispose call, and update call.

**Tech Stack:** TypeScript, BabylonJS, `@babylonjs/gui` (`AdvancedDynamicTexture`, `Rectangle`).

**No automated tests.** The project's Vitest setup covers pure-logic modules only (no Babylon scene). The existing `EliteIndicators` has no tests for the same reason. Each task ends with a `npx tsc --noEmit` type-check; the final task is manual in-game verification.

---

## File Structure

**Renamed (preserves git history):**
- `src/survivors/ui/EliteIndicators.ts` → `src/survivors/ui/OffscreenEnemyIndicators.ts`
  - Class `EliteIndicators` → `OffscreenEnemyIndicators`
  - `update()` no longer skips non-elites; per-tier styling applied each frame

**Modified:**
- `src/survivors/SurvivorsGameplayState.ts` — 5 references update (import, field type, constructor call, dispose call, update call)

**New imports inside `OffscreenEnemyIndicators.ts`:**
- `BossEnemy` from `../enemies/BossEnemy` (used for boss-tier `instanceof` detection)

---

### Task 1: Rename file and class, no behavior change

This is a mechanical rename so git tracks the move cleanly. After this task the game behavior is identical to before — elites still get colored dots, regulars still get nothing.

**Files:**
- Rename: `src/survivors/ui/EliteIndicators.ts` → `src/survivors/ui/OffscreenEnemyIndicators.ts`
- Modify: `src/survivors/SurvivorsGameplayState.ts:22` (import), `:183` (field type), `:588` (constructor), `:802` (dispose), `:979` (update)

- [ ] **Step 1: Rename the file via git**

Run from repo root:
```bash
git mv src/survivors/ui/EliteIndicators.ts src/survivors/ui/OffscreenEnemyIndicators.ts
```

- [ ] **Step 2: Rename the class symbol inside the renamed file**

In `src/survivors/ui/OffscreenEnemyIndicators.ts`, replace every occurrence of `EliteIndicators` with `OffscreenEnemyIndicators`. There should be exactly one: the `export class EliteIndicators` declaration.

After this step, the file's class line reads:
```ts
export class OffscreenEnemyIndicators {
```

Also rename the internal id prefix `eliteIndDot_` to `offscreenEnemyDot_` for consistency (it's a debugging aid only — name shows up in the Babylon inspector). The line currently reads:
```ts
dot = new Rectangle(`eliteIndDot_${Math.random()}`);
```
After:
```ts
dot = new Rectangle(`offscreenEnemyDot_${Math.random()}`);
```

- [ ] **Step 3: Update the import in `SurvivorsGameplayState.ts`**

Line 22 currently reads:
```ts
import { EliteIndicators } from './ui/EliteIndicators';
```
After:
```ts
import { OffscreenEnemyIndicators } from './ui/OffscreenEnemyIndicators';
```

- [ ] **Step 4: Update the field declaration in `SurvivorsGameplayState.ts`**

Line 183 currently reads:
```ts
    private eliteIndicators: EliteIndicators | null = null;
```
After:
```ts
    private offscreenIndicators: OffscreenEnemyIndicators | null = null;
```

- [ ] **Step 5: Update the constructor call in `SurvivorsGameplayState.ts`**

Around line 587–593 the block currently reads:
```ts
        // Off-screen elite indicators
        this.eliteIndicators = new EliteIndicators(
            this.ui,
            this.scene,
            this.heroController.getCamera(),
            () => this.enemyManager?.getEnemies() ?? [],
        );
```
After:
```ts
        // Off-screen enemy indicators (all tiers)
        this.offscreenIndicators = new OffscreenEnemyIndicators(
            this.ui,
            this.scene,
            this.heroController.getCamera(),
            () => this.enemyManager?.getEnemies() ?? [],
        );
```

- [ ] **Step 6: Update the dispose call in `SurvivorsGameplayState.ts`**

Lines 802–803 currently read:
```ts
        this.eliteIndicators?.dispose();
        this.eliteIndicators = null;
```
After:
```ts
        this.offscreenIndicators?.dispose();
        this.offscreenIndicators = null;
```

- [ ] **Step 7: Update the per-frame update call in `SurvivorsGameplayState.ts`**

Lines 978–980 currently read:
```ts
        // Off-screen elite indicators
        if (this.eliteIndicators) this.eliteIndicators.update();
        _measure('eliteInd');
```
After:
```ts
        // Off-screen enemy indicators (all tiers)
        if (this.offscreenIndicators) this.offscreenIndicators.update();
        _measure('offscreenInd');
```

- [ ] **Step 8: Type-check**

Run from repo root:
```bash
npx tsc --noEmit
```
Expected: exits with no output (success).

- [ ] **Step 9: Commit the rename**

```bash
git add src/survivors/ui/OffscreenEnemyIndicators.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "$(cat <<'EOF'
refactor(ui): rename EliteIndicators -> OffscreenEnemyIndicators

Pure rename, no behavior change. Prepares for extending the
indicator system to non-elite enemies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Show dots for all alive enemies with per-tier styling

Replace the body of `OffscreenEnemyIndicators.update()` so every alive enemy is considered (not just elites), and apply boss / elite / regular visuals per the spec.

**Files:**
- Modify: `src/survivors/ui/OffscreenEnemyIndicators.ts` (the entire `update()` body and add one import)

- [ ] **Step 1: Add the `BossEnemy` import**

At the top of `src/survivors/ui/OffscreenEnemyIndicators.ts`, add the import after the existing `Enemy` import. The import block should look like this after the edit:

```ts
import { AdvancedDynamicTexture, Rectangle } from '@babylonjs/gui';
import { Scene, Vector3, Matrix, Camera } from '@babylonjs/core';
import { Enemy } from '../enemies/Enemy';
import { BossEnemy } from '../enemies/BossEnemy';
```

- [ ] **Step 2: Replace the `update()` method**

Replace the entire body of the `update()` method (currently lines 35–104 of the renamed file) with the implementation below. The method signature and the surrounding class members (`active`, `_seen`, `getEnemies`, `scene`, `camera`) stay the same.

```ts
    public update(): void {
        const enemies = this.getEnemies();
        const engine  = this.scene.getEngine();
        const sw      = engine.getRenderWidth();
        const sh      = engine.getRenderHeight();
        this._seen.clear();
        const seen    = this._seen;

        const identityMat  = Matrix.Identity();
        const transformMat = this.scene.getTransformMatrix();
        const vp           = this.camera.viewport.toGlobal(sw, sh);

        for (const e of enemies) {
            if (!e.isAlive()) continue;
            seen.add(e);

            // Project world → screen
            const sp = Vector3.Project(e.getPosition(), identityMat, transformMat, vp);

            // sp.z < 0 means the point is behind the camera
            const onScreen =
                sp.z > 0 &&
                sp.x >= 0 && sp.x <= sw &&
                sp.y >= 0 && sp.y <= sh;

            if (onScreen) {
                // Remove the indicator if the enemy came back on screen
                if (this.active.has(e)) {
                    this.active.get(e)!.dispose();
                    this.active.delete(e);
                }
                continue;
            }

            // Tier detection (boss first so a hypothetical boss+elite stays boss)
            const isBoss  = e instanceof BossEnemy;
            const isElite = !isBoss && e.isElite;

            const size   = isBoss ? 18 : isElite ? 12 : 6;
            const border = isBoss || isElite ? 2 : 0;
            const bg     = isBoss
                ? '#ff3333'
                : isElite
                    ? (ELEMENT_HEX[e.eliteDropElement ?? ''] ?? '#ffffff')
                    : '#aaaaaa';
            const margin = size / 2 + 4;

            // Compute the clamped screen-edge position
            // ADT uses center-origin; convert from top-left screen space.
            const cx = sw / 2;
            const cy = sh / 2;
            const dx = sp.z > 0 ? sp.x - cx : cx - sp.x;  // flip when behind camera
            const dy = sp.z > 0 ? sp.y - cy : cy - sp.y;
            const ang = Math.atan2(dy, dx);
            const ex = cx + Math.cos(ang) * (cx - margin);
            const ey = cy + Math.sin(ang) * (cy - margin);

            let dot = this.active.get(e);
            if (!dot) {
                dot = new Rectangle(`offscreenEnemyDot_${Math.random()}`);
                dot.color = '#ffffff';
                this.ui.addControl(dot);
                this.active.set(e, dot);
            }
            // Style every frame so tier upgrades (e.g. EliteSpawner promoting
            // a regular spawn to elite) immediately reflect in the dot.
            dot.width        = `${size}px`;
            dot.height       = `${size}px`;
            dot.thickness    = border;
            dot.background   = bg;
            dot.cornerRadius = size / 2;
            // Position in ADT space (center-origin)
            dot.left = `${ex - cx}px`;
            dot.top  = `${ey - cy}px`;
        }

        // Clean up stale entries (dead enemies)
        for (const [e, dot] of this.active) {
            if (!seen.has(e)) {
                dot.dispose();
                this.active.delete(e);
            }
        }
    }
```

Notes on what changed vs. the old body:
- The early-out `if (!e.isElite || !e.eliteDropElement)` is gone — every alive enemy is now considered.
- `margin` is now derived from `size` instead of being a hardcoded `28`.
- `dot.background`, `dot.width`, `dot.height`, `dot.thickness`, `dot.cornerRadius` are reassigned every frame (previously only on creation).
- The "stale entries" cleanup comment no longer says "or non-elite" — it's only dead enemies now.

- [ ] **Step 3: Type-check**

Run from repo root:
```bash
npx tsc --noEmit
```
Expected: exits with no output (success).

- [ ] **Step 4: Production build**

Run from repo root:
```bash
npm run build
```
Expected: webpack exits successfully and writes to `dist/`. Warnings about bundle size are fine; errors are not.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/ui/OffscreenEnemyIndicators.ts
git commit -m "$(cat <<'EOF'
feat(ui): show off-screen indicators for all enemies, tiered by type

Regular enemies get a 6px gray dot; elites keep the existing 12px
element-colored dot with white border; bosses get an 18px red dot
with white border. Dot style is reassigned per frame so the elite
upgrade applied post-spawn by EliteSpawner reflects immediately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Manual in-game verification

No automated coverage is possible — the module wraps Babylon GUI controls. Verification is a short play session.

**Files:** none changed.

- [ ] **Step 1: Start the dev server**

Run from repo root:
```bash
npm start
```
Then open `http://localhost:9000` in a browser.

- [ ] **Step 2: Verify regular enemies show gray dots**

Click "Play", pick any champion, wait for wave 1 to spawn (3–4 regular goblins). Walk the hero across the arena until at least one enemy is behind you / off the camera. Confirm a small gray dot (~6px) appears at the matching screen edge and tracks the enemy's bearing. When you turn back so the enemy is on-screen, the dot disappears.

- [ ] **Step 3: Verify elites show the larger element-colored dot**

Survive long enough for an elite to spawn (yellow scale-up enemy; the elite spawner fires periodically — usually within the first few waves). Pull the hero away so the elite is off-screen. Confirm:
- The dot is noticeably bigger than the regulars (~12px).
- The dot color matches the elite's `eliteDropElement` (fire = orange, ice = light blue, arcane = purple, physical = light gray, storm = pale blue).
- The dot has a 2px white border.

- [ ] **Step 4: Verify bosses show the large red dot**

Play through to wave 10 (or whichever wave triggers the first `MilestoneBoss`). Pull the hero away so the boss is off-screen. Confirm:
- The dot is the largest of the three tiers (~18px).
- The dot background is red (`#ff3333`).
- The dot has a 2px white border.

- [ ] **Step 5: Verify cleanup on death**

Kill an enemy that currently has an off-screen dot. Confirm the dot disappears the same frame the enemy dies (no lingering ghost dots).

- [ ] **Step 6: Sanity-check the late-wave density**

Play long enough to reach a wave with 30+ simultaneous enemies. With the hero off near the arena edge, confirm:
- Many dots render simultaneously along the edge nearest the bulk of the swarm.
- Frame rate stays smooth (no obvious stutter). The `_measure('offscreenInd')` timer added to the frame breakdown should not blow up the `totalMs > 50` warning path.

- [ ] **Step 7: Report results to the user**

If any of the above checks failed, describe what was seen vs. expected. If everything passed, say so and confirm the feature is ready.
