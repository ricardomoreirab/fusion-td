import { describe, it, expect } from 'vitest';
import { AnimationClip, Bone, Group, Object3D, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { findSkeletonRootName, isLowerBodyBone, splitClipByBody, trackTargetName } from '../src/engine/three/clipMask';

/** The real Biped bone set shipped by the champion GLBs. */
const BIPED = [
    'Bip001', 'Bip001 Pelvis', 'Bip001 Spine', 'Bip001 Spine1', 'Bip001 Neck', 'Bip001 Head',
    'Bip001 L Clavicle', 'Bip001 L UpperArm', 'Bip001 L Forearm', 'Bip001 L Hand', 'Bip001 L Finger0',
    'Bip001 R Clavicle', 'Bip001 R UpperArm', 'Bip001 R Forearm', 'Bip001 R Hand', 'Bip001 R Finger0',
    'Bip001 L Thigh', 'Bip001 L Calf', 'Bip001 L Foot',
    'Bip001 R Thigh', 'Bip001 R Calf', 'Bip001 R Foot',
];

function clipOver(bones: string[], duration = 1.033): AnimationClip {
    const tracks = bones.map(b => new QuaternionKeyframeTrack(`${b}.quaternion`, [0, duration], [0, 0, 0, 1, 0, 0, 0, 1]));
    return new AnimationClip('run', duration, tracks);
}

describe('trackTargetName', () => {
    it('takes everything before the LAST dot — bone names contain spaces', () => {
        expect(trackTargetName('Bip001 L Thigh.quaternion')).toBe('Bip001 L Thigh');
        expect(trackTargetName('Bip001.position')).toBe('Bip001');
    });

    it('handles indexed properties', () => {
        expect(trackTargetName('Head.morphTargetInfluences[3]')).toBe('Head');
    });
});

describe('isLowerBodyBone', () => {
    it('classifies the Biped leg chain as lower body', () => {
        for (const b of ['Bip001 Pelvis', 'Bip001 L Thigh', 'Bip001 R Calf', 'Bip001 L Foot']) {
            expect(isLowerBodyBone(b)).toBe(true);
        }
    });

    it('classifies spine, arms and head as upper body', () => {
        for (const b of ['Bip001 Spine', 'Bip001 Neck', 'Bip001 Head', 'Bip001 R UpperArm', 'Bip001 L Hand']) {
            expect(isLowerBodyBone(b)).toBe(false);
        }
    });

    it('treats the named rig root as lower body — it carries whole-body travel', () => {
        // Without this the attack layer would own the root and pin the body in
        // place while the legs ran underneath it.
        expect(isLowerBodyBone('Bip001')).toBe(false);
        expect(isLowerBodyBone('Bip001', 'Bip001')).toBe(true);
    });
});

describe('splitClipByBody', () => {
    it('partitions every track exactly once — no bone in both layers, none dropped', () => {
        const clip = clipOver(BIPED);
        const { lower, upper } = splitClipByBody(clip, 'Bip001');
        expect(lower.tracks.length + upper.tracks.length).toBe(clip.tracks.length);

        const lowerNames = new Set(lower.tracks.map(t => trackTargetName(t.name)));
        const upperNames = new Set(upper.tracks.map(t => trackTargetName(t.name)));
        for (const n of lowerNames) expect(upperNames.has(n)).toBe(false);
        expect(lowerNames.size + upperNames.size).toBe(BIPED.length);
    });

    it('puts the leg chain and root in lower, the swing bones in upper', () => {
        const { lower, upper } = splitClipByBody(clipOver(BIPED), 'Bip001');
        const lowerNames = lower.tracks.map(t => trackTargetName(t.name));
        const upperNames = upper.tracks.map(t => trackTargetName(t.name));
        expect(lowerNames).toContain('Bip001');
        expect(lowerNames).toContain('Bip001 L Thigh');
        expect(lowerNames).toContain('Bip001 Pelvis');
        expect(upperNames).toContain('Bip001 R UpperArm');
        expect(upperNames).toContain('Bip001 Spine');
        expect(upperNames).not.toContain('Bip001 L Foot');
    });

    it('keeps the SOURCE duration on both halves so the layers cannot drift', () => {
        // A derived clip auto-sized from its own tracks would be shorter whenever
        // the filtered tracks end early, and the two layers would desync.
        const clip = clipOver(BIPED, 1.033);
        const { lower, upper } = splitClipByBody(clip, 'Bip001');
        expect(lower.duration).toBe(1.033);
        expect(upper.duration).toBe(1.033);
    });

    it('returns an empty half rather than throwing when a rig has no leg tracks', () => {
        const { lower, upper } = splitClipByBody(clipOver(['Bip001 Spine', 'Bip001 Head']), 'Bip001');
        expect(lower.tracks).toHaveLength(0);
        expect(upper.tracks).toHaveLength(2);
    });

    it('splits position tracks by the same rule as rotation tracks', () => {
        const clip = new AnimationClip('c', 1, [
            new VectorKeyframeTrack('Bip001 Pelvis.position', [0, 1], [0, 0, 0, 0, 1, 0]),
            new VectorKeyframeTrack('Bip001 Head.position', [0, 1], [0, 0, 0, 0, 1, 0]),
        ]);
        const { lower, upper } = splitClipByBody(clip, 'Bip001');
        expect(lower.tracks.map(t => t.name)).toEqual(['Bip001 Pelvis.position']);
        expect(upper.tracks.map(t => t.name)).toEqual(['Bip001 Head.position']);
    });
});

describe('findSkeletonRootName', () => {
    it('finds the top bone under a non-bone model root', () => {
        const root = new Group();
        const wrapper = new Object3D();
        const hips = new Bone(); hips.name = 'Bip001';
        const thigh = new Bone(); thigh.name = 'Bip001 L Thigh';
        hips.add(thigh); wrapper.add(hips); root.add(wrapper);
        expect(findSkeletonRootName(root)).toBe('Bip001');
    });

    it('returns undefined for a rig with no bones', () => {
        expect(findSkeletonRootName(new Group())).toBeUndefined();
    });
});
