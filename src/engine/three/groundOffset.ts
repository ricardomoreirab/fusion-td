/**
 * measureGroundOffset - how far a rig must be lifted for its feet to rest on y = 0.
 *
 * Every GLB entity is parented to a transform host that sits on the ground plane,
 * and the model inside it has to be raised by whatever distance its lowest vertex
 * sits below its own root. Each call site used to derive that per SPAWN, with a
 * `Box3.setFromObject` over the freshly cloned rig - which measured the model in
 * its REST pose, because the mixer has not run yet at construction time.
 *
 * The rest pose is not a valid reference, for two independent reasons:
 *
 *  1. It is not a pose the entity is ever rendered in. Measured on the shipped
 *     rigs, the authored rest pose puts the wizards' feet 0.20 below where their
 *     idle pose puts them and the minions' 0.26 below - so those enemies shipped
 *     hovering by that much, in every wave, before anything touched it.
 *
 *  2. pruneStaticTracks deliberately REWRITES it. Its rule 2 moves a constant
 *     every clip agrees on out of the tracks and into the node, which is exactly
 *     what makes dropping the track inert for animation - and leaves the rest
 *     pose a mixture of clip constants (on pruned nodes) and authored rest values
 *     (on animated ones) that the rig is never in. On the barbarian that mixture
 *     reads 0.59 lower than the authored rest, so the hero floated most of a body
 *     height above its own shadow.
 *
 * The pose the entity actually holds is the reference, so this samples one: the
 * rig's idle clip at t = 0, which is the pose it wears the instant it spawns.
 * Reading the lowest point over the WHOLE clip set instead would be worse than
 * either rest pose - entrance and skill clips lunge far below the floor (framis
 * reaches -1.49, thamuz -2.45), and grounding on those would bury the model.
 *
 * Measured once per loaded container rather than once per spawn, which also
 * retires a real per-spawn cost: the skinned `Box3` it replaces walks every
 * vertex through its bone matrices and takes 0.33 ms for a minion and 1.5 ms for
 * the hero, on every single enemy that spawns.
 *
 * Pure Three, no DOM/WebGL - covered by Vitest.
 */

import { AnimationMixer, Box3, Object3D } from 'three';
import type { AnimationClip, Mesh, SkinnedMesh } from 'three';

const _box = new Box3();
const _child = new Box3();

/** three's typings declare `SkinnedMesh.boundingBox` non-nullable, but the
 *  runtime initialises it to null and `Box3.expandByObject` tests for exactly
 *  that before recomputing - so clearing it is both legal and necessary. */
type BoxCache = { boundingBox: Box3 | null };

/**
 * The clip whose first frame defines "standing on the ground".
 *
 * Idle first: every shipped rig but the artillery carriages has one, and it is
 * the pose an entity holds between actions. Then locomotion, then anything that
 * is not a death clip (a corpse is authored lying down, so grounding on it would
 * lift the model by its own body length). The carriages fall all the way through
 * to their single unnamed clip, which is correct for them.
 */
function pickReferenceClip(clips: readonly AnimationClip[]): AnimationClip | null {
    if (clips.length === 0) return null;
    return clips.find(c => /idle/i.test(c.name))
        ?? clips.find(c => /run|walk/i.test(c.name))
        ?? clips.find(c => !/dead|die/i.test(c.name))
        ?? clips[0];
}

/** Lowest point of the subtree, in the space `root`'s parent sees.
 *
 *  Deliberately not `Box3.setFromObject`: that caches a pose-specific
 *  `boundingBox` on every SkinnedMesh it touches and leaves it there, and this
 *  runs on the CONTAINER, whose meshes outlive the measurement. */
function lowestPoint(root: Object3D): number | null {
    root.updateMatrixWorld(true);
    _box.makeEmpty();
    root.traverse(node => {
        const mesh = node as Mesh;
        if (!mesh.geometry) return;
        mesh.updateWorldMatrix(false, false);
        const skinned = node as SkinnedMesh;
        if (skinned.isSkinnedMesh) {
            // Always recomputes from the CURRENT pose (makeEmpty + a full vertex
            // walk), then is cleared again so the container hands no stale,
            // pose-specific box to a later Box3.setFromObject.
            skinned.computeBoundingBox();
            const cache = skinned as unknown as BoxCache;
            if (!cache.boundingBox) return;
            _child.copy(cache.boundingBox);
            cache.boundingBox = null;
        } else {
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            if (!mesh.geometry.boundingBox) return;
            _child.copy(mesh.geometry.boundingBox);
        }
        // An empty geometry (the transform hosts) yields min=+Inf/max=-Inf, which
        // would poison the union with NaN once transformed.
        if (!isFinite(_child.min.y) || !isFinite(_child.max.y)) return;
        _child.applyMatrix4(mesh.matrixWorld);
        _box.union(_child);
    });
    return _box.isEmpty() ? null : _box.min.y;
}

/**
 * Distance from the model root down to the rig's lowest point, per unit of root
 * scale, so an owner that has scaled its clone can ground it with
 * `root.position.y = groundOffset * root.scale.y`.
 *
 * Dividing the scale out here is what lets the value be measured once on the
 * shared container and reused by owners that each pick their own size (the boss
 * is 2.2x, the hero 1.5x, a minion 1x).
 *
 * Returns 0 for a rig with no drawable geometry, which grounds it where it is.
 */
export function measureGroundOffset(scene: Object3D, clips: readonly AnimationClip[]): number {
    // A root rotation that tilts Y would make the lowest point depend on the
    // owner's own Y pre-rotation, which is applied per instance and not visible
    // here. All 26 shipped rigs load with an identity root transform; anything
    // else is left ungrounded rather than grounded wrongly.
    const q = scene.quaternion;
    if (Math.abs(q.x) > 1e-6 || Math.abs(q.z) > 1e-6) return 0;

    const clip = pickReferenceClip(clips);
    let mixer: AnimationMixer | null = null;
    if (clip) {
        mixer = new AnimationMixer(scene);
        mixer.clipAction(clip).play();
        mixer.setTime(0);
    }

    const lowest = lowestPoint(scene);

    // uncacheRoot restores every bound property to the value it held when the
    // binding was created, so the container goes back to the exact rest pose it
    // had before this ran and clones are unaffected.
    if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(scene);
        scene.updateMatrixWorld(true);
    }

    if (lowest === null) return 0;
    const scaleY = scene.scale.y || 1;
    return -(lowest - scene.position.y) / scaleY;
}
