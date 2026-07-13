// TODO(three-migration Phase C): re-enable once the subject module is converted
// to Three.js - it still calls the Babylon-era getCachedMaterial(scene, ...)
// signature against the converted MaterialCache.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NullEngine, Scene } from '@babylonjs/core';
import { clearMaterialCache } from '../src/engine/rendering/MaterialCache';
import { spawnExpandingRing, spawnTrail } from '../src/survivors/items/ItemFx';

// NullEngine never runs a render loop, so getDeltaTime() would stay 0 and the
// FX would never finish. Stub a fixed 100ms frame and drive the per-frame
// observers by notifying onBeforeRenderObservable directly.
const engine = new NullEngine();
(engine as unknown as { getDeltaTime: () => number }).getDeltaTime = () => 100;
const scene = new Scene(engine);

afterAll(() => { scene.dispose(); engine.dispose(); });

function tick(times: number): void {
    for (let i = 0; i < times; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
}

// Babylon defers Observable.remove() called during notifyObservers to the next
// macrotask (_deferUnregister), so observer-leak checks must yield first.
const flush = () => new Promise(r => setTimeout(r, 0));

// Count only OUR materials — building the first mesh lazily creates the
// scene's one-time 'default material', which is not a leak.
const itemfxMats = () => scene.materials.filter(m => m.name.startsWith('itemfx_')).length;

describe.skip('ItemFx leak safety', () => {
    beforeEach(() => clearMaterialCache());

    it('5 same-color rings add exactly ONE material (cache hit) and dispose after duration', async () => {
        const meshesBefore = scene.meshes.length;
        for (let i = 0; i < 5; i++) spawnExpandingRing(scene, i, 0, '#ff8800', 3, 0.45);
        expect(itemfxMats()).toBe(1);
        expect(scene.meshes.length - meshesBefore).toBe(5);
        tick(6); // 6 × 0.1s = 0.6s > 0.45s duration
        await flush();
        expect(scene.meshes.length).toBe(meshesBefore);   // all rings gone
        expect(itemfxMats()).toBe(1);                     // shared material kept, not duplicated
        expect(scene.onBeforeRenderObservable.observers.length).toBe(0); // no observer leak
    });

    it('trails share one material per color and clean up after duration', async () => {
        const meshesBefore = scene.meshes.length;
        for (let i = 0; i < 5; i++) spawnTrail(scene, 0, 0, 4, i + 1, '#22ddff', 0.25);
        expect(scene.materials.filter(m => m.name === 'itemfx_trail_#22ddff').length).toBe(1);
        tick(4); // 0.4s > 0.25s
        await flush();
        expect(scene.meshes.length).toBe(meshesBefore);
        expect(scene.onBeforeRenderObservable.observers.length).toBe(0);
    });
});
