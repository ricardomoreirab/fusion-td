import { describe, it, expect } from 'vitest';
import {
    AnimationClip, AnimationMixer, Bone, BufferAttribute, BufferGeometry, Euler, Group, LoopRepeat,
    Mesh, MeshBasicMaterial, NumberKeyframeTrack, Object3D, PointLight, Quaternion,
    QuaternionKeyframeTrack, Skeleton, SkinnedMesh, VectorKeyframeTrack,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
    boneNamesDrivenByEuler, detachBoneEulerMirror, syncBoneEuler,
} from '../src/engine/three/boneEulerMirror';

/** A rig in the shape every shipped GLB has: a Group carrying one root bone
 *  chain plus a sibling SkinnedMesh bound to it. */
function buildRig(chain = 4): { rig: Group; bones: Bone[]; skinned: SkinnedMesh } {
    const rig = new Group();
    rig.name = 'rig';

    const bones: Bone[] = [];
    let parent: Object3D = rig;
    for (let i = 0; i < chain; i++) {
        const bone = new Bone();
        bone.name = `Bip001_${i}`;
        bone.position.set(0.25 * i, 1, -0.1 * i);
        bone.quaternion.set(0.1 * i, 0.2, -0.05 * i, 1).normalize();
        parent.add(bone);
        bones.push(bone);
        parent = bone;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(12), 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([
        1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
    ]), 4));
    const skinned = new SkinnedMesh(geometry, new MeshBasicMaterial());
    skinned.name = 'body';
    rig.add(skinned);
    skinned.bind(new Skeleton(bones));

    return { rig, bones, skinned };
}

/** A rotation clip in the shape the shipped GLBs carry: one `.quaternion` track
 *  per bone, which after pruneStaticTracks is all that is left of a clip. */
function rotationClip(name: string, bones: Bone[], seed: number): AnimationClip {
    const tracks = bones.map((bone, i) => {
        const values: number[] = [];
        for (let k = 0; k < 3; k++) {
            const q = new Quaternion().setFromEuler(
                new Euler(0.3 * (k + seed) + 0.11 * i, 0.2 * k - 0.07 * i * seed, 0.15 * k * seed),
            );
            values.push(q.x, q.y, q.z, q.w);
        }
        return new QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 0.5, 1], values);
    });
    return new AnimationClip(name, 1, tracks);
}

function boneList(root: Object3D): Bone[] {
    const out: Bone[] = [];
    root.traverse(node => { if ((node as Bone).isBone) out.push(node as Bone); });
    return out;
}

function eulerOf(bone: Object3D): [number, number, number, string] {
    const r = bone.rotation;
    return [r.x, r.y, r.z, r.order];
}

describe('detachBoneEulerMirror', () => {
    it('detaches every bone below the root and reports the count', () => {
        const { rig } = buildRig(5);
        expect(detachBoneEulerMirror(rig)).toBe(5);
    });

    it('leaves non-bone nodes mirroring as THREE does', () => {
        const { rig, skinned } = buildRig(2);
        const light = new PointLight();
        rig.add(light);
        detachBoneEulerMirror(rig);

        for (const node of [rig, skinned as Object3D, light as Object3D]) {
            node.quaternion.setFromEuler(new Euler(0.4, 0, 0));
            expect(node.rotation.x).toBeCloseTo(0.4, 12);
        }
    });

    it('stops maintaining a detached bone\'s Euler when its quaternion is written', () => {
        const { rig, bones } = buildRig(1);
        const before = eulerOf(bones[0]);
        detachBoneEulerMirror(rig);

        bones[0].quaternion.setFromEuler(new Euler(0.9, -0.4, 0.2));
        expect(eulerOf(bones[0])).toEqual(before);
    });

    it('is a no-op on a graph with no bones, and idempotent on one with them', () => {
        const bare = new Group();
        bare.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
        expect(detachBoneEulerMirror(bare)).toBe(0);

        const { rig, bones } = buildRig(3);
        expect(detachBoneEulerMirror(rig)).toBe(3);
        expect(detachBoneEulerMirror(rig)).toBe(3);
        const before = eulerOf(bones[1]);
        bones[1].quaternion.set(0, 0.7071067811865476, 0, 0.7071067811865476);
        expect(eulerOf(bones[1])).toEqual(before);
    });

    it('keeps the Euler -> quaternion direction wired, so posing via .rotation still works', () => {
        const a = buildRig(3);
        const b = buildRig(3);
        detachBoneEulerMirror(a.rig);

        for (let i = 0; i < 3; i++) {
            a.bones[i].rotation.set(0.2 * i, -0.3, 0.11 * i);
            b.bones[i].rotation.set(0.2 * i, -0.3, 0.11 * i);
            expect(a.bones[i].quaternion.toArray()).toEqual(b.bones[i].quaternion.toArray());
            // ...and the Euler a caller wrote is of course still readable.
            expect(eulerOf(a.bones[i])).toEqual(eulerOf(b.bones[i]));
        }
        a.rig.updateMatrixWorld(true);
        b.rig.updateMatrixWorld(true);
        for (let i = 0; i < 3; i++) {
            expect([...a.bones[i].matrixWorld.elements]).toEqual([...b.bones[i].matrixWorld.elements]);
        }
    });

    it('preserves Euler.order, the one .rotation field THREE itself reads', () => {
        const { rig, bones } = buildRig(2);
        bones[0].rotation.order = 'ZYX';
        detachBoneEulerMirror(rig);
        bones[0].quaternion.setFromEuler(new Euler(0.2, 0.3, 0.4));
        expect(bones[0].rotation.order).toBe('ZYX');
        // Object3D.copy reads exactly this and nothing else off .rotation.
        expect(new Bone().copy(bones[0]).rotation.order).toBe('ZYX');
    });

    it('does not survive SkeletonUtils.clone, which is why the install is per instance', () => {
        const { rig } = buildRig(3);
        detachBoneEulerMirror(rig);
        const clone = cloneSkinned(rig);
        const cloned = boneList(clone);
        expect(cloned).toHaveLength(3);

        cloned[0].quaternion.setFromEuler(new Euler(0.55, 0, 0));
        expect(cloned[0].rotation.x).toBeCloseTo(0.55, 12);
    });
});

describe('boneNamesDrivenByEuler', () => {
    it('collects .rotation and .rotation[x] track targets and nothing else', () => {
        const clip = new AnimationClip('mixed', 1, [
            new QuaternionKeyframeTrack('quatBone.quaternion', [0], [0, 0, 0, 1]),
            new VectorKeyframeTrack('eulerBone.rotation', [0], [0, 0, 0]),
            new NumberKeyframeTrack('componentBone.rotation[x]', [0], [0]),
            new VectorKeyframeTrack('posBone.position', [0], [0, 0, 0]),
            new VectorKeyframeTrack('scaleBone.scale', [0], [1, 1, 1]),
        ]);
        const names = boneNamesDrivenByEuler([clip]);
        expect([...names].sort()).toEqual(['componentBone', 'eulerBone']);
    });

    it('splits on the property separator, not the first dot in a node name', () => {
        const clip = new AnimationClip('dotted', 1, [
            new VectorKeyframeTrack('Bip001 L.Hand.rotation', [0], [0, 0, 0]),
        ]);
        expect([...boneNamesDrivenByEuler([clip])]).toEqual(['Bip001 L.Hand']);
    });

    it('is empty for a rig whose clips are all quaternion tracks', () => {
        const { bones } = buildRig(3);
        expect(boneNamesDrivenByEuler([rotationClip('run', bones, 1)]).size).toBe(0);
    });

    it('exempts an Euler-driven bone so it keeps THREE\'s mirror', () => {
        const { rig, bones } = buildRig(3);
        const exempt = new Set([bones[1].name]);
        expect(detachBoneEulerMirror(rig, exempt)).toBe(2);

        bones[1].quaternion.setFromEuler(new Euler(0.31, 0, 0));
        expect(bones[1].rotation.x).toBeCloseTo(0.31, 12);

        const stale = eulerOf(bones[0]);
        bones[0].quaternion.setFromEuler(new Euler(0.31, 0, 0));
        expect(eulerOf(bones[0])).toEqual(stale);
    });
});

describe('syncBoneEuler', () => {
    it('reproduces bit-exactly the Euler THREE\'s mirror would be holding', () => {
        const a = buildRig(4);
        const b = buildRig(4);
        detachBoneEulerMirror(b.rig);

        for (let frame = 0; frame < 6; frame++) {
            for (let i = 0; i < 4; i++) {
                const q = new Quaternion().setFromEuler(new Euler(0.2 * frame + i, 0.3 - 0.1 * i, 0.05 * frame));
                a.bones[i].quaternion.copy(q);
                b.bones[i].quaternion.copy(q);
                syncBoneEuler(b.bones[i]);
                expect(eulerOf(b.bones[i])).toEqual(eulerOf(a.bones[i]));
            }
        }
    });

    it('returns the bone\'s own Euler and does not re-derive the quaternion from it', () => {
        const { rig, bones } = buildRig(1);
        detachBoneEulerMirror(rig);
        bones[0].quaternion.setFromEuler(new Euler(0.4, 0.9, -0.2));
        const q = bones[0].quaternion.toArray();

        const euler = syncBoneEuler(bones[0]);
        expect(euler).toBe(bones[0].rotation);
        // The Euler write must not fire onRotationChange - that would round-trip
        // the quaternion through angles it was just derived from.
        expect(bones[0].quaternion.toArray()).toEqual(q);
    });

    it('is harmless on a bone whose mirror is still attached', () => {
        const { bones } = buildRig(1);
        bones[0].quaternion.setFromEuler(new Euler(-0.6, 0.15, 0.4));
        const before = eulerOf(bones[0]);
        syncBoneEuler(bones[0]);
        expect(eulerOf(bones[0])).toEqual(before);
    });
});

describe('detachBoneEulerMirror under a real AnimationMixer', () => {
    /** Everything downstream of the mixer must be untouched: the quaternions it
     *  writes, the world matrices composed from them, and the bone matrices
     *  Skeleton.update hands the skinning shader. */
    it('produces a bit-identical pose across a clip switch and a cross-fade', () => {
        const a = buildRig(6);
        const b = buildRig(6);
        detachBoneEulerMirror(b.rig, boneNamesDrivenByEuler([]));

        const clips = (bones: Bone[]) => [rotationClip('run', bones, 1), rotationClip('attack', bones, 2)];
        const ca = clips(a.bones);
        const cb = clips(b.bones);
        const rigs = [
            { rig: a.rig, skinned: a.skinned, mixer: new AnimationMixer(a.rig), clips: ca },
            { rig: b.rig, skinned: b.skinned, mixer: new AnimationMixer(b.rig), clips: cb },
        ];
        for (const r of rigs) {
            const action = r.mixer.clipAction(r.clips[0]);
            action.setLoop(LoopRepeat, Infinity);
            action.play();
        }

        for (let frame = 0; frame < 40; frame++) {
            for (const r of rigs) {
                if (frame === 20) {
                    const next = r.mixer.clipAction(r.clips[1]);
                    next.reset();
                    next.play();
                    next.crossFadeFrom(r.mixer.clipAction(r.clips[0]), 0.25, false);
                }
                r.mixer.update(1 / 60);
                r.rig.updateMatrixWorld(true);
                r.skinned.skeleton.update();
            }

            const [qa, qb] = rigs.map(r => boneList(r.rig).flatMap(x => x.quaternion.toArray()));
            expect(qb).toEqual(qa);
            const [ma, mb] = rigs.map(r => boneList(r.rig).flatMap(x => [...x.matrixWorld.elements]));
            expect(mb).toEqual(ma);
            const boneMatrices = (r: SkinnedMesh): number[] => [...(r.skeleton.boneMatrices ?? [])];
            expect(boneMatrices(rigs[1].skinned)).toEqual(boneMatrices(rigs[0].skinned));
        }

        // ...and the Euler that was skipped all along is recoverable exactly.
        const bonesA = boneList(rigs[0].rig);
        const bonesB = boneList(rigs[1].rig);
        for (let i = 0; i < bonesA.length; i++) {
            syncBoneEuler(bonesB[i]);
            expect(eulerOf(bonesB[i])).toEqual(eulerOf(bonesA[i]));
        }
    });
});
