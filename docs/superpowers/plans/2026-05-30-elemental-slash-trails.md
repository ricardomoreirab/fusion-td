# Elemental Slash Trails + Element-Colored Damage Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color the barbarian's melee slash trail by the blended set of power elements he carries, and color every floating damage number by the element that dealt it (crits stay gold).

**Architecture:** Introduce one shared element→color palette module as the single source of truth. Thread an optional `element` through `Enemy.takeDamage` → damage callback → `DamageNumberManager`. Tint the existing swing arc/ring and the barbarian axe particle trail from the active-element set, reusing the existing FX lifecycles with strict disposal.

**Tech Stack:** TypeScript, BabylonJS (`Color3`, `ParticleSystem`, `StandardMaterial`), Vitest (pure-logic only).

---

## File Structure

- **New** `src/survivors/ElementColors.ts` — single source of truth: `ELEMENT_HEX`, `ELEMENT_COLOR` (derived), `blendElements()`.
- **New** `tests/ElementColors.spec.ts` — pure-logic Vitest for `blendElements`.
- **Modify** `src/survivors/enemies/Enemy.ts` — `takeDamage(amount, element?)`, callback signature, burn DoT passes `'fire'`.
- **Modify** `src/survivors/DamageNumberManager.ts` — color by `PowerElement` via `ELEMENT_HEX`; crit gold preserved.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — forward element in the damage callback.
- **Modify** `src/survivors/powers/PowerDefinitions.ts` — `PowerContext.element` + `EnchantmentHitContext.element`; power `cast`/`onHit` pass `ctx.element`.
- **Modify** `src/survivors/powers/PowerSlotManager.ts` — set `ctx.element` per slot before each cast; `buildContext` default.
- **Modify** `src/survivors/champions/HeroBasicAttack.ts` — pass `'physical'` on melee/projectile hits; set `ctx.element` per enchantment; tint swing arc/ring from active elements.
- **Modify** `src/survivors/champions/Champion.ts` — snapshot active elements; elemental axe particle ribbons + blended feet-arc tint.
- **DRY refactor** `src/survivors/ui/HeroHud.ts`, `src/survivors/ui/PowerChoiceOverlay.ts`, `src/survivors/powers/PowerDrop.ts` — import the shared palette.

---

## Task 1: Shared element palette module

**Files:**
- Create: `src/survivors/ElementColors.ts`
- Test: `tests/ElementColors.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ElementColors.spec.ts
import { describe, it, expect } from 'vitest';
import { ELEMENT_HEX, ELEMENT_COLOR, blendElements } from '../src/survivors/ElementColors';

describe('ElementColors', () => {
    it('exposes a hex + Color3 entry for every element', () => {
        for (const el of ['fire', 'ice', 'arcane', 'physical', 'storm'] as const) {
            expect(ELEMENT_HEX[el]).toMatch(/^#[0-9a-fA-F]{6}$/);
            expect(ELEMENT_COLOR[el]).toBeDefined();
        }
    });

    it('blends a single element to its own color', () => {
        const fire = ELEMENT_COLOR.fire;
        const blended = blendElements(['fire']);
        expect(blended.r).toBeCloseTo(fire.r, 5);
        expect(blended.g).toBeCloseTo(fire.g, 5);
        expect(blended.b).toBeCloseTo(fire.b, 5);
    });

    it('blends two elements to their component-wise average', () => {
        const blended = blendElements(['fire', 'ice']);
        expect(blended.r).toBeCloseTo((ELEMENT_COLOR.fire.r + ELEMENT_COLOR.ice.r) / 2, 5);
        expect(blended.g).toBeCloseTo((ELEMENT_COLOR.fire.g + ELEMENT_COLOR.ice.g) / 2, 5);
        expect(blended.b).toBeCloseTo((ELEMENT_COLOR.fire.b + ELEMENT_COLOR.ice.b) / 2, 5);
    });

    it('returns a neutral white for an empty set', () => {
        const blended = blendElements([]);
        expect(blended.r).toBeCloseTo(1, 5);
        expect(blended.g).toBeCloseTo(1, 5);
        expect(blended.b).toBeCloseTo(1, 5);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ElementColors.spec.ts`
Expected: FAIL — cannot resolve `../src/survivors/ElementColors`.

- [ ] **Step 3: Write the module**

```typescript
// src/survivors/ElementColors.ts
import { Color3 } from '@babylonjs/core';
import { PowerElement } from './powers/PowerDefinitions';

/**
 * Single source of truth for the 5-element palette. The hex map is the canonical
 * UI color (used by HeroHud, PowerChoiceOverlay, damage numbers); the Color3 map
 * is derived from it so 3D FX and UI never drift apart.
 */
export const ELEMENT_HEX: Record<PowerElement, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

export const ELEMENT_COLOR: Record<PowerElement, Color3> = {
    fire:     Color3.FromHexString(ELEMENT_HEX.fire),
    ice:      Color3.FromHexString(ELEMENT_HEX.ice),
    arcane:   Color3.FromHexString(ELEMENT_HEX.arcane),
    physical: Color3.FromHexString(ELEMENT_HEX.physical),
    storm:    Color3.FromHexString(ELEMENT_HEX.storm),
};

/**
 * Component-wise average of the given elements' colors. Empty set → neutral
 * white. Used to tint the barbarian's blended slash arc.
 */
export function blendElements(elements: PowerElement[]): Color3 {
    if (elements.length === 0) return new Color3(1, 1, 1);
    let r = 0, g = 0, b = 0;
    for (const el of elements) {
        const c = ELEMENT_COLOR[el];
        r += c.r; g += c.g; b += c.b;
    }
    const n = elements.length;
    return new Color3(r / n, g / n, b / n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ElementColors.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/ElementColors.ts tests/ElementColors.spec.ts
git commit -m "feat(survivors): shared element color palette + blend helper"
```

---

## Task 2: Thread element through Enemy.takeDamage + callback

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts` (callback type ~81, `takeDamage` ~1120, burn tick ~861)

- [ ] **Step 1: Import PowerElement**

At the top of `Enemy.ts`, add to the existing imports (near the `GameTypes` import):

```typescript
import { PowerElement } from '../powers/PowerDefinitions';
```

- [ ] **Step 2: Widen the damage callback type**

Replace line ~81:

```typescript
    public static onDamageCallback: ((position: Vector3, damage: number, isCrit: boolean) => void) | null = null;
```

with:

```typescript
    public static onDamageCallback: ((position: Vector3, damage: number, isCrit: boolean, element?: PowerElement) => void) | null = null;
```

- [ ] **Step 3: Accept + forward element in takeDamage**

Replace the signature line:

```typescript
    public takeDamage(amount: number): boolean {
```

with:

```typescript
    public takeDamage(amount: number, element?: PowerElement): boolean {
```

And replace the callback invocation (~line 1151):

```typescript
        const dmgCb = Enemy.onDamageCallback;
        if (dmgCb) dmgCb(this.position, actualDamage, isCrit);
```

with:

```typescript
        const dmgCb = Enemy.onDamageCallback;
        if (dmgCb) dmgCb(this.position, actualDamage, isCrit, element);
```

- [ ] **Step 4: Burn DoT is fire-colored**

Replace the burn tick (~line 861):

```typescript
            this.takeDamage(this.burnDamagePerTick);
```

with:

```typescript
            this.takeDamage(this.burnDamagePerTick, 'fire');
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from `Enemy.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/survivors/enemies/Enemy.ts
git commit -m "feat(survivors): thread optional element through Enemy.takeDamage"
```

---

## Task 3: Color the damage numbers by element

**Files:**
- Modify: `src/survivors/DamageNumberManager.ts`
- Modify: `src/survivors/SurvivorsGameplayState.ts` (callback ~472)

- [ ] **Step 1: Swap legacy ElementType for the shared palette**

In `DamageNumberManager.ts`, replace the import line:

```typescript
import { ElementType } from './GameTypes';
```

with:

```typescript
import { PowerElement } from './powers/PowerDefinitions';
import { ELEMENT_HEX } from './ElementColors';
```

- [ ] **Step 2: Update `showDamage` signature + color logic**

Replace the `showDamage` signature block:

```typescript
    public showDamage(
        position: Vector3,
        damage: number,
        elementType: ElementType = ElementType.NONE,
        isCrit: boolean = false,
    ): void {
        const slot = this.acquireSlot();
        const color = isCrit ? '#FFD000' : this.getColorForElement(elementType);
```

with:

```typescript
    public showDamage(
        position: Vector3,
        damage: number,
        element?: PowerElement,
        isCrit: boolean = false,
    ): void {
        const slot = this.acquireSlot();
        const color = isCrit ? '#FFD000' : this.getColorForElement(element);
```

- [ ] **Step 3: Replace `getColorForElement`**

Replace the whole legacy method:

```typescript
    private getColorForElement(elementType: ElementType): string {
        switch (elementType) {
            case ElementType.FIRE: return '#FF6633';
            case ElementType.WATER: return '#3399FF';
            case ElementType.WIND: return '#99FF66';
            case ElementType.EARTH: return '#CC9933';
            default: return '#FFFFFF';
        }
    }
```

with:

```typescript
    private getColorForElement(element?: PowerElement): string {
        return element ? ELEMENT_HEX[element] : '#FFFFFF';
    }
```

- [ ] **Step 4: Forward element from the damage callback**

In `SurvivorsGameplayState.ts`, replace (~line 472):

```typescript
        Enemy.onDamageCallback = (position, damage, isCrit) => {
            this.damageNumbers?.showDamage(position, damage, undefined, isCrit);
```

with:

```typescript
        Enemy.onDamageCallback = (position, damage, isCrit, element) => {
            this.damageNumbers?.showDamage(position, damage, element, isCrit);
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (All numbers still render white until sources pass an element — that happens in Tasks 4–5.)

- [ ] **Step 6: Commit**

```bash
git add src/survivors/DamageNumberManager.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(survivors): color damage numbers by power element"
```

---

## Task 4: Power + enchantment damage sources pass their element

**Files:**
- Modify: `src/survivors/powers/PowerDefinitions.ts` (context types + cast/onHit damage sites)
- Modify: `src/survivors/powers/PowerSlotManager.ts` (set `ctx.element` per cast)

- [ ] **Step 1: Add `element` to the context interfaces**

In `PowerDefinitions.ts`, in `PowerContext` add a field:

```typescript
export interface PowerContext {
    scene: Scene;
    heroPosition: Vector3;
    enemies: Enemy[];
    /** Combined damage multiplier from run perks + shop upgrades */
    damageMultiplier: number;
    /** Element of the casting power — colors the damage numbers it produces. */
    element: PowerElement;
}
```

And in `EnchantmentHitContext` add:

```typescript
export interface EnchantmentHitContext {
    scene: Scene;
    heroPosition: Vector3;
    enemies: Enemy[];
    /** Base damage of the basic attack (before multipliers). */
    baseDamage: number;
    /** Element of the active enchantment — colors its proc damage numbers. */
    element: PowerElement;
}
```

- [ ] **Step 2: Populate `ctx.element` in PowerSlotManager**

In `PowerSlotManager.ts`, in `buildContext()` add a default so the type is satisfied:

```typescript
    private buildContext(): PowerContext {
        return {
            scene: this.scene,
            heroPosition: this.heroProvider(),
            enemies: this.enemyProvider(),
            damageMultiplier: this.damageMultiplierProvider(),
            element: 'physical',
        };
    }
```

In the autocast loop, set the per-slot element right before the cast (~line 190-192):

```typescript
                if (slot.def.cast) {
                    if (!ctx) ctx = this.buildContext();
                    ctx.element = slot.def.element;
                    slot.def.cast(slot.state, ctx);
                }
```

And in `forceCastAutocastSlots` (~line 211-212):

```typescript
            if (!slot.def.cast) continue;
            ctx.element = slot.def.element;
            slot.def.cast(slot.state, ctx);
```

- [ ] **Step 3: Pass `ctx.element` at every power damage site**

In `PowerDefinitions.ts`, every `cast` closure has `ctx` (PowerContext) in scope and every `onHit` closure has `ctx` (EnchantmentHitContext) in scope. Change each enemy-damage call to pass `ctx.element`. The damage variable name differs per site; the edit is uniform — add `, ctx.element` as the second argument:

- `target.takeDamage(damage)` → `target.takeDamage(damage, ctx.element)` (sites near lines 316, 399, 964, 1158)
- `e.takeDamage(damage)` → `e.takeDamage(damage, ctx.element)` (sites near lines 440, 563, 756, 859, 1054)
- `current.takeDamage(damage)` → `current.takeDamage(damage, ctx.element)` (~614)
- `next.takeDamage(damage * 0.75)` → `next.takeDamage(damage * 0.75, ctx.element)` (~629)
- `nearest.takeDamage(chainDamage)` → `nearest.takeDamage(chainDamage, ctx.element)` (~1191 in a cast, and ~1331 inside the Shock Chain `onHit`)
- `enemy.takeDamage(bonusDamage)` → `enemy.takeDamage(bonusDamage, ctx.element)` (Arcane Bite ~1271, Heavy Strike ~1294)

Verify none are missed:

Run: `grep -n "takeDamage(" src/survivors/powers/PowerDefinitions.ts`
Expected: every match that targets an enemy passes a second `ctx.element` argument.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If `EnchantmentHitContext.element` is reported missing at the `applyEnchantments` construction site, that is fixed in Task 5 Step 2 — proceed only if the sole error is there; otherwise it should already build because Task 5 has not run yet. To keep this task green, also do Task 5 Step 2 now if tsc flags the missing field.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/powers/PowerDefinitions.ts src/survivors/powers/PowerSlotManager.ts
git commit -m "feat(survivors): power casts + enchantments tag damage with their element"
```

---

## Task 5: Basic melee/projectile element + enchantment context wiring

**Files:**
- Modify: `src/survivors/champions/HeroBasicAttack.ts`
- Modify: `src/survivors/SurvivorsGameplayState.ts` (BasicAttackTarget at ~1641)

- [ ] **Step 1: Import PowerElement + widen BasicAttackTarget**

In `HeroBasicAttack.ts`, change the import:

```typescript
import { EnchantmentHitContext } from '../powers/PowerDefinitions';
```

to:

```typescript
import { EnchantmentHitContext, PowerElement } from '../powers/PowerDefinitions';
```

And widen the target interface:

```typescript
export interface BasicAttackTarget {
    position: Vector3;
    takeDamage: (amount: number, element?: PowerElement) => void;
    isAlive: () => boolean;
}
```

- [ ] **Step 2: Set `ctx.element` per enchantment in `applyEnchantments`**

Replace the ctx construction + loop (~lines 595-609):

```typescript
        const ctx: EnchantmentHitContext = {
            scene: this.scene,
            heroPosition: heroPos,
            enemies: allEnemies,
            baseDamage: this.effectiveDamage,
        };

        for (const enc of enchantments) {
            if (enc.slot.def.onHit) {
                enc.slot.def.onHit(enemy, enc.level, ctx);
            }
        }
```

with:

```typescript
        const ctx: EnchantmentHitContext = {
            scene: this.scene,
            heroPosition: heroPos,
            enemies: allEnemies,
            baseDamage: this.effectiveDamage,
            element: 'physical',
        };

        for (const enc of enchantments) {
            if (enc.slot.def.onHit) {
                ctx.element = enc.slot.def.element;
                enc.slot.def.onHit(enemy, enc.level, ctx);
            }
        }
```

- [ ] **Step 3: Basic melee hit is physical**

In `applyHit` (~line 279), replace:

```typescript
        e.takeDamage(dmg);
```

with:

```typescript
        e.takeDamage(dmg, 'physical');
```

- [ ] **Step 4: Projectile hit is physical**

In the projectile observer (~line 542), replace:

```typescript
                target.takeDamage(capturedDamage);
```

with:

```typescript
                target.takeDamage(capturedDamage, 'physical');
```

- [ ] **Step 5: Forward element through the BasicAttackTarget shim**

In `SurvivorsGameplayState.ts` `getNearestEnemy()` (~line 1641), replace:

```typescript
            takeDamage: (n) => captured.takeDamage(n),
```

with:

```typescript
            takeDamage: (n, element) => captured.takeDamage(n, element),
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/survivors/champions/HeroBasicAttack.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(survivors): basic melee/projectile + enchant procs color damage numbers"
```

---

## Task 6: Tint the swing arc/ring by blended elements

**Files:**
- Modify: `src/survivors/champions/HeroBasicAttack.ts` (`spawnSwingRing` ~315-372)

- [ ] **Step 1: Import the palette + StandardMaterial**

In `HeroBasicAttack.ts`, extend the Babylon import to include `StandardMaterial` (it currently imports `Color3` etc.):

```typescript
import { Scene, Vector3, MeshBuilder, Mesh, Color3, StandardMaterial } from '@babylonjs/core';
```

Add the palette import near the others:

```typescript
import { blendElements } from '../ElementColors';
```

- [ ] **Step 2: Compute the active-element tint at the top of `spawnSwingRing`**

At the start of `spawnSwingRing(center, range)`, before building the ring, compute whether to use an elemental tint. The barbarian is the only champion whose slash is themed; other champions keep gold.

```typescript
    private spawnSwingRing(center: Vector3, range: number): void {
        // Barbarian-only elemental tint: blend the colors of every active power
        // element. No elements (or non-barbarian) → the classic gold arc.
        const active = (this.powerSlots && (this.hero as any).championType === 'barbarian')
            ? Array.from(this.powerSlots.getActiveElements())
            : [];
        const elemental = active.length > 0;
        const tint = elemental ? blendElements(active) : null;
```

- [ ] **Step 3: Build the ring material from the tint**

Replace the ring material block:

```typescript
        const ringMat = getCachedMaterial(this.scene, 'swingRingMat', m => {
            m.emissiveColor = new Color3(1, 0.85, 0.4);
            m.diffuseColor = new Color3(0, 0, 0);
            m.alpha = 0.9;
        });
        ring.material = ringMat;
```

with:

```typescript
        let ringMat: StandardMaterial;
        if (tint) {
            // Fresh per-swing material so we never mutate the shared cached gold
            // material in place (it is frozen + shared across concurrent swings).
            // Disposed in the sweep cleanup below alongside the mesh.
            ringMat = new StandardMaterial('swingRingMatElem', this.scene);
            ringMat.emissiveColor = tint.scale(1.1);
            ringMat.diffuseColor = new Color3(0, 0, 0);
            ringMat.disableLighting = true;
            ringMat.alpha = 0.9;
        } else {
            ringMat = getCachedMaterial(this.scene, 'swingRingMat', m => {
                m.emissiveColor = new Color3(1, 0.85, 0.4);
                m.diffuseColor = new Color3(0, 0, 0);
                m.alpha = 0.9;
            });
        }
        ring.material = ringMat;
```

- [ ] **Step 4: Build the arc material from the tint**

Replace the arc material block:

```typescript
        const arcMat = getCachedMaterial(this.scene, 'swingArcMat', m => {
            m.emissiveColor = new Color3(1, 0.95, 0.7);
            m.diffuseColor = new Color3(0, 0, 0);
            m.alpha = 0.5;
        });
        arc.material = arcMat;
```

with:

```typescript
        let arcMat: StandardMaterial;
        if (tint) {
            arcMat = new StandardMaterial('swingArcMatElem', this.scene);
            arcMat.emissiveColor = tint.scale(1.25);
            arcMat.diffuseColor = new Color3(0, 0, 0);
            arcMat.disableLighting = true;
            arcMat.alpha = 0.5;
        } else {
            arcMat = getCachedMaterial(this.scene, 'swingArcMat', m => {
                m.emissiveColor = new Color3(1, 0.95, 0.7);
                m.diffuseColor = new Color3(0, 0, 0);
                m.alpha = 0.5;
            });
        }
        arc.material = arcMat;
```

- [ ] **Step 5: Dispose the per-swing materials in the sweep cleanup**

In the `onBeforeRenderObservable` cleanup branch, replace:

```typescript
            if (t >= 1) {
                ring.dispose();
                arc.dispose();
                this.scene.onBeforeRenderObservable.remove(observer);
            }
```

with:

```typescript
            if (t >= 1) {
                ring.dispose();
                arc.dispose();
                // Per-swing elemental materials must be freed with their meshes;
                // the shared cached gold materials must NOT be disposed.
                if (elemental) {
                    ringMat.dispose();
                    arcMat.dispose();
                }
                this.scene.onBeforeRenderObservable.remove(observer);
            }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/survivors/champions/HeroBasicAttack.ts
git commit -m "feat(survivors): tint barbarian swing arc/ring by blended elements"
```

---

## Task 7: Elemental axe particle ribbons + feet-arc tint

**Files:**
- Modify: `src/survivors/champions/Champion.ts` (fields ~75-105, `updateElementVisuals` ~1773, `startBarbSpinFx` ~205, `tickBarbSpinFx` ~1441)

- [ ] **Step 1: Add an active-element snapshot field + elemental PS list**

Near the existing barb-spin fields (~lines 75-83), add:

```typescript
    // Latest active power elements, snapshotted each frame from updateElementVisuals.
    private activeElementSnapshot: string[] = [];
    // Elemental axe-trail particle systems created per spin (one per active element).
    private barbSpinElemPs: ParticleSystem[] = [];
```

- [ ] **Step 2: Snapshot the active elements in `updateElementVisuals`**

At the top of `updateElementVisuals(activeElements)` (~line 1773), after the early returns are fine to keep, record the snapshot first:

```typescript
    public updateElementVisuals(activeElements: Set<string>): void {
        this.activeElementSnapshot = Array.from(activeElements);
        if (!this.mesh) return;
```

- [ ] **Step 3: Import the palette in Champion.ts**

Add near the other survivors imports at the top of `Champion.ts`:

```typescript
import { ELEMENT_COLOR, blendElements } from '../ElementColors';
import { PowerElement } from '../powers/PowerDefinitions';
```

- [ ] **Step 4: Spawn one element-colored ribbon per active element**

In `startBarbSpinFx()`, replace the single hardcoded red blood block:

```typescript
        // ===== Red blood-trail particle system attached to the axe head =====
        if (this.barbAxeHead && !this.barbSpinBloodPs) {
            const ps = new ParticleSystem('barbSpinBlood', 60, this.scene);
            ps.emitter = this.barbAxeHead;
            ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
            ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
            ps.color1 = new Color4(0.7, 0.10, 0.05, 1);
            ps.color2 = new Color4(0.45, 0.05, 0.02, 1);
            ps.colorDead = new Color4(0.10, 0.0, 0.0, 0);
            ps.minSize = 0.10;
            ps.maxSize = 0.30;
            ps.minLifeTime = 0.1;
            ps.maxLifeTime = 0.2;
            ps.emitRate = 240;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.direction1 = new Vector3(-1, 0.2, -1);
            ps.direction2 = new Vector3(1, 1.2, 1);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 3;
            ps.gravity = new Vector3(0, -3, 0);
            ps.start();
            this.barbSpinBloodPs = ps;
        }
```

with:

```typescript
        // ===== Axe-head trail particles =====
        // With active power elements: one colored ribbon per element (layered →
        // reads as a blended multi-element trail). No elements: the classic red
        // blood trail. Both attach to the axe head and are torn down on spin end.
        const elems = this.activeElementSnapshot as PowerElement[];
        if (this.barbAxeHead && elems.length > 0 && this.barbSpinElemPs.length === 0) {
            for (const el of elems) {
                const c = ELEMENT_COLOR[el];
                if (!c) continue;
                const ps = new ParticleSystem(`barbSpinElem_${el}`, 48, this.scene);
                ps.emitter = this.barbAxeHead;
                ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
                ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
                ps.color1 = new Color4(c.r, c.g, c.b, 1);
                ps.color2 = new Color4(c.r * 0.6, c.g * 0.6, c.b * 0.6, 1);
                ps.colorDead = new Color4(c.r * 0.2, c.g * 0.2, c.b * 0.2, 0);
                ps.minSize = 0.10;
                ps.maxSize = 0.30;
                ps.minLifeTime = 0.1;
                ps.maxLifeTime = 0.22;
                ps.emitRate = 200;
                ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
                ps.direction1 = new Vector3(-1, 0.2, -1);
                ps.direction2 = new Vector3(1, 1.2, 1);
                ps.minEmitPower = 1;
                ps.maxEmitPower = 3;
                ps.gravity = new Vector3(0, -3, 0);
                ps.start();
                this.barbSpinElemPs.push(ps);
            }
        } else if (this.barbAxeHead && elems.length === 0 && !this.barbSpinBloodPs) {
            const ps = new ParticleSystem('barbSpinBlood', 60, this.scene);
            ps.emitter = this.barbAxeHead;
            ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
            ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
            ps.color1 = new Color4(0.7, 0.10, 0.05, 1);
            ps.color2 = new Color4(0.45, 0.05, 0.02, 1);
            ps.colorDead = new Color4(0.10, 0.0, 0.0, 0);
            ps.minSize = 0.10;
            ps.maxSize = 0.30;
            ps.minLifeTime = 0.1;
            ps.maxLifeTime = 0.2;
            ps.emitRate = 240;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.direction1 = new Vector3(-1, 0.2, -1);
            ps.direction2 = new Vector3(1, 1.2, 1);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 3;
            ps.gravity = new Vector3(0, -3, 0);
            ps.start();
            this.barbSpinBloodPs = ps;
        }
```

- [ ] **Step 5: Tint the feet arc ring from the blend**

Still in `startBarbSpinFx()`, replace the hardcoded ring material line:

```typescript
            ring.material = createEmissiveMaterial('barbSpinArcRingMat',
                new Color3(0.8, 0.10, 0.05), 0.9, this.scene);
```

with:

```typescript
            const arcBase = elems.length > 0
                ? blendElements(elems)
                : new Color3(0.8, 0.10, 0.05);
            ring.material = createEmissiveMaterial('barbSpinArcRingMat',
                arcBase, 0.9, this.scene);
            this.barbSpinArcColor.copyFrom(arcBase);
```

Note: `barbSpinArcColor` is reused by `tickBarbSpinFx` for the fade; seeding it from the blend keeps the fade in the element hue. See Step 6.

- [ ] **Step 6: Fade the feet ring in its own hue (not hardcoded red)**

In `tickBarbSpinFx` (~lines 1453-1462), the fade currently hardcodes red channel math. Replace:

```typescript
            const mat = this.barbSpinArcMesh.material as StandardMaterial | null;
            if (mat) {
                const intensity = 0.9 * (1 - t);
                this.barbSpinArcColor.set(
                    0.8 * (1 - t * 0.5) * intensity,
                    0.10 * intensity,
                    0.05 * intensity,
                );
                mat.emissiveColor = this.barbSpinArcColor;
                mat.alpha = 1 - t;
            }
```

with:

```typescript
            const mat = this.barbSpinArcMesh.material as StandardMaterial | null;
            if (mat) {
                // Fade the ring toward black in whatever base hue it was seeded
                // with (blended element color, or red when no elements).
                const k = (1 - t);
                mat.emissiveColor = this.barbSpinArcBaseColor.scale(k);
                mat.alpha = 1 - t;
            }
```

To support this, add a base-color field next to `barbSpinArcColor` (~line 83):

```typescript
    private barbSpinArcColor: Color3 = new Color3(0, 0, 0);
    private barbSpinArcBaseColor: Color3 = new Color3(0.8, 0.10, 0.05);
```

And in Step 5, set the base color too — update the Step 5 replacement's last line to:

```typescript
            this.barbSpinArcBaseColor.copyFrom(arcBase);
```

(Replace the `this.barbSpinArcColor.copyFrom(arcBase);` line from Step 5 with the base-color assignment above — the fade reads `barbSpinArcBaseColor`.)

- [ ] **Step 7: Stop + dispose the elemental ribbons on spin end**

In `tickBarbSpinFx`, replace the blood-PS teardown block:

```typescript
        // Stop the blood trail when the spin ends
        if (this.barbSpinBloodPs && this.spinAttackTimer <= 0) {
            this.barbSpinBloodPs.stop();
            const ps = this.barbSpinBloodPs;
            this.barbSpinBloodPs = null;
            setTimeout(() => ps.dispose(), 400);
        }
```

with:

```typescript
        // Stop the axe trails when the spin ends (blood + every elemental ribbon).
        if (this.barbSpinBloodPs && this.spinAttackTimer <= 0) {
            this.barbSpinBloodPs.stop();
            const ps = this.barbSpinBloodPs;
            this.barbSpinBloodPs = null;
            setTimeout(() => ps.dispose(), 400);
        }
        if (this.barbSpinElemPs.length > 0 && this.spinAttackTimer <= 0) {
            const list = this.barbSpinElemPs;
            this.barbSpinElemPs = [];
            for (const ps of list) {
                ps.stop();
                setTimeout(() => ps.dispose(), 400);
            }
        }
```

- [ ] **Step 8: Dispose elemental ribbons on Champion teardown**

Find the Champion teardown that disposes `barbSpinBloodPs` (search `barbSpinBloodPs` for a dispose outside `tickBarbSpinFx`; if the only references are `startBarbSpinFx`/`tickBarbSpinFx`, add a guard in the existing `_releaseMeshAndAnimations`/`dispose` path). Add alongside the existing particle cleanup:

```typescript
        for (const ps of this.barbSpinElemPs) ps.dispose();
        this.barbSpinElemPs = [];
        if (this.barbSpinBloodPs) { this.barbSpinBloodPs.dispose(); this.barbSpinBloodPs = null; }
```

Run: `grep -n "barbSpinBloodPs\|barbFootDustPs\|_releaseMeshAndAnimations\|dispose()" src/survivors/champions/Champion.ts | head`
Expected: locate the teardown method; place the cleanup there. If `barbSpinBloodPs` was never disposed on teardown before, this also closes that pre-existing gap.

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/survivors/champions/Champion.ts
git commit -m "feat(survivors): elemental axe trail ribbons + blended spin-ring tint"
```

---

## Task 8: DRY refactor of the duplicated element color maps

**Files:**
- Modify: `src/survivors/ui/HeroHud.ts`
- Modify: `src/survivors/ui/PowerChoiceOverlay.ts`
- Modify: `src/survivors/powers/PowerDrop.ts`

- [ ] **Step 1: HeroHud uses the shared hex map**

In `HeroHud.ts`, remove the local map:

```typescript
const ELEMENT_COLOR: Record<string, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};
```

and import the shared one (add near the top imports), aliasing to the existing name so call sites are untouched:

```typescript
import { ELEMENT_HEX as ELEMENT_COLOR } from '../ElementColors';
```

- [ ] **Step 2: PowerChoiceOverlay uses the shared hex map**

In `PowerChoiceOverlay.ts`, remove the identical local `ELEMENT_COLOR` map and add:

```typescript
import { ELEMENT_HEX as ELEMENT_COLOR } from '../ElementColors';
```

- [ ] **Step 3: PowerDrop uses the shared Color3 map**

In `PowerDrop.ts`, remove the local map:

```typescript
const ELEMENT_COLORS: Record<string, Color3> = {
    fire:     new Color3(1, 0.4, 0),
    ice:      new Color3(0.3, 0.7, 1),
    arcane:   new Color3(0.8, 0.3, 1),
    physical: new Color3(0.9, 0.9, 0.9),
    storm:    new Color3(0.8, 0.8, 1),
};
```

and add:

```typescript
import { ELEMENT_COLOR as ELEMENT_COLORS } from '../ElementColors';
```

If `Color3` becomes an unused import after this, leave it only if still referenced elsewhere in the file; otherwise remove it from the import to keep tsc clean.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no unused-symbol or missing-symbol errors).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/ui/HeroHud.ts src/survivors/ui/PowerChoiceOverlay.ts src/survivors/powers/PowerDrop.ts
git commit -m "refactor(survivors): single source of truth for element colors"
```

---

## Task 9: Full verification

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 2: Run the unit tests**

Run: `npm test`
Expected: PASS — existing specs + the new `ElementColors.spec.ts`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: webpack build succeeds, `dist/` emitted.

- [ ] **Step 4: Manual smoke (record results)**

Run: `npm start`, open `localhost:9000`, pick **Barbarian**.
- Equip a fire power → slash arc + axe sparks are orange; basic-melee numbers orange-ish white (physical) and fire procs/burn orange.
- Equip fire + ice → arc tint blended; axe sparks show distinct orange AND cyan streaks.
- Cast fireball → orange numbers; frost → cyan; lightning → yellow; crit → gold regardless.
- Survive a few waves, pause/resume, die → restart: no progressive freeze, no black screen (confirms no leaked materials/particles).

- [ ] **Step 5: Final commit if any tweaks were needed**

```bash
git add -A
git commit -m "chore(survivors): elemental slash trail polish + verification"
```

---

## Self-Review

- **Spec coverage:** Shared palette (Task 1) ✓; damage-number threading via `takeDamage(element?)` (Tasks 2-5) ✓; powers/melee/enchant/burn sources (Tasks 2,4,5) ✓; crit stays gold (Task 3 keeps `#FFD000`) ✓; barbarian blended arc tint (Task 6) ✓; per-element axe ribbons + red fallback (Task 7) ✓; leak discipline — per-swing material dispose (Task 6 Step 5), ribbon stop+dispose on spin end + teardown (Task 7 Steps 7-8) ✓; DRY refactor (Task 8) ✓; Vitest for blend + tsc + manual (Tasks 1, 9) ✓.
- **Type consistency:** `PowerElement` imported wherever used (Enemy, DamageNumberManager, HeroBasicAttack, Champion). `element` is optional on `takeDamage`/callback/`showDamage`/`BasicAttackTarget`, required on `PowerContext`/`EnchantmentHitContext` (always set before use, default `'physical'` in builders). `blendElements(PowerElement[])` called with `string[]` snapshots cast to `PowerElement[]` in Champion (Task 7 Step 4) and with real `PowerElement[]` from `getActiveElements()` in HeroBasicAttack (Task 6 Step 2).
- **Placeholder scan:** none — every code step shows full content.
