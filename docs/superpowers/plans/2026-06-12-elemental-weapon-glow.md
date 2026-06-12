# Elemental Weapon Glow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static crystal/cone/orb weapon decorations with a glow look — an emissive element tint on the weapon mesh plus stacked per-element particle auras (and flickering bolts for storm).

**Architecture:** All changes live in `src/survivors/champions/Champion.ts`. The existing per-frame entry point `updateElementVisuals(activeElements)` (called from `SurvivorsGameplayState.ts:3068`) keeps its signature; internally it now drives (1) a weapon material tint for procedural champions, (2) one lazily-created `ParticleSystem` per active element anchored at `getWeaponAnchor()`, (3) three flickering bolt meshes when storm is active. All new materials are **unique per champion instance** (never `getCachedMaterial`) because `flashHitRed()` mutates child-mesh `emissiveColor` in place; everything is disposed in `_releaseChampionFx()` exactly like the old decorations were.

**Tech Stack:** BabylonJS `ParticleSystem` (additive blend, no texture — matches existing spin-trail style), `ELEMENT_COLOR`/`blendElements` from `src/survivors/ElementColors.ts`.

**Spec:** `docs/superpowers/specs/2026-06-12-elemental-weapon-glow-design.md`

**Testing note:** This is pure Babylon visuals — outside the Vitest pure-logic scope (per project convention, no unit tests for scene FX). Verification is `npx tsc --noEmit`, the existing Vitest suite (regression), and a headless Playwright run with the resource watchdog.

---

### Task 1: Replace the decoration system in Champion.ts

**Files:**
- Modify: `src/survivors/champions/Champion.ts` (imports ~line 1, fields ~line 113, `updateElementVisuals`/`createElementDecoration` lines 1952–2070, `_releaseChampionFx` lines 1808–1846)

- [ ] **Step 1: Update imports**

Add `Material` to the `@babylonjs/core` import on line 1:

```typescript
import { Vector3, MeshBuilder, Mesh, Color3, Color4, ParticleSystem, StandardMaterial, AssetContainer, AnimationGroup, TransformNode, PointLight, Material } from '@babylonjs/core';
```

(`createEmissiveMaterial`, `makeFlatShaded`, `ELEMENT_COLOR`, `blendElements`, `PowerElement` are already imported and still used.)

- [ ] **Step 2: Replace the decoration field**

Replace lines 113–114:

```typescript
    // Per-element weapon decoration meshes, created lazily on first activation
    private elementDecorations: Map<string, Mesh[]> = new Map();
```

with:

```typescript
    // Per-element weapon aura particle systems, created lazily on first activation.
    private elementAuraPs: Map<string, ParticleSystem> = new Map();
    // Storm-only flickering bolt meshes + their shared (per-champion) material.
    private stormBolts: Mesh[] = [];
    private stormBoltMat: StandardMaterial | null = null;
    private stormFlickerTimer: number = 0;
    // Weapon tint — ONE unfrozen emissive material per champion instance,
    // recolored in place as the active element combo changes. Deliberately NOT a
    // shared cached material: flashHitRed() mutates mesh materials' emissiveColor.
    private weaponTintMat: StandardMaterial | null = null;
    private weaponOrigMat: { mesh: Mesh; mat: Material | null } | null = null;
    private weaponTintKey: string | null = null;
```

- [ ] **Step 3: Rewrite `updateElementVisuals` and replace `createElementDecoration`**

Replace everything from `public updateElementVisuals` (line 1956) through the end of `createElementDecoration` (line 2069) with:

```typescript
    /**
     * Drive the elemental weapon-glow visuals: an emissive tint on the weapon
     * mesh (procedural champions) plus one particle aura per active element,
     * and flickering bolt meshes while storm is active.
     * Call once per frame with the set of active power elements.
     */
    public updateElementVisuals(activeElements: Set<string>): void {
        this.activeElementSnapshot = Array.from(activeElements);
        if (!this.mesh) return;
        const anchor = this.getWeaponAnchor();
        if (!anchor) return;

        this.updateWeaponTint(activeElements);

        const allElements: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];
        for (const element of allElements) {
            const shouldShow = activeElements.has(element);
            let ps = this.elementAuraPs.get(element);
            if (shouldShow && !ps) {
                ps = this.createElementAura(element, anchor);
                this.elementAuraPs.set(element, ps);
            }
            if (ps) {
                if (shouldShow && !ps.isStarted()) ps.start();
                else if (!shouldShow && ps.isStarted()) ps.stop();
            }
        }

        const stormActive = activeElements.has('storm');
        if (stormActive && this.stormBolts.length === 0) {
            this.createStormBolts(anchor);
        }
        if (this.stormBolts.length > 0) {
            for (const b of this.stormBolts) b.setEnabled(stormActive);
            if (stormActive) this.flickerStormBolts(this.lastDeltaTime);
        }
    }

    private getWeaponAnchor(): Mesh | null {
        if (this.glbWeaponAnchor && !this.glbWeaponAnchor.isDisposed()) {
            return this.glbWeaponAnchor;
        }
        switch (this.championType) {
            case 'barbarian': return this.barbAxeHead ?? this.swordArm;
            case 'ranger':    return this.rangerBow ?? this.swordArm;
            case 'mage':      return this.mageStaffOrb ?? this.swordArm;
        }
        return null;
    }

    /** Tint the procedural weapon mesh with the blended element color ("the axe
     *  is frozen / burning"). GLB champions skip this — their weapon is baked
     *  into the skinned mesh, so the particle aura alone carries the effect.
     *  While tinted, the mage orb's idle pulse writes to the detached
     *  mageOrbMat (harmless); it resumes if all elements are removed. */
    private updateWeaponTint(activeElements: Set<string>): void {
        let weapon: Mesh | null = null;
        switch (this.championType) {
            case 'barbarian': weapon = this.barbAxeHead; break;
            case 'ranger':    weapon = this.rangerBow; break;
            case 'mage':      weapon = this.mageStaffOrb; break;
        }
        if (!weapon || weapon.isDisposed()) return;

        const key = Array.from(activeElements).sort().join('+');
        if (key === this.weaponTintKey) return;
        this.weaponTintKey = key;

        if (key === '') {
            if (this.weaponOrigMat && this.weaponOrigMat.mesh === weapon) {
                weapon.material = this.weaponOrigMat.mat;
            }
            return;
        }

        const blend = blendElements(this.activeElementSnapshot as PowerElement[]);
        if (!this.weaponTintMat) {
            this.weaponTintMat = new StandardMaterial(
                `heroWeaponTint_${this.championType}`, this.scene);
            this.weaponTintMat.specularColor = Color3.Black();
        }
        this.weaponTintMat.emissiveColor.copyFrom(blend).scaleInPlace(0.85);
        this.weaponTintMat.diffuseColor.copyFrom(blend).scaleInPlace(0.35);
        if (weapon.material !== this.weaponTintMat) {
            if (!this.weaponOrigMat) {
                this.weaponOrigMat = { mesh: weapon, mat: weapon.material };
            }
            weapon.material = this.weaponTintMat;
        }
    }

    /** One small persistent additive particle aura per element, anchored at the
     *  weapon. Untextured square particles — same style as the spin trails. */
    private createElementAura(element: PowerElement, anchor: Mesh): ParticleSystem {
        const c = ELEMENT_COLOR[element];
        const ps = new ParticleSystem(`heroAura_${element}`, 32, this.scene);
        ps.emitter = anchor;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.color1 = new Color4(c.r, c.g, c.b, 1);
        ps.color2 = new Color4(c.r * 0.7, c.g * 0.7, c.b * 0.7, 1);
        ps.colorDead = new Color4(c.r * 0.15, c.g * 0.15, c.b * 0.15, 0);
        ps.minEmitBox = new Vector3(-0.22, -0.05, -0.22);
        ps.maxEmitBox = new Vector3(0.22, 0.35, 0.22);
        ps.gravity = Vector3.Zero();
        switch (element) {
            case 'fire': // rising embers
                ps.minSize = 0.06; ps.maxSize = 0.16;
                ps.minLifeTime = 0.35; ps.maxLifeTime = 0.7;
                ps.emitRate = 26;
                ps.direction1 = new Vector3(-0.25, 0.6, -0.25);
                ps.direction2 = new Vector3(0.25, 1.3, 0.25);
                ps.minEmitPower = 0.4; ps.maxEmitPower = 1.0;
                break;
            case 'ice': // slow falling frost mist
                ps.minSize = 0.10; ps.maxSize = 0.22;
                ps.minLifeTime = 0.6; ps.maxLifeTime = 1.1;
                ps.emitRate = 14;
                ps.direction1 = new Vector3(-0.2, -0.05, -0.2);
                ps.direction2 = new Vector3(0.2, 0.25, 0.2);
                ps.minEmitPower = 0.1; ps.maxEmitPower = 0.4;
                ps.gravity = new Vector3(0, -0.7, 0);
                break;
            case 'storm': // fast crackling sparks
                ps.minSize = 0.03; ps.maxSize = 0.08;
                ps.minLifeTime = 0.08; ps.maxLifeTime = 0.2;
                ps.emitRate = 44;
                ps.direction1 = new Vector3(-1, -0.5, -1);
                ps.direction2 = new Vector3(1, 1, 1);
                ps.minEmitPower = 1.2; ps.maxEmitPower = 2.6;
                break;
            case 'arcane': // slow swirling motes
                ps.minSize = 0.07; ps.maxSize = 0.14;
                ps.minLifeTime = 0.8; ps.maxLifeTime = 1.4;
                ps.emitRate = 12;
                ps.direction1 = new Vector3(-0.4, 0.1, -0.4);
                ps.direction2 = new Vector3(0.4, 0.5, 0.4);
                ps.minEmitPower = 0.15; ps.maxEmitPower = 0.5;
                break;
            case 'physical': // sparse white glints
                ps.minSize = 0.04; ps.maxSize = 0.10;
                ps.minLifeTime = 0.25; ps.maxLifeTime = 0.55;
                ps.emitRate = 8;
                ps.direction1 = new Vector3(-0.5, 0.2, -0.5);
                ps.direction2 = new Vector3(0.5, 0.9, 0.5);
                ps.minEmitPower = 0.3; ps.maxEmitPower = 0.9;
                break;
        }
        ps.start();
        return ps;
    }

    /** Three thin emissive bolts around the weapon that flicker while storm is
     *  active. One unique material per champion instance (NOT cached/shared —
     *  flashHitRed mutates emissive in place), freed in _releaseChampionFx. */
    private createStormBolts(anchor: Mesh): void {
        this.stormBoltMat = createEmissiveMaterial(
            `heroStormBoltMat_${this.championType}`,
            new Color3(1.0, 0.95, 0.4), 0.95, this.scene);
        for (let i = 0; i < 3; i++) {
            const bolt = MeshBuilder.CreateBox(`heroStormBolt_${i}`, {
                width: 0.025, height: 0.38, depth: 0.025,
            }, this.scene);
            bolt.material = this.stormBoltMat;
            bolt.parent = anchor;
            const angle = (i / 3) * Math.PI * 2;
            bolt.position = new Vector3(Math.cos(angle) * 0.26, 0.18, Math.sin(angle) * 0.26);
            bolt.rotation.z = 0.4;
            this.stormBolts.push(bolt);
        }
    }

    /** Re-randomize bolt visibility/placement a few times per second — fades go
     *  through mesh.visibility, never through the material (frozen + shared by
     *  the 3 bolts). */
    private flickerStormBolts(dt: number): void {
        this.stormFlickerTimer -= dt;
        if (this.stormFlickerTimer > 0) return;
        this.stormFlickerTimer = 0.05 + Math.random() * 0.12;
        for (const bolt of this.stormBolts) {
            bolt.visibility = Math.random() < 0.65 ? 0.6 + Math.random() * 0.4 : 0;
            const angle = Math.random() * Math.PI * 2;
            const r = 0.18 + Math.random() * 0.14;
            bolt.position.x = Math.cos(angle) * r;
            bolt.position.z = Math.sin(angle) * r;
            bolt.position.y = 0.05 + Math.random() * 0.3;
            bolt.rotation.y = Math.random() * Math.PI;
            bolt.rotation.z = 0.25 + Math.random() * 0.5;
        }
    }
}
```

(Note: `getWeaponAnchor` is unchanged — it is shown because the replaced range spans it. The closing `}` is the class end, as before.)

- [ ] **Step 4: Update `_releaseChampionFx` cleanup**

Replace the decoration-cleanup block (lines 1828–1841, the comment starting `// Free per-element weapon decorations:` through `this.elementDecorations.clear();`) with:

```typescript
        // Free the per-element aura particle systems.
        for (const ps of this.elementAuraPs.values()) {
            ps.stop();
            ps.dispose();
        }
        this.elementAuraPs.clear();
        // Storm bolts share ONE per-champion material — dispose meshes, then the
        // material once. (Default mesh.dispose() does NOT free materials; without
        // this the material leaks onto the never-disposed shared scene.)
        for (const b of this.stormBolts) {
            try { if (!b.isDisposed()) b.dispose(); } catch (_) { /* already disposed */ }
        }
        this.stormBolts = [];
        if (this.stormBoltMat) {
            try { this.stormBoltMat.dispose(); } catch (_) { /* already disposed */ }
            this.stormBoltMat = null;
        }
        // Weapon tint: restore the original material, then free the unique tint mat.
        if (this.weaponOrigMat && !this.weaponOrigMat.mesh.isDisposed()) {
            this.weaponOrigMat.mesh.material = this.weaponOrigMat.mat;
        }
        this.weaponOrigMat = null;
        if (this.weaponTintMat) {
            try { this.weaponTintMat.dispose(); } catch (_) { /* already disposed */ }
            this.weaponTintMat = null;
        }
        this.weaponTintKey = null;
```

- [ ] **Step 5: Verify no stale references**

Run: `grep -rn "elementDecorations\|createElementDecoration" src/`
Expected: no matches.

- [ ] **Step 6: Type-check and run the test suite**

Run: `npx tsc --noEmit`
Expected: clean (no output).

Run: `npm test`
Expected: all ~314 tests pass (this change touches no pure-logic module).

- [ ] **Step 7: Commit**

```bash
git add src/survivors/champions/Champion.ts
git commit -m "feat: elemental weapon glow — tint + particle auras replace crystal decorations"
```

### Task 2: In-game verification (headless)

**Files:** none (verification only)

- [ ] **Step 1: Build and launch headless**

Per the headless-verify recipe: start the dev server (`npm start`), drive Chromium via Playwright with `--use-angle=metal` (otherwise Babylon falls back to NullEngine and crashes on TEXTURE_CUBE), click "Begin the Hunt", and use `?test` so the champion auto-picks.

- [ ] **Step 2: Acquire an element and screenshot**

Play until a power orb is picked up (or use whatever test hooks exist to grant a power), then screenshot the hero weapon. Confirm: weapon reads tinted/glowing, particle aura visible, no stray crystal meshes.

- [ ] **Step 3: Watchdog check**

Let at least one wave clear and check the console: no `[resource-watchdog] LEAK SUSPECTED` lines, no `[loop:render]` errors.
