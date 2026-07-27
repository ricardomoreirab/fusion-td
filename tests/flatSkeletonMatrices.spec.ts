import { describe, it, expect } from 'vitest';
import {
    Bone, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial,
    Object3D, Skeleton, SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installFlatSkeletonUpdate } from '../src/engine/three/flatSkeletonMatrices';

const BASE_UPDATE = Object3D.prototype.updateMatrixWorld;

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
        bone.scale.set(1 + 0.01 * i, 1, 1 - 0.02 * i);
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

/** Every bone's world matrix, flattened - the thing Skeleton.update() reads. */
function poseOf(rig: Object3D): number[] {
    const out: number[] = [];
    rig.traverse(node => {
        if ((node as Bone).isBone) out.push(...node.matrixWorld.elements);
    });
    return out;
}

/** Drive both a flattened rig and an untouched twin through the same motion and
 *  compare the bone world matrices they produce, frame by frame. */
function comparePose(chain: number, drive: (rig: Group, bones: Bone[], frame: number) => void): void {
    const a = buildRig(chain);
    const b = buildRig(chain);
    installFlatSkeletonUpdate(a.rig);

    for (let frame = 0; frame < 8; frame++) {
        drive(a.rig, a.bones, frame);
        drive(b.rig, b.bones, frame);
        a.rig.updateMatrixWorld();
        b.rig.updateMatrixWorld();
        // Bit-identical, not merely close: the flat pass calls the same two
        // Matrix4 methods on the same operands in the same order.
        expect(poseOf(a.rig)).toEqual(poseOf(b.rig));
    }
}

describe('installFlatSkeletonUpdate', () => {
    it('installs on the skeleton root only, and reports the flattened node count', () => {
        const { rig, bones } = buildRig(5);

        expect(installFlatSkeletonUpdate(rig)).toBe(5);
        expect(Object.prototype.hasOwnProperty.call(bones[0], 'updateMatrixWorld')).toBe(true);
        for (let i = 1; i < bones.length; i++) {
            expect(Object.prototype.hasOwnProperty.call(bones[i], 'updateMatrixWorld')).toBe(false);
        }
    });

    it('produces bit-identical bone world matrices while the rig is animated', () => {
        comparePose(6, (rig, bones, frame) => {
            for (let i = 0; i < bones.length; i++) {
                bones[i].quaternion.set(Math.sin(frame * 0.3 + i), 0.2 * i, Math.cos(frame * 0.17), 1).normalize();
                bones[i].position.set(0.1 * frame, 1 + 0.05 * i, -0.02 * frame);
                bones[i].scale.setScalar(1 + 0.001 * frame * i);
            }
            rig.position.set(frame * 1.5, 0, -frame);
            rig.quaternion.set(0, Math.sin(frame * 0.2), 0, Math.cos(frame * 0.2));
        });
    });

    it('is bit-identical when only the rig root moves (a walking enemy)', () => {
        comparePose(8, (rig, _bones, frame) => {
            rig.position.set(frame * 0.31, 0, frame * -0.77);
        });
    });

    it('matches for a forced update through the model root', () => {
        const a = buildRig(4);
        const b = buildRig(4);
        installFlatSkeletonUpdate(a.rig);
        a.rig.position.set(3, 2, 1);
        b.rig.position.set(3, 2, 1);
        a.rig.updateMatrixWorld(true);
        b.rig.updateMatrixWorld(true);
        expect(poseOf(a.rig)).toEqual(poseOf(b.rig));
    });

    it('clears matrixWorldNeedsUpdate exactly as THREE does', () => {
        const { rig, bones } = buildRig(3);
        installFlatSkeletonUpdate(rig);
        for (const bone of bones) bone.matrixWorldNeedsUpdate = true;
        rig.updateMatrixWorld();
        for (const bone of bones) expect(bone.matrixWorldNeedsUpdate).toBe(false);
    });

    it('updates a NON-bone descendant of a bone like THREE would', () => {
        const a = buildRig(3);
        const b = buildRig(3);
        const attachA = new Object3D();
        const attachB = new Object3D();
        attachA.position.set(0.5, 0.25, -0.75);
        attachB.position.copy(attachA.position);
        a.bones[2].add(attachA);
        b.bones[2].add(attachB);

        installFlatSkeletonUpdate(a.rig);
        a.rig.position.set(1, 2, 3);
        b.rig.position.set(1, 2, 3);
        a.rig.updateMatrixWorld();
        b.rig.updateMatrixWorld();
        expect([...attachA.matrixWorld.elements]).toEqual([...attachB.matrixWorld.elements]);
    });

    it('detects a child added to a bone after flattening and stays correct', () => {
        const a = buildRig(4);
        const b = buildRig(4);
        installFlatSkeletonUpdate(a.rig);
        a.rig.updateMatrixWorld();

        // A weapon parented to a hand bone at runtime - the shape the cached
        // flatten cannot know about until it runs again.
        const weaponA = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
        const weaponB = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
        weaponA.position.set(0.3, -0.4, 0.9);
        weaponB.position.copy(weaponA.position);
        a.bones[3].add(weaponA);
        b.bones[3].add(weaponB);

        a.rig.position.set(-2, 0, 5);
        b.rig.position.set(-2, 0, 5);
        // First pass after the change falls back to THREE's recursion...
        a.rig.updateMatrixWorld();
        b.rig.updateMatrixWorld();
        expect([...weaponA.matrixWorld.elements]).toEqual([...weaponB.matrixWorld.elements]);

        // ...and the re-flatten covers it from the next frame on.
        a.rig.position.set(7, 1, -1);
        b.rig.position.set(7, 1, -1);
        a.rig.updateMatrixWorld();
        b.rig.updateMatrixWorld();
        expect([...weaponA.matrixWorld.elements]).toEqual([...weaponB.matrixWorld.elements]);
        expect(poseOf(a.rig)).toEqual(poseOf(b.rig));
    });

    it('detects a bone removed after flattening and stays correct', () => {
        const a = buildRig(5);
        const b = buildRig(5);
        installFlatSkeletonUpdate(a.rig);
        a.rig.updateMatrixWorld();

        a.bones[3].remove(a.bones[4]);
        b.bones[3].remove(b.bones[4]);
        a.rig.position.set(4, 0, 4);
        b.rig.position.set(4, 0, 4);
        a.rig.updateMatrixWorld();
        b.rig.updateMatrixWorld();
        expect(poseOf(a.rig)).toEqual(poseOf(b.rig));
    });

    it('honours matrixAutoUpdate = false by falling back to THREE', () => {
        const a = buildRig(4);
        const b = buildRig(4);
        installFlatSkeletonUpdate(a.rig);

        a.rig.updateMatrixWorld(true);
        b.rig.updateMatrixWorld(true);
        const pinned = [...a.bones[2].matrix.elements];

        a.bones[2].matrixAutoUpdate = false;
        b.bones[2].matrixAutoUpdate = false;
        // A local transform written without updateMatrix() must NOT reach the
        // matrix - that is the whole meaning of the flag.
        a.bones[2].position.set(9, 9, 9);
        b.bones[2].position.set(9, 9, 9);
        a.rig.updateMatrixWorld(true);
        b.rig.updateMatrixWorld(true);
        expect(poseOf(a.rig)).toEqual(poseOf(b.rig));
        expect([...a.bones[2].matrix.elements]).toEqual(pinned);
    });

    it('honours matrixWorldAutoUpdate = false by falling back to THREE', () => {
        const a = buildRig(4);
        const b = buildRig(4);
        installFlatSkeletonUpdate(a.rig);

        a.bones[1].matrixWorldAutoUpdate = false;
        b.bones[1].matrixWorldAutoUpdate = false;
        a.rig.position.set(6, 6, 6);
        b.rig.position.set(6, 6, 6);
        a.rig.updateMatrixWorld(true);
        b.rig.updateMatrixWorld(true);
        expect(poseOf(a.rig)).toEqual(poseOf(b.rig));
    });

    it('declines a skeleton that carries a SkinnedMesh, whose own updateMatrixWorld does extra work', () => {
        const { rig, bones, skinned } = buildRig(4);
        // SkinnedMesh.updateMatrixWorld refreshes bindMatrixInverse; a flat loop
        // that only composes matrices would silently drop that.
        rig.remove(skinned);
        bones[2].add(skinned);

        expect(installFlatSkeletonUpdate(rig)).toBe(0);
        expect(Object.prototype.hasOwnProperty.call(bones[0], 'updateMatrixWorld')).toBe(false);
        expect(bones[0].updateMatrixWorld).toBe(BASE_UPDATE);
    });

    it('uninstalls itself when a SkinnedMesh is parented under a bone at runtime', () => {
        const { rig, bones, skinned } = buildRig(4);
        installFlatSkeletonUpdate(rig);
        rig.updateMatrixWorld();
        expect(Object.prototype.hasOwnProperty.call(bones[0], 'updateMatrixWorld')).toBe(true);

        rig.remove(skinned);
        bones[2].add(skinned);
        rig.updateMatrixWorld();

        expect(Object.prototype.hasOwnProperty.call(bones[0], 'updateMatrixWorld')).toBe(false);
        expect(bones[0].updateMatrixWorld).toBe(BASE_UPDATE);

        const twin = buildRig(4);
        twin.rig.remove(twin.skinned);
        twin.bones[2].add(twin.skinned);
        rig.position.set(3, -1, 2);
        twin.rig.position.set(3, -1, 2);
        rig.updateMatrixWorld();
        twin.rig.updateMatrixWorld();
        expect(poseOf(rig)).toEqual(poseOf(twin.rig));
        expect([...skinned.bindMatrixInverse.elements])
            .toEqual([...twin.skinned.bindMatrixInverse.elements]);
    });

    it('handles two independent skeleton roots under one model root', () => {
        const rig = new Group();
        const left = new Bone();
        const right = new Bone();
        left.position.set(-1, 0, 0);
        right.position.set(1, 0, 0);
        const leftChild = new Bone();
        leftChild.position.set(0, 2, 0);
        left.add(leftChild);
        rig.add(left, right);

        expect(installFlatSkeletonUpdate(rig)).toBe(3);
        rig.position.set(0, 5, 0);
        rig.updateMatrixWorld();
        expect(leftChild.matrixWorld.elements[13]).toBe(7);
        expect(right.matrixWorld.elements[12]).toBe(1);
    });

    it('is idempotent - a second install neither re-wraps nor changes the pose', () => {
        const { rig, bones } = buildRig(4);
        installFlatSkeletonUpdate(rig);
        const installed = bones[0].updateMatrixWorld;
        expect(installFlatSkeletonUpdate(rig)).toBe(4);
        expect(bones[0].updateMatrixWorld).toBe(installed);

        const twin = buildRig(4);
        rig.position.set(2, 0, 2);
        twin.rig.position.set(2, 0, 2);
        rig.updateMatrixWorld();
        twin.rig.updateMatrixWorld();
        expect(poseOf(rig)).toEqual(poseOf(twin.rig));
    });

    it('is a no-op on a graph with no bones', () => {
        const group = new Group();
        group.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
        expect(installFlatSkeletonUpdate(group)).toBe(0);
    });

    it('does NOT survive SkeletonUtils.clone - it must be installed per instance', () => {
        const { rig, bones } = buildRig(4);
        installFlatSkeletonUpdate(rig);

        const copy = cloneSkinned(rig);
        const copyRoot = copy.getObjectByName(bones[0].name) as Bone;
        expect(copyRoot).toBeDefined();
        expect(Object.prototype.hasOwnProperty.call(copyRoot, 'updateMatrixWorld')).toBe(false);
        expect(installFlatSkeletonUpdate(copy)).toBe(4);
    });

    it('detaching the skeleton root still yields THREE\'s parentless result', () => {
        const { rig, bones } = buildRig(3);
        installFlatSkeletonUpdate(rig);
        rig.remove(bones[0]);
        bones[0].updateMatrixWorld();
        // matrixWorld === matrix when there is no parent.
        expect([...bones[0].matrixWorld.elements]).toEqual([...bones[0].matrix.elements]);
    });
});
