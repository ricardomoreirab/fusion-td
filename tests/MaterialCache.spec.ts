import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NullEngine, Scene, Color3, StandardMaterial } from '@babylonjs/core';
import { getCachedMaterial, getMaterialCacheSize, clearMaterialCache, isCachedMaterial } from '../src/engine/rendering/MaterialCache';

// Regression guard for the dominant recurring-freeze root cause.
//
// getCachedMaterial USED to gate its cache on `mat.isReady() === false`. But
// Babylon's PushMaterial.isReady(mesh) returns false unconditionally when called
// with no mesh argument (the `if (!mesh) return false` guard) — which is exactly
// how getCachedMaterial calls it. So the cache NEVER hit: every call allocated a
// fresh frozen StandardMaterial, overwrote the map entry, and orphaned the prior
// material in scene.materials forever (a list the scene walks every frame).
//
// On the hottest VFX paths (trail particles ~20Hz per projectile, every swing
// ring/arc, every projectile, elite auras) scene.materials grew monotonically
// within a run AND across runs (module-level cache) — the textbook worsens-over-
// time freeze. The old ArrowMesh test only asserted on the cache Map size (which
// stays 1 because the map overwrites), so it never caught the scene.materials
// leak. These tests assert the true invariant: the cache returns the SAME
// instance and scene.materials does not grow per call.

const engine = new NullEngine();
const scene = new Scene(engine);

// File-level so the scene survives until BOTH describes have run.
afterAll(() => { scene.dispose(); engine.dispose(); });

describe('getCachedMaterial', () => {
    beforeEach(() => clearMaterialCache());

    it('returns the SAME instance for repeated same-key calls (cache actually hits)', () => {
        const a = getCachedMaterial(scene, 'k', m => { m.emissiveColor = new Color3(1, 0, 0); });
        const b = getCachedMaterial(scene, 'k', m => { m.emissiveColor = new Color3(1, 0, 0); });
        const c = getCachedMaterial(scene, 'k', m => { m.emissiveColor = new Color3(1, 0, 0); });
        expect(b).toBe(a);
        expect(c).toBe(a);
    });

    it('does not grow scene.materials on repeated same-key calls', () => {
        const before = scene.materials.length;
        for (let i = 0; i < 100; i++) {
            getCachedMaterial(scene, 'hot_vfx', m => { m.emissiveColor = new Color3(0, 1, 0); });
        }
        // 100 calls → exactly ONE material added to the scene, not 100.
        expect(scene.materials.length - before).toBe(1);
        expect(getMaterialCacheSize()).toBe(1);
    });

    it('runs the setup callback only once per key', () => {
        let setupCalls = 0;
        for (let i = 0; i < 50; i++) {
            getCachedMaterial(scene, 'once', () => { setupCalls++; });
        }
        expect(setupCalls).toBe(1);
    });

    it('keeps distinct keys separate and bounded', () => {
        const before = scene.materials.length;
        for (let i = 0; i < 400; i++) {
            getCachedMaterial(scene, `tint_${i % 4}`, m => { m.alpha = 0.5; });
        }
        // 400 calls across 4 keys → exactly 4 materials, not 400.
        expect(scene.materials.length - before).toBe(4);
        expect(getMaterialCacheSize()).toBe(4);
    });
});

// Regression guard for the elite-death visual wipe-out: Enemy._releaseMeshAndAnimations
// bulk-disposes per-mesh materials with dispose(false, true), and used to dispose the
// SHARED elite aura/glow/spike materials (getCachedMaterial) on the first elite death
// of an element. The cache treats key presence as validity, so it kept handing out
// the dead instance and every other live elite of that element lost its visuals.
// isCachedMaterial() is the marker bulk-disposal paths use to skip shared materials.
describe('isCachedMaterial', () => {
    beforeEach(() => clearMaterialCache());

    it('recognizes materials handed out by the cache', () => {
        const mat = getCachedMaterial(scene, 'elite_aura_fire', m => { m.alpha = 0.18; });
        expect(isCachedMaterial(mat)).toBe(true);
        // Same key, later call — still the same recognized instance.
        expect(isCachedMaterial(getCachedMaterial(scene, 'elite_aura_fire', () => {}))).toBe(true);
    });

    it('does not recognize uniquely-owned (non-cached) materials', () => {
        const unique = new StandardMaterial('perEnemyClone', scene);
        expect(isCachedMaterial(unique)).toBe(false);
        unique.dispose();
    });

    it('forgets instances after clearMaterialCache (no unbounded growth across runs)', () => {
        const mat = getCachedMaterial(scene, 'elite_glow_ice', m => { m.alpha = 0.4; });
        clearMaterialCache();
        expect(isCachedMaterial(mat)).toBe(false);
        // A fresh material under the same key is recognized again.
        const next = getCachedMaterial(scene, 'elite_glow_ice', m => { m.alpha = 0.4; });
        expect(next).not.toBe(mat);
        expect(isCachedMaterial(next)).toBe(true);
    });
});
