import { describe, it, expect, beforeEach } from 'vitest';
import { Color } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';
import { disposeMesh } from '../src/engine/three/primitives';
import { buildArrowMesh, arrowMaterialKey } from '../src/survivors/powers/ArrowMesh';
import { getMaterialCacheSize, clearMaterialCache } from '../src/engine/rendering/MaterialCache';

// Regression guard for the material-cache leak that re-froze later waves:
// buildArrowMesh used to key its shared material by the per-shot (randomized)
// mesh name, so every arrow created a brand-new material pinned forever in the
// never-evicted module cache. Telemetry signature: material count grew
// monotonically (5x over a run) while mesh count stayed flat.
//
// NOTE: getCachedMaterial keys its cache by presence only (see
// tests/MaterialCache.spec.ts for the history of the isReady() gating bug).
// We assert on the cache *Map size* (distinct keys) here.

const host = new SceneHost();

describe('buildArrowMesh material caching', () => {
    beforeEach(() => clearMaterialCache());

    it('reuses one cached material across many same-color shots', () => {
        const color = new Color(1, 0.4, 0.05); // fire arrow tint
        for (let i = 0; i < 200; i++) {
            // Unique per-shot mesh key, exactly as the powers call it.
            const arrow = buildArrowMesh(host, `fire_arrow_${Math.random()}`, color);
            disposeMesh(arrow);
        }
        // 200 shots → exactly ONE material in the cache, not ~200.
        expect(getMaterialCacheSize()).toBe(1);
    });

    it('keys distinct arrow colors separately but boundedly', () => {
        const colors = [
            new Color(1, 0.4, 0.05),   // fire
            new Color(0.4, 0.7, 1),    // frost
            new Color(0.7, 0.3, 1),    // seek/arcane
            new Color(1, 1, 0.3),      // lightning
        ];
        for (let i = 0; i < 400; i++) {
            const c = colors[i % colors.length];
            disposeMesh(buildArrowMesh(host, `arrow_${Math.random()}`, c));
        }
        // 400 shots across 4 tints → at most 4 cached materials.
        expect(getMaterialCacheSize()).toBe(4);
    });

    it('derives a color-stable key independent of the per-shot mesh name', () => {
        const color = new Color(1, 0.4, 0.05);
        expect(arrowMaterialKey(color)).toBe(arrowMaterialKey(color));
        expect(arrowMaterialKey(color)).not.toContain('fire_arrow');
    });
});
