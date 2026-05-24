/**
 * MaterialCache — shared StandardMaterial instances keyed by a string ID.
 *
 * Instead of allocating a new StandardMaterial per projectile or elite decoration,
 * callers obtain a cached instance. The GPU only compiles each shader variant once
 * and the draw-call overhead for shared materials is minimal.
 *
 * Lifecycle:
 *   - The cache is module-level and persists for the lifetime of the process.
 *   - It is NOT automatically cleared on scene disposal. If you need to release
 *     GPU resources (e.g., on a full scene restart), call clearMaterialCache()
 *     explicitly from your scene-cleanup path.
 *
 * TODO: wire clearMaterialCache() into the game's cleanupScene / scene-reset flow.
 */

import { Scene, StandardMaterial } from '@babylonjs/core';

const cache = new Map<string, StandardMaterial>();

/**
 * Return a cached StandardMaterial for the given key.
 * On the first call for a key (or after the material has been disposed),
 * a new StandardMaterial is created, `setup` is called on it, and it is cached.
 *
 * @param scene  BabylonJS scene — only used on cache miss.
 * @param key    Stable string identifier for this material variant.
 * @param setup  Called once on the fresh StandardMaterial to configure it.
 */
export function getCachedMaterial(
    scene: Scene,
    key: string,
    setup: (mat: StandardMaterial) => void,
): StandardMaterial {
    let mat = cache.get(key);
    if (!mat || mat.isReady() === false) {
        mat = new StandardMaterial(key, scene);
        setup(mat);
        cache.set(key, mat);
    }
    return mat;
}

/**
 * Dispose every material currently in the cache and clear it.
 * Call this when doing a full scene reset to free GPU resources.
 */
export function clearMaterialCache(): void {
    for (const mat of cache.values()) {
        try { mat.dispose(); } catch { /* ignore if already disposed */ }
    }
    cache.clear();
}
