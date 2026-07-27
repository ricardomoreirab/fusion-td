/**
 * clipMask - split an AnimationClip by skeleton region so two clips can drive
 * one rig at the same time without fighting over the same bones.
 *
 * THREE has no bone mask: two AnimationActions on the same bone blend by
 * weight, so layering a rooted attack over a run at partial weight gives every
 * bone a weighted AVERAGE of the two poses. The legs then walk at whatever
 * fraction the attack layer left them - a small, mushy half-stride rather than
 * a run with a swing on top.
 *
 * The fix is to make the layers disjoint: derive a lower-body-only clip and an
 * upper-body-only clip, and play each at full weight. Every bone is then
 * written by exactly one action, so neither pose is diluted.
 *
 * Pure and Three-only (no DOM/WebGL) - covered by Vitest.
 */

import {
    AnimationClip,
    Bone,
    Quaternion,
    QuaternionKeyframeTrack,
    type KeyframeTrack,
    type Object3D,
} from 'three';

/**
 * Name of the skeleton's root bone — the one whose parent is not itself a bone.
 * On a Biped rig this is `Bip001`, which carries the whole body's translation
 * and so belongs to the locomotion layer even though its name says nothing
 * about legs.
 */
export function findSkeletonRootName(root: Object3D): string | undefined {
    let found: string | undefined;
    root.traverse(node => {
        if (found !== undefined) return;
        if ((node as Bone).isBone && !((node.parent as Bone | null)?.isBone)) {
            found = node.name;
        }
    });
    return found;
}

/**
 * The node a track drives. THREE track names are `<nodeName>.<property>` and
 * may carry an index (`<nodeName>.morphTargetInfluences[3]`), so the node is
 * everything before the LAST dot - node names themselves can contain spaces
 * (`Bip001 L Thigh`) but not dots.
 */
export function trackTargetName(trackName: string): string {
    const dot = trackName.lastIndexOf('.');
    return dot < 0 ? trackName : trackName.slice(0, dot);
}

/**
 * Lower-body test for the Biped-style rigs the champions ship with
 * (`Bip001 Pelvis`, `Bip001 L Thigh`, `Bip001 R Calf`, `Bip001 R Foot`, …).
 *
 * The ROOT and the PELVIS count as lower body on purpose: they carry the whole
 * body's travel, bob and hip swing, which belong to locomotion. Leaving them to
 * the attack layer would let a rooted swing pin the body in place while the
 * legs ran underneath it.
 *
 * Matching is on word-ish substrings rather than an exact list so a rig that
 * names a bone `Bip001 L Toe0` or `pelvis_01` still classifies correctly; the
 * fallback for an unrecognised name is UPPER, which is the safe direction (an
 * unknown bone left to the attack layer misplaces a detail, one wrongly called
 * lower silently drops it from the swing).
 */
const LOWER_BODY_PATTERNS = ['pelvis', 'thigh', 'calf', 'shin', 'knee', 'foot', 'ankle', 'toe', 'leg'];

export function isLowerBodyBone(nodeName: string, rootName?: string): boolean {
    if (rootName && nodeName === rootName) return true;
    const n = nodeName.toLowerCase();
    return LOWER_BODY_PATTERNS.some(p => n.includes(p));
}

/** A clip holding only the tracks whose target satisfies `keep`. */
export function filterClipTracks(
    clip: AnimationClip,
    name: string,
    keep: (nodeName: string) => boolean,
): AnimationClip {
    const tracks: KeyframeTrack[] = clip.tracks.filter(t => keep(trackTargetName(t.name)));
    // Keep the ORIGINAL duration, not the filtered tracks' extent: a derived
    // clip must stay the same length as its source or the two layers drift.
    return new AnimationClip(name, clip.duration, tracks);
}

/**
 * A copy of `clip` whose ROTATION swing is scaled by `amount` about each track's
 * own mean pose. 1 is the authored clip; 0.75 keeps three quarters of the swing.
 *
 * Scaling about the clip's OWN mean rather than the rig's bind pose is what
 * keeps the stance: the average pose over the cycle is unchanged, so the body
 * neither sinks, leans nor drifts - only the size of the motion changes. Only
 * quaternion tracks are touched, so the root's travel and the body's height
 * stay exactly as authored (knee lift is rotation, and that is what a shrunk
 * stride needs to lose).
 *
 * Used for the locomotion half of the split combat layers: at full amplitude a
 * run playing under a rooted torso reads as over-animated, because none of the
 * counter-motion the authored run puts in the spine and arms is there to
 * balance it.
 */
export function scaleClipRotationSwing(
    clip: AnimationClip,
    name: string,
    amount: number,
): AnimationClip {
    if (amount >= 1) return clip;
    const a = Math.max(0, amount);
    const mean = new Quaternion();
    const key = new Quaternion();
    const tracks = clip.tracks.map(track => {
        if (!(track instanceof QuaternionKeyframeTrack)) return track;
        const v = track.values;
        const n = Math.floor(v.length / 4);
        if (n < 2) return track;
        // Mean pose: linear average with every key pulled into the FIRST key's
        // hemisphere. q and -q are the same rotation, so averaging across a sign
        // flip would cancel the motion out and hand back a garbage reference.
        let sx = 0, sy = 0, sz = 0, sw = 0;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            const dot = v[o] * v[0] + v[o + 1] * v[1] + v[o + 2] * v[2] + v[o + 3] * v[3];
            const s = dot < 0 ? -1 : 1;
            sx += s * v[o]; sy += s * v[o + 1]; sz += s * v[o + 2]; sw += s * v[o + 3];
        }
        mean.set(sx / n, sy / n, sz / n, sw / n);
        if (mean.lengthSq() < 1e-8) return track; // degenerate — leave it authored
        mean.normalize();

        const out = new Float32Array(v.length);
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            key.set(v[o], v[o + 1], v[o + 2], v[o + 3]);
            // Interpolate FROM the mean TOWARDS the authored key: a < 1 shrinks
            // the excursion, a === 1 reproduces it exactly.
            const scaled = mean.clone().slerp(key, a);
            out[o] = scaled.x; out[o + 1] = scaled.y; out[o + 2] = scaled.z; out[o + 3] = scaled.w;
        }
        const scaledTrack = new QuaternionKeyframeTrack(track.name, Array.from(track.times), Array.from(out));
        scaledTrack.setInterpolation(track.getInterpolation());
        return scaledTrack as KeyframeTrack;
    });
    return new AnimationClip(name, clip.duration, tracks);
}

/**
 * Split `clip` into disjoint lower-body and upper-body clips. Either half can
 * come back with zero tracks (a rig whose attack clip never touches the legs),
 * which callers should treat as "no layer needed".
 */
export function splitClipByBody(
    clip: AnimationClip,
    rootName?: string,
): { lower: AnimationClip; upper: AnimationClip } {
    return {
        lower: filterClipTracks(clip, `${clip.name}__lower`, n => isLowerBodyBone(n, rootName)),
        upper: filterClipTracks(clip, `${clip.name}__upper`, n => !isLowerBodyBone(n, rootName)),
    };
}
