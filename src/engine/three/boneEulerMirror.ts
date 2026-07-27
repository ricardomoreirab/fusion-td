/**
 * boneEulerMirror - stop paying for the Euler mirror THREE keeps behind every
 * bone's quaternion, which on a skinned rig is write-only.
 *
 * `Object3D`'s constructor wires its two rotation representations together:
 *
 *     rotation._onChange( () => quaternion.setFromEuler( rotation, false ) );
 *     quaternion._onChange( () => rotation.setFromQuaternion( quaternion, undefined, false ) );
 *
 * so ANY quaternion write re-derives the Euler angles, and `Euler.setFromQuaternion`
 * is not cheap: it composes a rotation Matrix4 from the quaternion and then
 * extracts three angles with an `asin` and two `atan2`. `AnimationMixer` writes
 * one quaternion per rotation track per bone per frame - after `pruneStaticTracks`
 * that is essentially the whole clip, because rotation is the only channel a rig
 * genuinely animates - so at horde scale the mirror is thousands of Euler
 * extractions per frame that nothing ever reads.
 *
 * Measured with `node --cpu-prof` on the real minion rig at 250 instances,
 * `Euler.setFromRotationMatrix` alone is 29.5% of `mixer.update` and the
 * `Matrix4.compose` feeding it another 4.5%. Detaching the mirror on bones cuts
 * the animation bus by a fifth to a third, interleaved in one process across
 * four rigs: minion 0.51 -> 0.34 ms/frame (-33%), wizard 0.51 -> 0.35, hero
 * (Aulus) 0.79 -> 0.58, fenrir 0.90 -> 0.68.
 *
 * WHAT THIS CHANGES, precisely: a detached bone's `.rotation` Euler stops
 * tracking its quaternion. Everything the game and THREE actually read is
 * untouched - `matrix`/`matrixWorld` come from `matrix.compose(position,
 * quaternion, scale)`, `Skeleton.update()` reads `bone.matrixWorld`, and
 * `Euler.order` is never written by the mirror so `Object3D.copy`'s
 * `this.rotation.order = source.rotation.order` (the ONLY place THREE reads a
 * `.rotation` in the render or animation path) still sees the right value. The
 * Euler -> quaternion direction is deliberately left wired, so writing
 * `bone.rotation.y = a` still poses the bone exactly as before.
 *
 * Two preconditions, both CHECKED here rather than assumed:
 *
 *  1. Only Bones are detached. Across every shipped GLB, all 7067 surviving
 *     quaternion tracks target a bone and not one targets a non-bone node, so
 *     bones capture 100% of the cost with the smallest possible blast radius.
 *  2. A bone that any clip drives through its EULER keeps the mirror. No shipped
 *     rig has a `.rotation` track (0 of 7067), but a rig that mixed `.rotation`
 *     and `.quaternion` tracks on one bone would need both directions live, so
 *     `boneNamesDrivenByEuler` collects those names and they are skipped.
 *
 * Anything that legitimately needs a detached bone's Euler must call
 * `syncBoneEuler(bone)` first - that is the documented replacement for the
 * automatic mirror, and it reproduces the value THREE would have held exactly.
 */

import type { AnimationClip, Bone, Euler, Object3D, Quaternion } from 'three';

/** The mirror THREE installs is the only thing this replaces. */
const NO_MIRROR = (): void => {};

type MirroredQuaternion = Quaternion & { _onChange(cb: () => void): Quaternion };

/**
 * Names of bones any clip drives through `.rotation` rather than `.quaternion`.
 *
 * Such a bone needs the quaternion -> Euler direction live: a second clip (or a
 * cross-fade partner) writing its `.quaternion` would otherwise leave the Euler
 * the first clip owns stale, and the next Euler write would pose the bone from a
 * wrong baseline. Pass the result to `detachBoneEulerMirror` to exempt them.
 */
export function boneNamesDrivenByEuler(clips: readonly AnimationClip[]): Set<string> {
    const names = new Set<string>();
    for (const clip of clips) {
        for (const track of clip.tracks) {
            const dot = track.name.lastIndexOf('.');
            if (dot < 0) continue;
            if (!track.name.startsWith('rotation', dot + 1)) continue;
            names.add(track.name.slice(0, dot));
        }
    }
    return names;
}

/**
 * Detach the quaternion -> Euler mirror on every bone below `root`.
 *
 * Returns the number of bones detached. Idempotent, and a no-op on a graph with
 * no bones.
 *
 * Must be installed PER INSTANCE, not on the shared container: the mirror lives
 * in `quaternion._onChangeCallback`, and neither `Quaternion.copy` nor
 * `Object3D.copy` carries it across, so every `SkeletonUtils.clone` comes out
 * with THREE's default mirror re-attached. (Same constraint as
 * `installFlatSkeletonUpdate`, and the opposite of `hideBoneSubtrees`, whose
 * `visible` flag IS inherited by a clone.)
 */
export function detachBoneEulerMirror(root: Object3D, eulerDriven?: ReadonlySet<string>): number {
    let detached = 0;
    root.traverse(node => {
        if (!(node as Bone).isBone) return;
        if (eulerDriven?.has(node.name)) return;
        (node.quaternion as MirroredQuaternion)._onChange(NO_MIRROR);
        detached++;
    });
    return detached;
}

/**
 * Bring a detached bone's `.rotation` back in step with its quaternion and
 * return it.
 *
 * The replacement for the automatic mirror: same value, same `order`, and (like
 * THREE's own mirror) it does not fire the Euler's change callback, so the
 * quaternion is not re-derived from the angles it was just derived from.
 * Harmless on a bone whose mirror is still attached.
 */
export function syncBoneEuler(bone: Object3D): Euler {
    return bone.rotation.setFromQuaternion(bone.quaternion, undefined, false);
}
