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

import { AnimationClip, Bone, type KeyframeTrack, type Object3D } from 'three';

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
