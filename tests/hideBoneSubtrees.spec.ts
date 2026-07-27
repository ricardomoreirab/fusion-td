import { describe, it, expect } from 'vitest';
import {
    Bone, Box3, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial,
    Object3D, PointLight, Skeleton, SkinnedMesh, Vector3,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { hideBoneSubtrees } from '../src/engine/three/hideBoneSubtrees';

/** A minimal rig in the shape every shipped GLB has: an Object3D armature
 *  carrying one root bone chain plus a sibling SkinnedMesh bound to it. */
function buildRig(chain = 3): { rig: Group; root: Bone; leaf: Bone; skinned: SkinnedMesh } {
    const rig = new Group();
    rig.name = 'rig';

    const bones: Bone[] = [];
    let parent: Object3D = rig;
    for (let i = 0; i < chain; i++) {
        const bone = new Bone();
        bone.name = `Bip001_${i}`;
        bone.position.set(0, 1, 0);
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

    return { rig, root: bones[0], leaf: bones[bones.length - 1], skinned };
}

describe('hideBoneSubtrees', () => {
    it('hides the skeleton root so the renderer walk skips the whole chain', () => {
        const { rig, root, skinned } = buildRig(4);

        expect(hideBoneSubtrees(rig)).toBe(4);
        expect(root.visible).toBe(false);

        // traverseVisible has exactly the prune shape of WebGLRenderer's
        // projectObject and WebGLShadowMap's renderObject: a `visible === false`
        // early return placed BEFORE the children loop.
        const walked: string[] = [];
        rig.traverseVisible(n => walked.push(n.name));
        expect(walked).toEqual(['rig', 'body']);
        expect(skinned.visible).toBe(true);
    });

    it('leaves the bones below the root visible - only the root prunes the walk', () => {
        const { rig, root, leaf } = buildRig(3);
        hideBoneSubtrees(rig);
        expect(root.visible).toBe(false);
        expect(leaf.visible).toBe(true);
    });

    it('still computes bone world matrices - updateMatrixWorld ignores visible', () => {
        const before = buildRig(3);
        before.rig.updateMatrixWorld(true);
        const expected = new Vector3().setFromMatrixPosition(before.leaf.matrixWorld);

        const after = buildRig(3);
        hideBoneSubtrees(after.rig);
        after.rig.updateMatrixWorld(true);
        const actual = new Vector3().setFromMatrixPosition(after.leaf.matrixWorld);

        expect(expected.y).toBe(3);
        expect(actual.toArray()).toEqual(expected.toArray());
    });

    it('produces identical skinning matrices with the skeleton hidden', () => {
        const visible = buildRig(3);
        visible.rig.updateMatrixWorld(true);
        visible.skinned.skeleton.update();

        const hidden = buildRig(3);
        hideBoneSubtrees(hidden.rig);
        hidden.rig.updateMatrixWorld(true);
        hidden.skinned.skeleton.update();

        expect(Array.from(hidden.skinned.skeleton.boneMatrices ?? []))
            .toEqual(Array.from(visible.skinned.skeleton.boneMatrices ?? []));
        expect(visible.skinned.skeleton.boneMatrices?.length).toBe(48);
    });

    it('keeps Box3.setFromObject measuring the rig', () => {
        const { rig } = buildRig(3);
        const before = new Box3().setFromObject(rig);
        hideBoneSubtrees(rig);
        const after = new Box3().setFromObject(rig);
        expect(after.min.toArray()).toEqual(before.min.toArray());
        expect(after.max.toArray()).toEqual(before.max.toArray());
    });

    it('declines a skeleton that carries a renderable - a weapon under a hand bone', () => {
        const { rig, root, leaf } = buildRig(3);
        leaf.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));

        expect(hideBoneSubtrees(rig)).toBe(0);
        expect(root.visible).toBe(true);
    });

    it('declines a skeleton that carries a light - a torch parented to a bone', () => {
        const { rig, root, leaf } = buildRig(3);
        leaf.add(new PointLight(0xffffff, 1));

        expect(hideBoneSubtrees(rig)).toBe(0);
        expect(root.visible).toBe(true);
    });

    it('handles a rig with two independent skeleton roots', () => {
        const rig = new Group();
        for (let i = 0; i < 2; i++) {
            const a = new Bone();
            const b = new Bone();
            a.add(b);
            rig.add(a);
        }
        expect(hideBoneSubtrees(rig)).toBe(4);
        expect(rig.children.every(c => c.visible === false)).toBe(true);
    });

    it('is idempotent', () => {
        const { rig } = buildRig(3);
        expect(hideBoneSubtrees(rig)).toBe(3);
        expect(hideBoneSubtrees(rig)).toBe(3);
    });

    it('is a no-op on a graph with no bones', () => {
        const group = new Group();
        const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
        group.add(mesh);
        expect(hideBoneSubtrees(group)).toBe(0);
        expect(mesh.visible).toBe(true);
        expect(group.visible).toBe(true);
    });

    it('survives SkeletonUtils.clone, which is how every instance inherits it', () => {
        const { rig } = buildRig(3);
        hideBoneSubtrees(rig);

        const copy = cloneSkinned(rig) as Group;
        const walked: string[] = [];
        copy.traverseVisible(n => walked.push(n.name));
        expect(walked).toEqual(['rig', 'body']);

        // The clone's skeleton is still bound to the CLONE's bones, so the
        // hidden flag cannot have cost it its rig.
        const skinned = copy.getObjectByName('body') as SkinnedMesh;
        expect(skinned.skeleton.bones.length).toBe(3);
        expect(skinned.skeleton.bones[0]).not.toBe((rig.getObjectByName('body') as SkinnedMesh).skeleton.bones[0]);
    });
});
