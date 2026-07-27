import { describe, it, expect } from 'vitest';
import { AnimationClip, Bone, Group, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { findSkeletonRootName, isLowerBodyBone, scaleClipRotationSwing, splitClipByBody, trackTargetName } from '../src/engine/three/clipMask';

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

describe('scaleClipRotationSwing', () => {
    /** A bone swinging +-90 degrees about X, plus a constant position track. */
    function swingClip(): AnimationClip {
        const q = new Quaternion();
        const keys: number[] = [];
        for (const ang of [-Math.PI / 2, 0, Math.PI / 2, 0]) {
            q.setFromAxisAngle(new Vector3(1, 0, 0), ang);
            keys.push(q.x, q.y, q.z, q.w);
        }
        return new AnimationClip('run__lower', 1, [
            new QuaternionKeyframeTrack('Bip001 L Thigh.quaternion', [0, 0.25, 0.5, 0.75], keys),
            new VectorKeyframeTrack('Bip001.position', [0, 0.5], [0, 1, 0, 0, 1.4, 0]),
        ]);
    }

    /** Peak-to-peak angle across a quaternion track. */
    function swingDeg(track: QuaternionKeyframeTrack): number {
        const v = track.values;
        const a = new Quaternion(), b = new Quaternion();
        let max = 0;
        for (let i = 0; i + 4 <= v.length; i += 4) {
            a.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
            for (let j = i + 4; j + 4 <= v.length; j += 4) {
                b.set(v[j], v[j + 1], v[j + 2], v[j + 3]);
                max = Math.max(max, a.angleTo(b) * 180 / Math.PI);
            }
        }
        return max;
    }

    it('shrinks the rotation swing by the requested factor', () => {
        const src = swingClip();
        const before = swingDeg(src.tracks[0] as QuaternionKeyframeTrack);
        expect(before).toBeCloseTo(180, 0);
        const out = scaleClipRotationSwing(src, 'damped', 0.75);
        expect(swingDeg(out.tracks[0] as QuaternionKeyframeTrack)).toBeCloseTo(before * 0.75, 0);
    });

    it('leaves position tracks untouched — body height and travel stay authored', () => {
        const out = scaleClipRotationSwing(swingClip(), 'damped', 0.5);
        const pos = out.tracks.find(t => t.name.endsWith('.position'))!;
        const expected = [0, 1, 0, 0, 1.4, 0];
        Array.from(pos.values).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
    });

    it('keeps the mean pose, so the stance neither sinks nor leans', () => {
        // The authored swing is symmetric about identity, so the damped clip must
        // still pass through identity at the same keys.
        const out = scaleClipRotationSwing(swingClip(), 'damped', 0.5);
        const v = (out.tracks[0] as QuaternionKeyframeTrack).values;
        const mid = new Quaternion(v[4], v[5], v[6], v[7]);
        expect(mid.angleTo(new Quaternion())).toBeCloseTo(0, 4);
    });

    it('preserves name, duration and track count', () => {
        const src = swingClip();
        const out = scaleClipRotationSwing(src, 'damped', 0.75);
        expect(out.name).toBe('damped');
        expect(out.duration).toBe(src.duration);
        expect(out.tracks.length).toBe(src.tracks.length);
    });

    it('amount >= 1 hands back the clip unchanged', () => {
        const src = swingClip();
        expect(scaleClipRotationSwing(src, 'damped', 1)).toBe(src);
    });

    it('does not mutate the source clip', () => {
        const src = swingClip();
        const before = Array.from(src.tracks[0].values);
        scaleClipRotationSwing(src, 'damped', 0.5);
        expect(Array.from(src.tracks[0].values)).toEqual(before);
    });
});
