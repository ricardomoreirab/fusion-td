/**
 * MaterialCache - shared MeshPhongMaterial instances keyed by a string ID.
 *
 * Instead of allocating a new material per projectile or elite decoration,
 * callers obtain a cached instance. The GPU only compiles each shader
 * variant once and the material object itself is shared across meshes.
 *
 * Lifecycle:
 *   - The cache is module-level and persists for the lifetime of the process.
 *   - It is NOT automatically cleared on scene disposal. clearMaterialCache()
 *     is called from SurvivorsGameplayState.exit() (run teardown).
 *
 * Cached materials carry userData.cached = true, which the disposeMesh()
 * funnel (engine/three/primitives) recognizes and skips - only
 * clearMaterialCache() may dispose them. Keys MUST be bounded (element /
 * color-hex literals - finitely many; never randomized or per-instance):
 * an ever-growing cache is THE recurring freeze-bug class.
 */

import { Material, MeshPhongMaterial } from 'three';

const cache = new Map<string, MeshPhongMaterial>();
// Identity set of every material the cache has handed out. Lets bulk-
// disposal paths recognize SHARED cached materials and skip them -
// disposing one would break every other live mesh referencing it AND the
// cache itself, which treats key presence as validity and would keep
// handing out the dead instance.
const cachedInstances = new Set<Material>();

/**
 * Return a cached MeshPhongMaterial for the given key.
 * On the first call for a key, a new material is created, `setup` is
 * called on it, and it is cached. Key presence == valid (a cached material
 * is shared and only ever disposed via clearMaterialCache, which also
 * deletes the key).
 */
export function getCachedMaterial(
    key: string,
    setup: (mat: MeshPhongMaterial) => void,
): MeshPhongMaterial {
    let mat = cache.get(key);
    if (!mat) {
        mat = new MeshPhongMaterial();
        mat.name = key;
        setup(mat);
        mat.userData.cached = true;
        cache.set(key, mat);
        cachedInstances.add(mat);
    }
    return mat;
}

/**
 * True if `mat` is a SHARED material owned by this cache. Callers that
 * bulk-dispose per-mesh materials MUST skip these: only
 * clearMaterialCache() may dispose a cached material.
 */
export function isCachedMaterial(mat: Material): boolean {
    return cachedInstances.has(mat);
}

/** Number of distinct keys currently held in the cache. Test/diagnostic hook -
 *  an ever-growing value means callers are passing unbounded (e.g. randomized)
 *  keys, which defeats the cache and leaks a material per call. */
export function getMaterialCacheSize(): number {
    return cache.size;
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
    cachedInstances.clear();
}
