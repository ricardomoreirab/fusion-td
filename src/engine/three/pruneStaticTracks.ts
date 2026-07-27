/**
 * pruneStaticTracks - drop animation tracks that provably never change anything.
 *
 * The exported character/enemy rigs carry a full TRS channel set per bone, but
 * more than half of those channels never move: every bone ships a `.scale` track
 * pinned at (1,1,1), most ship a `.position` track pinned at a fixed offset, and
 * a few pin a `.quaternion` at a fixed rotation. Measured across the shipped
 * GLBs, 54.6% of all 22301 animation channels are of that kind.
 *
 * They are not free. `AnimationMixer.update` evaluates one Interpolant and one
 * PropertyMixer accumulate+apply PER TRACK PER ACTION PER FRAME, and the mixer
 * bus is the largest CPU item in the frame after rendering (measured 1.7ms at
 * ~257 enemies on the full LOD tier). Removing the static half of the track set
 * cuts mixer time proportionally, plus the per-spawn PropertyBinding setup -
 * each binding resolves its target with a subtree name search - and the
 * per-instance PropertyMixer buffers.
 *
 * Safety is the whole design. Removal is always a WHOLE-RIG decision, never a
 * per-clip one: constant-in-one-clip is not enough, because if clip A animates a
 * bone and clip B pins it, B's track is exactly what returns the bone home when
 * B plays after A. So a (node, property) pair is only dropped when it is
 * constant in EVERY clip that carries it, plus one of:
 *
 *  1. it equals the node's BIND value everywhere. A property nothing writes
 *     simply keeps the value the GLB node was created with, so playing the track
 *     and not binding it at all are the same thing. Clips that omit the pair are
 *     fine: they leave the node exactly where the removed track would have put
 *     it. 36.1% of all channels.
 *
 *  2. it holds the SAME constant in every clip AND every clip carries it. Then
 *     no clip on the rig can produce any value but that one, so the property is
 *     a fixed part of the rig rather than animation. The node is snapped to that
 *     constant at load (see snapToTrackValue), which is what makes dropping the
 *     track inert: three's PropertyMixer captures the node's value as the
 *     binding's "original state", so after the snap the blend target, the
 *     restore-on-stop value and the clip value are one number. A further 18.5%
 *     of all channels - the exporter pins these bones at a pose that differs
 *     slightly (meshopt quantization) or substantially (a rest pose the rig
 *     never animates to) from the node's own transform.
 *     "Every clip carries it" is what rule 2 needs and rule 1 does not: once the
 *     kept value is not the bind value, a clip that omitted the pair would show
 *     whatever the previous clip left behind.
 *     Note what rule 2 costs: the rig's REST pose becomes a mixture of clip
 *     constants (on the nodes it snapped) and authored rest values (on the ones
 *     it left animated), which is a pose no clip produces. Every animated pose is
 *     preserved - that is the guarantee - but nothing may be MEASURED off the rest
 *     transform any more. See groundOffset, which grounds models from a posed clip
 *     for exactly this reason.
 *
 * Everything unrecognised is kept: non-TRS properties (morph targets, material
 * paths), indexed track names, tracks whose stride does not match the property
 * (GLTF CUBICSPLINE samplers store tangents inline), unresolvable node names, and
 * tracks targeting the mixer root itself (game code owns the model root's
 * transform - enemy placement, elite scaling - so its channels are left alone).
 *
 * What "inert" is worth, measured on the real rigs through three's own
 * GLTFLoader with the two variants interleaved in one process (mixer.update
 * ms/frame, rule 1 only -> rule 1+2): minion 44 -> 32 tracks/clip, -19.0%;
 * wizard 46 -> 32, -19.4%; fenrir 100 -> 51, -36.8%; the barbarian hero
 * 69 -> 59, -12.4%.
 *
 * And what it costs: playing a constant track and holding the snapped value are
 * the same pose only to within EPSILON, because the clips of one rig pin a
 * channel at values that agree only to within EPSILON and the snap has to pick
 * one of them. Driving every clip and every clip-to-clip cross-fade of all 26
 * shipped rigs through a mixer, the largest disagreement between the pruned and
 * unpruned pose is 1.3e-5 - the same order as the 7.1e-6 the rule-1 prune alone
 * already produces on those rigs, and far below anything a bone can express.
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
 * Absolute tolerance for "constant", "equal to bind" and "the same constant".
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
 *
 * For a rule-2 removal the snap is doing more than closing a rounding gap - it
 * is what moves the rig's rest pose onto the one value every clip agrees on.
 */
function snapToTrackValue(node: Object3D, property: string, values: ArrayLike<number>): void {
    if (property === 'position') node.position.set(values[0], values[1], values[2]);
    else if (property === 'scale') node.scale.set(values[0], values[1], values[2]);
    else node.quaternion.set(values[0], values[1], values[2], values[3]);
}

/** What one track says about its (node, property) pair. */
interface TrackFacts {
    /** False = structurally out of scope; the pair can never be removed. */
    usable: boolean;
    /** Every keyframe holds the first keyframe's value. */
    constant: boolean;
    /** That value is the target node's bind value. */
    atBind: boolean;
    /** Element count of the property (3 or 4). */
    size: number;
}

const UNUSABLE: TrackFacts = { usable: false, constant: false, atBind: false, size: 0 };

function readTrack(
    track: KeyframeTrack,
    nodes: ReadonlyMap<string, Object3D>,
    root: Object3D,
): TrackFacts {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) return UNUSABLE;

    const property = track.name.slice(dot + 1);
    const size = TRS_SIZE[property];
    if (size === undefined) return UNUSABLE;

    const times = track.times;
    const values = track.values;
    // A stride other than the property's element count means the sampler is
    // carrying something extra (cubic-spline tangents); leave it alone.
    if (times.length === 0 || values.length !== times.length * size) return UNUSABLE;

    const node = nodes.get(track.name.slice(0, dot));
    if (!node || node === root) return UNUSABLE;

    // Every keyframe compared against the FIRST one, not against its neighbour:
    // a per-step tolerance would let a slow ramp accumulate past it.
    let constant = true;
    for (let i = size; i < values.length; i++) {
        if (Math.abs(values[i] - values[i % size]) > EPSILON) { constant = false; break; }
    }
    let atBind = true;
    for (let c = 0; c < size; c++) {
        if (Math.abs(values[c] - bindComponent(node, property, c)) > EPSILON) { atBind = false; break; }
    }
    return { usable: true, constant, atBind, size };
}

/** Everything the rig as a whole says about one (node, property) pair. */
interface KeyEvidence {
    /** First track seen for the pair; the snap reads its float32 value. */
    sample: KeyframeTrack;
    /** How many clips carry the pair. */
    clips: number;
    /** Structurally in scope in every clip that carries it. */
    usable: boolean;
    /** Constant in every clip that carries it. */
    constant: boolean;
    /** Equal to the node's bind value in every clip that carries it. */
    atBind: boolean;
    /** The same constant in every clip that carries it. */
    shared: boolean;
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
    const evidence = new Map<string, KeyEvidence>();
    for (const clip of clips) {
        for (const track of clip.tracks) {
            let ev = evidence.get(track.name);
            if (!ev) {
                ev = {
                    sample: track, clips: 0,
                    usable: true, constant: true, atBind: true, shared: true,
                };
                evidence.set(track.name, ev);
            }
            ev.clips++;
            if (!ev.usable) continue; // one veto is final

            const facts = readTrack(track, nodes, root);
            if (!facts.usable) { ev.usable = false; continue; }
            if (!facts.constant) ev.constant = false;
            if (!facts.atBind) ev.atBind = false;
            // Compared against the sample's value, which is what the snap will
            // write - so "shared" means "the snap is right for this clip too".
            if (track !== ev.sample) {
                const mine = track.values;
                const theirs = ev.sample.values;
                for (let c = 0; c < facts.size; c++) {
                    if (Math.abs(mine[c] - theirs[c]) > EPSILON) { ev.shared = false; break; }
                }
            }
        }
    }

    const inert = new Map<string, boolean>();
    for (const [name, ev] of evidence) {
        inert.set(name, ev.usable && ev.constant
            && (ev.atBind || (ev.shared && ev.clips === clips.length)));
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
        const ev = evidence.get(name)!;
        const dot = name.lastIndexOf('.');
        snapToTrackValue(nodes.get(name.slice(0, dot))!, name.slice(dot + 1), ev.sample.values);
    }
    return removed;
}
