/**
 * MaterialCache regression guard.
 *
 * History: getCachedMaterial once gated its cache hit on a Babylon
 * `isReady()` check that was always false, so the cache NEVER hit and every
 * call leaked a material - THE recurring multi-second-freeze bug. The Three
 * port keeps the key-presence-only contract; these specs pin it plus the
 * identity-set behavior bulk disposers rely on, and the userData.cached
 * flag the disposeMesh funnel uses to skip shared materials.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MeshPhongMaterial } from 'three';
import {
    clearMaterialCache,
    getCachedMaterial,
    getMaterialCacheSize,
    isCachedMaterial,
} from '../src/engine/rendering/MaterialCache';

afterEach(() => clearMaterialCache());

describe('getCachedMaterial', () => {
    it('returns the SAME instance for repeated same-key calls (cache actually hits)', () => {
        const a = getCachedMaterial('k', m => m.color.set('#ff0000'));
        const b = getCachedMaterial('k', m => m.color.set('#00ff00'));
        expect(a).toBe(b);
        expect(getMaterialCacheSize()).toBe(1);
    });

    it('runs the setup callback only once per key', () => {
        let calls = 0;
        for (let i = 0; i < 200; i++) {
            getCachedMaterial('k', () => calls++);
        }
        expect(calls).toBe(1);
        expect(getMaterialCacheSize()).toBe(1);
    });

    it('keeps distinct keys separate and bounded', () => {
        const red = getCachedMaterial('red', m => m.color.set('#ff0000'));
        const blue = getCachedMaterial('blue', m => m.color.set('#0000ff'));
        expect(red).not.toBe(blue);
        expect(getMaterialCacheSize()).toBe(2);
        for (let i = 0; i < 100; i++) {
            getCachedMaterial(i % 2 ? 'red' : 'blue', () => undefined);
        }
        expect(getMaterialCacheSize()).toBe(2);
    });

    it('flags cached materials so the disposeMesh funnel skips them', () => {
        const mat = getCachedMaterial('k', () => undefined);
        expect(mat.userData.cached).toBe(true);
    });
});

describe('isCachedMaterial', () => {
    it('recognizes materials handed out by the cache', () => {
        const cached = getCachedMaterial('k', () => undefined);
        const foreign = new MeshPhongMaterial();
        expect(isCachedMaterial(cached)).toBe(true);
        expect(isCachedMaterial(foreign)).toBe(false);
    });

    it('forgets instances after clearMaterialCache (no unbounded growth across runs)', () => {
        const cached = getCachedMaterial('k', () => undefined);
        clearMaterialCache();
        expect(isCachedMaterial(cached)).toBe(false);
        expect(getMaterialCacheSize()).toBe(0);
    });
});
