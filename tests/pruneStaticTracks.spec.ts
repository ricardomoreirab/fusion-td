import { describe, it, expect } from 'vitest';
import {
    AnimationClip, AnimationMixer, Bone, Group, NumberKeyframeTrack, Object3D,
    QuaternionKeyframeTrack, VectorKeyframeTrack,
} from 'three';
import { pruneStaticTracks } from '../src/engine/three/pruneStaticTracks';

const TIMES = [0, 0.5, 1];

/** A two-bone rig with a non-identity bind pose, so "equal to bind" is a real
 *  test rather than "equal to zero". */
function rig(): { root: Group; hips: Bone; spine: Bone } {
    const root = new Group();
    root.name = 'Armature';
    const hips = new Bone();
    hips.name = 'Bip001';
    hips.position.set(0, 1.2, 0);
    hips.scale.set(1, 1, 1);
    const spine = new Bone();
    spine.name = 'Bip001_Spine';
    spine.position.set(0, 0.4, 0);
    root.add(hips);
    hips.add(spine);
    return { root, hips, spine };
}

function constVec(name: string, x: number, y: number, z: number): VectorKeyframeTrack {
    return new VectorKeyframeTrack(name, TIMES, [x, y, z, x, y, z, x, y, z]);
}

function movingVec(name: string): VectorKeyframeTrack {
    return new VectorKeyframeTrack(name, TIMES, [0, 1.2, 0, 0, 1.9, 0, 0, 1.2, 0]);
}

function spin(name: string): QuaternionKeyframeTrack {
    return new QuaternionKeyframeTrack(name, TIMES, [0, 0, 0, 1, 0, 0.38, 0, 0.92, 0, 0, 0, 1]);
}

describe('pruneStaticTracks', () => {
    it('removes a constant track that already sits on the bind value', () => {
        const { root } = rig();
        const clip = new AnimationClip('run', 1, [
            spin('Bip001.quaternion'),
            constVec('Bip001.scale', 1, 1, 1),
            constVec('Bip001_Spine.scale', 1, 1, 1),
        ]);

        expect(pruneStaticTracks(root, [clip])).toBe(2);
        expect(clip.tracks.map(t => t.name)).toEqual(['Bip001.quaternion']);
    });

    it('keeps a constant track whose value differs from the bind pose', () => {
        const { root } = rig();
        // Bind scale is 1; a clip pinning it at 1.5 is a real (if static) pose.
        const clip = new AnimationClip('run', 1, [
            spin('Bip001.quaternion'),
            constVec('Bip001.scale', 1.5, 1.5, 1.5),
        ]);

        expect(pruneStaticTracks(root, [clip])).toBe(0);
        expect(clip.tracks).toHaveLength(2);
    });

    it('keeps a track that is constant in one clip but animated in another', () => {
        const { root } = rig();
        // `idle` pins the hips at bind; `run` bounces them. Dropping idle's track
        // would leave the hips wherever run stopped.
        const idle = new AnimationClip('idle', 1, [constVec('Bip001.position', 0, 1.2, 0)]);
        const run = new AnimationClip('run', 1, [movingVec('Bip001.position')]);

        expect(pruneStaticTracks(root, [idle, run])).toBe(0);
        expect(idle.tracks).toHaveLength(1);
        expect(run.tracks).toHaveLength(1);
    });

    it('vetoes across clips regardless of the order they are seen in', () => {
        const { root } = rig();
        const run = new AnimationClip('run', 1, [movingVec('Bip001.position')]);
        const idle = new AnimationClip('idle', 1, [constVec('Bip001.position', 0, 1.2, 0)]);

        expect(pruneStaticTracks(root, [run, idle])).toBe(0);
    });

    it('keeps tracks whose target node cannot be resolved', () => {
        const { root } = rig();
        const clip = new AnimationClip('run', 1, [
            spin('Bip001.quaternion'),
            constVec('GhostBone.scale', 1, 1, 1),
        ]);

        expect(pruneStaticTracks(root, [clip])).toBe(0);
    });

    it('keeps non-TRS tracks (morph targets, indexed properties, material paths)', () => {
        const { root } = rig();
        const head = new Object3D();
        head.name = 'Head';
        root.add(head);
        const clip = new AnimationClip('emote', 1, [
            spin('Bip001.quaternion'),
            new NumberKeyframeTrack('Head.morphTargetInfluences[2]', TIMES, [0, 0, 0]),
            new NumberKeyframeTrack('Head.material.opacity', TIMES, [1, 1, 1]),
        ]);

        expect(pruneStaticTracks(root, [clip])).toBe(0);
        expect(clip.tracks).toHaveLength(3);
    });

    it('keeps tracks whose stride does not match the property (cubic-spline samplers)', () => {
        const { root } = rig();
        // GLTF CUBICSPLINE stores [inTangent, value, outTangent] per key, so the
        // values array is 3x the element size and the raw run is NOT constant.
        const cubic = new VectorKeyframeTrack(
            'Bip001.scale', TIMES,
            [0, 0, 0, 1, 1, 1, 0, 0, 0,
             0, 0, 0, 1, 1, 1, 0, 0, 0,
             0, 0, 0, 1, 1, 1, 0, 0, 0],
        );
        const clip = new AnimationClip('run', 1, [spin('Bip001.quaternion'), cubic]);

        expect(pruneStaticTracks(root, [clip])).toBe(0);
    });

    it('never leaves a clip with zero tracks', () => {
        const { root } = rig();
        const clip = new AnimationClip('inert', 1, [
            constVec('Bip001.scale', 1, 1, 1),
            constVec('Bip001_Spine.scale', 1, 1, 1),
        ]);

        expect(pruneStaticTracks(root, [clip])).toBe(0);
        expect(clip.tracks).toHaveLength(2);
    });

    it('leaves the mixer root\'s own channels alone — game code owns that transform', () => {
        const { root } = rig();
        const clip = new AnimationClip('run', 1, [
            spin('Bip001.quaternion'),
            constVec('Armature.scale', 1, 1, 1),
        ]);

        expect(pruneStaticTracks(root, [clip])).toBe(0);
    });

    it('preserves clip duration', () => {
        const { root } = rig();
        const clip = new AnimationClip('run', 4.25, [
            spin('Bip001.quaternion'),
            constVec('Bip001.scale', 1, 1, 1),
        ]);

        pruneStaticTracks(root, [clip]);
        expect(clip.duration).toBe(4.25);
    });

    it('is a no-op on an empty clip list', () => {
        const { root } = rig();
        expect(pruneStaticTracks(root, [])).toBe(0);
    });

    it('snaps the node to the removed track\'s float32 value', () => {
        const { root, spine } = rig();
        const clip = new AnimationClip('run', 1, [
            spin('Bip001.quaternion'),
            constVec('Bip001_Spine.position', 0, 0.4, 0),
        ]);

        expect(spine.position.y).toBe(0.4);
        pruneStaticTracks(root, [clip]);
        // What the sampler would have written on frame 1 — see snapToTrackValue.
        expect(spine.position.y).toBe(Math.fround(0.4));
        expect(spine.position.y).not.toBe(0.4);
    });

    it('leaves bind values untouched for tracks it keeps', () => {
        const { root, hips } = rig();
        const run = new AnimationClip('run', 1, [movingVec('Bip001.position')]);
        const idle = new AnimationClip('idle', 1, [constVec('Bip001.position', 0, 1.2, 0)]);

        pruneStaticTracks(root, [run, idle]);
        expect(hips.position.y).toBe(1.2);
    });
});

describe('pruneStaticTracks — pose equivalence', () => {
    /** Sample every bone transform after driving `clips` through a real mixer. */
    function poseTrace(
        build: () => { root: Group; clips: AnimationClip[] },
        prune: boolean,
        order: string[],
    ): number[] {
        const { root, clips } = build();
        if (prune) pruneStaticTracks(root, clips);
        const mixer = new AnimationMixer(root);
        const trace: number[] = [];
        for (const clipName of order) {
            const clip = clips.find(c => c.name === clipName)!;
            mixer.stopAllAction();
            mixer.clipAction(clip).play();
            for (let f = 0; f < 20; f++) {
                mixer.update(1 / 30);
                root.traverse(node => {
                    trace.push(
                        node.position.x, node.position.y, node.position.z,
                        node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w,
                        node.scale.x, node.scale.y, node.scale.z,
                    );
                });
            }
        }
        return trace;
    }

    /** run bounces the hips; idle pins them at bind. Both pin every scale. */
    function build(): { root: Group; clips: AnimationClip[] } {
        const { root } = rig();
        const run = new AnimationClip('run', 1, [
            spin('Bip001.quaternion'),
            spin('Bip001_Spine.quaternion'),
            movingVec('Bip001.position'),
            constVec('Bip001_Spine.position', 0, 0.4, 0),
            constVec('Bip001.scale', 1, 1, 1),
            constVec('Bip001_Spine.scale', 1, 1, 1),
        ]);
        const idle = new AnimationClip('idle', 1, [
            spin('Bip001_Spine.quaternion'),
            constVec('Bip001.position', 0, 1.2, 0),
            constVec('Bip001_Spine.position', 0, 0.4, 0),
            constVec('Bip001.scale', 1, 1, 1),
            constVec('Bip001_Spine.scale', 1, 1, 1),
        ]);
        return { root, clips: [run, idle] };
    }

    it('produces a bit-identical pose trace across a clip switch', () => {
        const order = ['run', 'idle', 'run'];
        expect(poseTrace(build, true, order)).toEqual(poseTrace(build, false, order));
    });

    it('drops only the provably inert half of the track set', () => {
        const { root, clips } = build();
        const before = clips.reduce((n, c) => n + c.tracks.length, 0);
        // Both scale pairs go; Bip001.position stays (run animates it), and so
        // does Bip001_Spine.position — it sits at bind, so it goes too.
        expect(pruneStaticTracks(root, clips)).toBe(6);
        expect(clips.reduce((n, c) => n + c.tracks.length, 0)).toBe(before - 6);
        expect(clips[0].tracks.map(t => t.name)).toEqual([
            'Bip001.quaternion', 'Bip001_Spine.quaternion', 'Bip001.position',
        ]);
        expect(clips[1].tracks.map(t => t.name)).toEqual([
            'Bip001_Spine.quaternion', 'Bip001.position',
        ]);
    });
});
