/**
 * hideBoneSubtrees - take a rig's skeleton out of THREE's render-list and
 * shadow-map graph walks while leaving the world-matrix pass that skinning
 * depends on completely intact.
 *
 * Bones are the overwhelming majority of the scene graph in this game: across
 * the 25 shipped rigs a skinned model is 18-61 nodes of which 15-58 are bones
 * (83-95%), so a horde of 200 attached enemies puts ~5200 bones in the scene.
 * None of them is drawable - a Bone is an Object3D with no geometry - yet the
 * renderer walks every one of them, twice:
 *
 *   - `WebGLRenderer.projectObject` recurses the whole graph once per
 *     `renderer.render()` to build the render list. A bone pays the layer test,
 *     the isGroup/isLOD/isLight/isSprite/isMesh/isLine/isPoints type chain and
 *     the recursive call, and contributes nothing.
 *   - `WebGLShadowMap.renderObject` recurses the whole graph once per shadow
 *     update (every 2nd frame here, 3rd under perf trim) for the same nothing.
 *
 * Both functions open with `if (object.visible === false) return;` BEFORE their
 * children loop, so hiding a subtree's root prunes the entire subtree from both
 * walks. `Object3D.updateMatrixWorld` has no such test - it recurses
 * unconditionally - so bone world matrices are still computed exactly as
 * before, which is what `Skeleton.update()` reads (straight off `skeleton.bones`,
 * never through the scene graph). `Box3.setFromObject` likewise ignores
 * `visible`, so the feet-offset measurement every GLB call site makes is
 * unaffected.
 *
 * This is the mirror image of `createTransformHost`: there the node itself had
 * to be dropped while its children kept rendering, which only `layers` can
 * express; here the whole subtree goes, which only `visible` can express.
 *
 * The safety gate is that a bone subtree must carry nothing the renderer would
 * have drawn or collected. That holds for every shipped rig (verified: 0 of 25
 * has a mesh below a bone) but it is checked rather than assumed, because a
 * rig that parents a weapon mesh - or a torch light - under a hand bone would
 * otherwise silently lose it. Anything attached to a bone at RUNTIME is subject
 * to the same rule: attach to the model root (as `Champion.enableTorch` does),
 * or re-show the bone.
 */

import type { Bone, Object3D } from 'three';

/** Does this object contribute anything to a render/shadow graph walk? */
function isRenderRelevant(node: Object3D): boolean {
    const n = node as Object3D & {
        isMesh?: boolean; isLine?: boolean; isPoints?: boolean;
        isSprite?: boolean; isLight?: boolean; isCamera?: boolean;
        isLightProbeGrid?: boolean;
    };
    return n.isMesh === true || n.isLine === true || n.isPoints === true
        || n.isSprite === true || n.isLight === true || n.isCamera === true
        || n.isLightProbeGrid === true;
}

function subtreeIsPureBone(root: Object3D): boolean {
    let pure = true;
    root.traverse(node => {
        if (node !== root && isRenderRelevant(node)) pure = false;
    });
    return pure;
}

/**
 * Hide every skeleton root below `root` from the renderer's graph walks.
 *
 * A skeleton root is a Bone whose parent is not itself a Bone, which on these
 * Biped rigs is the single `Bip001` node. Returns the number of bones dropped
 * from the walks (the whole hidden subtree, not the roots) so callers can log
 * or assert the saving.
 *
 * Idempotent, and safe to call on a graph with no bones at all.
 */
export function hideBoneSubtrees(root: Object3D): number {
    const roots: Bone[] = [];
    root.traverse(node => {
        const bone = node as Bone;
        if (!bone.isBone) return;
        if ((bone.parent as Bone | null)?.isBone) return;
        roots.push(bone);
    });

    let hidden = 0;
    for (const bone of roots) {
        if (!subtreeIsPureBone(bone)) continue;
        bone.visible = false;
        bone.traverse(() => { hidden++; });
    }
    return hidden;
}
