import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NullEngine, Scene, Color3 } from '@babylonjs/core';
import { buildArrowMesh, arrowMaterialKey } from '../src/survivors/powers/ArrowMesh';
import { getMaterialCacheSize, clearMaterialCache } from '../src/engine/rendering/MaterialCache';

// Regression guard for the material-cache leak that re-froze later waves:
// buildArrowMesh used to key its shared material by the per-shot (randomized)
// mesh name, so every arrow created a brand-new frozen StandardMaterial pinned
// forever in the never-evicted module cache. Telemetry signature: scene
// `materials` grew monotonically (5x over a run) while `meshes` stayed flat.
//
// NOTE: getCachedMaterial now keys its cache by presence only. (It previously
// gated on `mat.isReady() === false`, which is ALWAYS true when isReady() is
// called with no mesh — a real, browser-affecting leak, not a NullEngine quirk;
// see tests/MaterialCache.spec.ts.) We assert on the cache *Map size* (distinct
// keys) here; MaterialCache.spec.ts covers the scene.materials growth invariant.

const engine = new NullEngine();
const scene = new Scene(engine);

describe('buildArrowMesh material caching', () => {
    beforeEach(() => clearMaterialCache());
    afterAll(() => { scene.dispose(); engine.dispose(); });

    it('reuses one cached material across many same-color shots', () => {
        const color = new Color3(1, 0.4, 0.05); // fire arrow tint
        for (let i = 0; i < 200; i++) {
            // Unique per-shot mesh key, exactly as the powers call it.
            const arrow = buildArrowMesh(scene, `fire_arrow_${Math.random()}`, color);
            arrow.dispose();
        }
        // 200 shots → exactly ONE material in the cache, not ~200.
        expect(getMaterialCacheSize()).toBe(1);
    });

    it('keys distinct arrow colors separately but boundedly', () => {
        const colors = [
            new Color3(1, 0.4, 0.05),   // fire
            new Color3(0.4, 0.7, 1),    // frost
            new Color3(0.7, 0.3, 1),    // seek/arcane
            new Color3(1, 1, 0.3),      // lightning
        ];
        for (let i = 0; i < 400; i++) {
            const c = colors[i % colors.length];
            buildArrowMesh(scene, `arrow_${Math.random()}`, c).dispose();
        }
        // 400 shots across 4 tints → at most 4 cached materials.
        expect(getMaterialCacheSize()).toBe(4);
    });

    it('derives a color-stable key independent of the per-shot mesh name', () => {
        const color = new Color3(1, 0.4, 0.05);
        expect(arrowMaterialKey(color)).toBe(arrowMaterialKey(color));
        expect(arrowMaterialKey(color)).not.toContain('fire_arrow');
    });
});
