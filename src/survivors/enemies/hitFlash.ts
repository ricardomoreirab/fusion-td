/**
 * hitFlash - the brief red tint an enemy shows when it takes damage.
 *
 * There are two ways to make one mesh look tinted and which one is legal
 * depends on who owns the material:
 *
 *  - a material this enemy owns outright (the procedural fallback bodies, the
 *    elite decorations) is tinted IN PLACE and its previous emissive Color is
 *    kept by reference for the restore. Zero allocation per hit.
 *
 *  - a material that came from a GLB container is SHARED by every live enemy of
 *    that rig (assets.ts hands out the container's materials and only clones on
 *    demand, because at horde scale one material per enemy costs a full uniform
 *    refresh per draw and destroys the renderer's depth sort). Tinting it in
 *    place would flash the whole horde. Instead the mesh is swapped to a
 *    pre-tinted twin of that material, so only this enemy moves.
 *
 * The twins are cached one per source material for the life of the process,
 * which is what keeps this out of the unbounded-material-key leak class: the
 * count is bounded by the number of RIGS, never by the number of enemies or
 * hits. Enemies flashing at the same time all land on the same twin, so the
 * horde still batches while it is flashing.
 *
 * Pure Three - no Game, no scene, no DOM. Covered by Vitest.
 */

import { Color, Material, MeshPhongMaterial } from 'three';

/** Per-hit emissive tint — module-level constant so a flash never allocates a
 *  fresh Color (every chain-lightning sub-hit etc.). Assigned BY REFERENCE and
 *  never mutated: the old `.set()` path mutated it in place and corrupted the
 *  tint for the whole run. */
export const HIT_TINT = new Color(0.85, 0.10, 0.05);

/** Anything the flash can retint: a node that may carry material(s). */
export type FlashTarget = { material?: Material | Material[] };

/** A mesh whose material was swapped wholesale to the shared flash twin. */
export interface FlashSwap { mesh: FlashTarget; original: Material | Material[] }

/** A material tinted in place, plus the emissive Color to put back. */
export interface FlashTint { mat: MeshPhongMaterial; original: Color }

const FLASH_VARIANTS = new WeakMap<Material, Material>();

/**
 * The pre-tinted twin of a shared GLB material, created once and cached.
 *
 * A WeakMap keyed by the source means a twin can never outlive the material it
 * mirrors, and clearContainerCache() (run teardown) is what releases those.
 */
export function hitFlashVariant(source: Material): Material {
    let variant = FLASH_VARIANTS.get(source);
    if (!variant) {
        variant = source.clone(); // shares the source textures
        variant.name = `${source.name}__hitFlash`;
        (variant as MeshPhongMaterial).emissive = HIT_TINT;
        // Container-lifetime, not instance-lifetime: disposeMesh must leave it be.
        variant.userData.cached = true;
        delete variant.userData.glbShared; // a twin is never itself swapped
        FLASH_VARIANTS.set(source, variant);
    }
    return variant;
}

/** True when this material belongs to a GLB container and is therefore shared
 *  by every live instance of that rig (assets.ts markSharedMaterials). */
function isGlbShared(mat: Material): boolean {
    return mat.userData.glbShared === true;
}

/**
 * Tint one node, recording whatever is needed to undo it into `swaps`/`tints`.
 * Call for every node of the enemy's tree; nodes without materials are skipped.
 */
export function collectHitFlash(mesh: FlashTarget, swaps: FlashSwap[], tints: FlashTint[]): void {
    const current = mesh.material;
    if (!current) return;

    if (Array.isArray(current) ? current.some(isGlbShared) : isGlbShared(current)) {
        swaps.push({ mesh, original: current });
        mesh.material = Array.isArray(current)
            ? current.map(m => (isGlbShared(m) ? hitFlashVariant(m) : m))
            : hitFlashVariant(current);
        return;
    }

    const mats = Array.isArray(current) ? current : [current];
    for (const raw of mats) {
        const mat = raw as MeshPhongMaterial | null | undefined;
        if (!mat || mat.emissive === undefined) continue;
        // Material already shows the shared HIT_TINT (another enemy sharing a
        // cached material is mid-flash) — don't capture/re-tint it. Capturing
        // HIT_TINT as the "original" would leave it stuck red once we restore,
        // and the other enemy already owns the restore.
        if (mat.emissive === HIT_TINT) continue;
        tints.push({ mat, original: mat.emissive });
        mat.emissive = HIT_TINT;
    }
}

/** Undo everything collectHitFlash recorded and empty both lists. Tolerates a
 *  mesh or material that was disposed mid-flash (death interrupts a flash). */
export function restoreHitFlash(swaps: FlashSwap[], tints: FlashTint[]): void {
    for (let i = 0; i < tints.length; i++) {
        const t = tints[i];
        try { t.mat.emissive = t.original; } catch (_) { /* mat disposed */ }
    }
    tints.length = 0;
    for (let i = 0; i < swaps.length; i++) {
        const s = swaps[i];
        try { s.mesh.material = s.original; } catch (_) { /* mesh disposed */ }
    }
    swaps.length = 0;
}
