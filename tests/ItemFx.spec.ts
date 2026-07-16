import { describe, it, expect, beforeEach } from 'vitest';
import { SceneHost } from '../src/engine/three/SceneHost';
import { clearMaterialCache, getMaterialCacheSize } from '../src/engine/rendering/MaterialCache';
import { spawnExpandingRing, spawnTrail } from '../src/survivors/items/ItemFx';

// SceneHost is headless by design: drive the per-frame callbacks with
// host.tick(dt) — a fixed 100ms frame replaces the Babylon-era NullEngine
// getDeltaTime stub.
const host = new SceneHost();

function tick(times: number): void {
    for (let i = 0; i < times; i++) host.tick(0.1);
}

describe('ItemFx leak safety', () => {
    beforeEach(() => clearMaterialCache());

    it('5 same-color rings add exactly ONE cached material and dispose after duration', () => {
        const meshesBefore = host.scene.children.length;
        for (let i = 0; i < 5; i++) spawnExpandingRing(host, i, 0, '#ff8800', 3, 0.45);
        expect(getMaterialCacheSize()).toBe(1); // cache hit across all 5 rings
        expect(host.scene.children.length - meshesBefore).toBe(5);
        tick(6); // 6 × 0.1s = 0.6s > 0.45s duration
        expect(host.scene.children.length).toBe(meshesBefore);   // all rings gone
        expect(getMaterialCacheSize()).toBe(1);                  // shared material kept, not duplicated
        expect(host.onBeforeRender.size).toBe(0);                // no update-callback leak
    });

    it('trails share one cached material per color and clean up after duration', () => {
        const meshesBefore = host.scene.children.length;
        for (let i = 0; i < 5; i++) spawnTrail(host, 0, 0, 4, i + 1, '#22ddff', 0.25);
        expect(getMaterialCacheSize()).toBe(1); // one 'itemfx_trail_#22ddff' entry
        tick(4); // 0.4s > 0.25s
        expect(host.scene.children.length).toBe(meshesBefore);
        expect(host.onBeforeRender.size).toBe(0);
    });
});
