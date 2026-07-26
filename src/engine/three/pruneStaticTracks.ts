/**
 * pruneStaticTracks - drop animation tracks that provably never change anything.
 *
 * The exported character/enemy rigs carry a full TRS channel set per bone, but
 * roughly half of those channels are constant AND already sitting on the node's
 * bind value: every bone ships a `.scale` track pinned at (1,1,1) and most ship a
 * `.position` track pinned at the bind offset. Measured on the shipped GLBs,
 * 38-55% of all animation channels are of that kind.
 *
 * They are not free. `AnimationMixer.update` evaluates one Interpolant and one
 * PropertyMixer accumulate+apply PER TRACK PER ACTION PER FRAME, and the mixer
 * bus is the largest CPU item in the frame after rendering (measured 2.9-3.4ms
 * at ~245 enemies on the full LOD tier). Removing the static half of the track
 * set cuts mixer time ~29% at that scale, plus the per-spawn PropertyBinding
 * setup - each binding resolves its target with a subtree name search - and the
 * per-instance PropertyMixer buffers.
 *
 * Safety is the whole design. A track is removed only when, across EVERY clip on
 * the rig, that (node, property) pair is constant and equal to the node's bind
 * value:
 *  - constant-in-one-clip is NOT enough. If clip A animates a bone's position and
 *    clip B pins it at bind, B's track is what returns the bone home when B plays
 *    after A. Dropping it would leave A's last pose behind.
 *  - equal-to-bind is required because a property nothing writes simply keeps the
 *    value the GLB node was created with, which is exactly the bind value.
 * Everything unrecognised is kept: non-TRS properties (morph targets, material
 * paths), indexed track names, tracks whose stride does not match the property
 * (GLTF CUBICSPLINE samplers store tangents inline), unresolvable node names, and
 * tracks targeting the mixer root itself (game code owns the model root's
 * transform - enemy placement, elite scaling - so its channels are left alone).
 *
 * Pure Three, no DOM/WebGL - covered by Vitest.
 */

import type { AnimationClip, KeyframeTrack, Object3D } from 'three';

/** Element count of each animatable transform property. */
const TRS_SIZE: Readonly<Record<string, number>> = {
    position: 3,
    quaternion: 4,
    scale: 3,
};

/**
 * Absolute tolerance for "constant" and "equal to bind".
 *
 * Deliberately tight. A false negative costs a few tracks that could have gone;
 * a false positive silently changes a pose, so the threshold sits far below any
 * difference a rig could express.
 */
const EPSILON = 1e-5;

function bindComponent(node: Object3D, property: string, i: number): number {
    if (property === 'position') return node.position.getComponent(i);
    if (property === 'scale') return node.scale.getComponent(i);
    const q = node.quaternion;
    return i === 0 ? q.x : i === 1 ? q.y : i === 2 ? q.z : q.w;
}

/**
 * Adopt the track's stored value as the node's bind value.
 *
 * Track values live in a Float32Array while the node transform is float64, so a
 * bind pose authored as 0.4 comes back out of the sampler as 0.4000000059. That
 * rounding is far below EPSILON, but it means "play the constant track" and
 * "bind nothing" are not literally the same number. Writing the sampler's value
 * back into the node closes that gap: after the snap, the pruned rig holds
 * exactly what the removed track would have written on its first frame, so the
 * whole transformation is output-preserving rather than merely close.
 */
function snapToTrackValue(node: Object3D, property: string, values: ArrayLike<number>): void {
    if (property === 'position') node.position.set(values[0], values[1], values[2]);
    else if (property === 'scale') node.scale.set(values[0], values[1], values[2]);
    else node.quaternion.set(values[0], values[1], values[2], values[3]);
}

/**
 * True when this track holds one repeated value that is already the target
 * node's bind value - i.e. playing it is indistinguishable from not binding it
 * at all.
 */
function isStaticAtBind(
    track: KeyframeTrack,
    nodes: ReadonlyMap<string, Object3D>,
    root: Object3D,
): boolean {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) return false;

    const property = track.name.slice(dot + 1);
    const size = TRS_SIZE[property];
    if (size === undefined) return false;

    const times = track.times;
    const values = track.values;
    // A stride other than the property's element count means the sampler is
    // carrying something extra (cubic-spline tangents); leave it alone.
    if (times.length === 0 || values.length !== times.length * size) return false;

    const node = nodes.get(track.name.slice(0, dot));
    if (!node || node === root) return false;

    // Every keyframe compared against the FIRST one, not against its neighbour:
    // a per-step tolerance would let a slow ramp accumulate past it.
    for (let i = size; i < values.length; i++) {
        if (Math.abs(values[i] - values[i % size]) > EPSILON) return false;
    }
    for (let c = 0; c < size; c++) {
        if (Math.abs(values[c] - bindComponent(node, property, c)) > EPSILON) return false;
    }
    return true;
}

/**
 * Strip provably inert tracks from `clips` in place.
 *
 * @param root  the object the clips are bound against (the GLB scene root).
 * @param clips ALL clips that share that rig - the cross-clip check is what
 *              makes removal safe, so passing a subset is not valid.
 * @returns how many tracks were removed.
 */
export function pruneStaticTracks(root: Object3D, clips: AnimationClip[]): number {
    if (clips.length === 0) return 0;

    // First name wins, matching PropertyBinding.findNode's pre-order subtree
    // search - so a duplicated bone name resolves to the same node here as it
    // will at bind time.
    const nodes = new Map<string, Object3D>();
    root.traverse(node => { if (!nodes.has(node.name)) nodes.set(node.name, node); });

    // Track names are `<node>.<property>`, so the name alone identifies the
    // (node, property) pair across every clip on the rig.
    const inert = new Map<string, boolean>();
    const sample = new Map<string, KeyframeTrack>();
    for (const clip of clips) {
        for (const track of clip.tracks) {
            if (inert.get(track.name) === false) continue; // one veto is final
            inert.set(track.name, isStaticAtBind(track, nodes, root));
            if (!sample.has(track.name)) sample.set(track.name, track);
        }
    }

    let removed = 0;
    const dropped = new Set<string>();
    for (const clip of clips) {
        const keep = clip.tracks.filter(t => !inert.get(t.name));
        if (keep.length === clip.tracks.length) continue;
        // A clip whose every track is inert is already a no-op, but an action
        // with zero tracks is a shape nothing here has a reason to introduce -
        // leave it intact rather than find out.
        if (keep.length === 0) continue;
        for (const t of clip.tracks) if (inert.get(t.name)) dropped.add(t.name);
        removed += clip.tracks.length - keep.length;
        clip.tracks = keep;
    }

    for (const name of dropped) {
        const track = sample.get(name)!;
        const dot = name.lastIndexOf('.');
        snapToTrackValue(nodes.get(name.slice(0, dot))!, name.slice(dot + 1), track.values);
    }
    return removed;
}
