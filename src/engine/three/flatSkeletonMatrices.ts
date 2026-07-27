/**
 * flatSkeletonMatrices - replace THREE's recursive world-matrix walk over a
 * rig's skeleton with a flat, depth-ordered loop that computes exactly the same
 * matrices.
 *
 * `scene.updateMatrixWorld()` is the second-largest CPU item in the frame (the
 * animation bus is the first), and it is almost entirely skeletons: a 272-enemy
 * horde is 7077 bones in an 8705-node graph. `Object3D.updateMatrixWorld` has
 * no visibility or layer gate - it recurses unconditionally - which is exactly
 * what `hideBoneSubtrees` relies on to keep skinning correct, so the bones the
 * renderer no longer walks are still walked here, once per frame, forever.
 *
 * The work each bone actually needs is two matrix ops:
 *
 *     matrix      = compose(position, quaternion, scale)
 *     matrixWorld = parent.matrixWorld * matrix
 *
 * Everything else THREE does per node is bookkeeping for a general graph: a
 * recursive call, the `children` array loop, the `matrixAutoUpdate` /
 * `matrixWorldNeedsUpdate` / `matrixWorldAutoUpdate` branches, and a
 * megamorphic dispatch on `child.updateMatrixWorld`. Because a skeleton's shape
 * is fixed for the life of the instance, that bookkeeping can be hoisted into a
 * one-time depth-first flattening and the per-frame pass becomes an index loop
 * over an array whose order already guarantees a parent is computed before its
 * children.
 *
 * Measured on the paused real scene at ~274 enemies (8226 bones), whole-scene
 * `scene.updateMatrixWorld(true)` averaged over 40 calls, five interleaved
 * rounds: **1.75/1.72/1.47/1.47/1.33 ms recursive vs 1.09/1.07/0.95/0.90/0.84
 * flat** - roughly -40%, ~0.7 ms/frame at horde scale. Inlining THREE's own
 * `compose`/`multiplyMatrices` bodies into the loop was measured too and is
 * inside the noise of calling them (1.06/0.95/0.91/0.81/0.81), so the maths
 * stays THREE's - the win is the walk, not the arithmetic.
 *
 * The result is BIT-IDENTICAL, not merely equivalent: the same two `Matrix4`
 * methods are called on the same operands in the same order. Verified live by
 * snapshotting every bone's `matrixWorld` after a recursive pass and after a
 * flat one - 0 of 131,616 elements differ.
 *
 * Four things make the substitution safe, and each is checked rather than
 * assumed:
 *
 *  1. **Shape.** Every node caches its `children.length` at flatten time and the
 *     loop compares against it. Any `add`/`remove` anywhere in the subtree -
 *     a weapon parented to a hand bone, say - is caught on the first frame
 *     after it happens: the list is rebuilt and THREE's own recursion runs for
 *     that frame.
 *  2. **Matrix flags.** The flat pass assumes `matrixAutoUpdate` and
 *     `matrixWorldAutoUpdate` are true (they are, on every rig node in this
 *     project) so it can skip the branches. Both are re-read per node and a
 *     false one falls back to THREE's recursion, which is the only code that
 *     implements what those flags mean.
 *  3. **No overridden `updateMatrixWorld`.** `SkinnedMesh` overrides it (it
 *     refreshes `bindMatrixInverse`), so a skinned mesh parented under a bone
 *     must not be flattened. Checked over the whole subtree at flatten time; a
 *     subtree that has one is left on THREE's recursion entirely.
 *  4. **`force`.** The flat pass always recomputes, which is what THREE does
 *     whenever `matrixAutoUpdate` is true (`updateMatrix()` sets
 *     `matrixWorldNeedsUpdate`), so the incoming `force` cannot change the
 *     outcome. It is still threaded through to the fallback path, where it can.
 *
 * `Object3D.updateWorldMatrix` (the up-the-chain variant `Box3.setFromObject`
 * and `getWorldPosition` use) is a DIFFERENT method and is untouched.
 */

import { Object3D } from 'three';
import type { Bone } from 'three';

const BASE_UPDATE = Object3D.prototype.updateMatrixWorld;

interface FlatSubtree {
    nodes: Object3D[];
    /** `children.length` of each node at flatten time - the shape fingerprint. */
    childCounts: Int32Array;
}

/**
 * Depth-first flatten of `root`'s subtree, parents always before children.
 *
 * Returns null when the subtree contains a node whose `updateMatrixWorld` is not
 * the plain `Object3D` one - such a node does work this loop does not model.
 */
function flatten(root: Object3D): FlatSubtree | null {
    const nodes: Object3D[] = [];
    const stack: Object3D[] = [root];
    while (stack.length > 0) {
        const node = stack.pop() as Object3D;
        if (node !== root && node.updateMatrixWorld !== BASE_UPDATE) return null;
        nodes.push(node);
        const children = node.children;
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    const childCounts = new Int32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) childCounts[i] = nodes[i].children.length;
    return { nodes, childCounts };
}

function makeFlatUpdate(root: Object3D): { update: (force?: boolean) => void; size: number } | null {
    let subtree = flatten(root);
    if (!subtree) return null;

    const update = (force?: boolean): void => {
        // Null once the subtree has stopped being flattenable; the override
        // uninstalls itself in that case, but a caller may still hold this
        // function (three calls it through the node, tests through a saved ref).
        if (subtree === null) { BASE_UPDATE.call(root, force); return; }
        const nodes = subtree.nodes;
        const counts = subtree.childCounts;
        const n = nodes.length;
        for (let i = 0; i < n; i++) {
            const node = nodes[i];
            if (node.children.length !== counts[i]
                || node.matrixAutoUpdate !== true
                || node.matrixWorldAutoUpdate !== true) {
                // Something this loop does not model. Re-flatten for next frame
                // and hand THIS frame to the implementation that does.
                subtree = flatten(root);
                if (!subtree) delete (root as { updateMatrixWorld?: unknown }).updateMatrixWorld;
                BASE_UPDATE.call(root, force);
                return;
            }
            node.matrix.compose(node.position, node.quaternion, node.scale);
            const parent = node.parent;
            if (parent === null) node.matrixWorld.copy(node.matrix);
            else node.matrixWorld.multiplyMatrices(parent.matrixWorld, node.matrix);
            node.matrixWorldNeedsUpdate = false;
        }
    };
    return { update, size: subtree.nodes.length };
}

/**
 * Install the flat world-matrix pass on every skeleton root below `root`.
 *
 * A skeleton root is a Bone whose parent is not itself a Bone - on these Biped
 * rigs the single `Bip001` node. The override is an OWN property of that bone,
 * so it must be installed per INSTANCE: `Object3D.copy` carries data fields
 * (`visible`, `layers`, ...) but not own methods, which is why
 * `hideBoneSubtrees` can run on the container and this cannot.
 *
 * Returns the number of nodes moved onto the flat pass. Idempotent, and safe on
 * a graph with no bones at all.
 */
export function installFlatSkeletonUpdate(root: Object3D): number {
    const skeletonRoots: Bone[] = [];
    root.traverse(node => {
        const bone = node as Bone;
        if (!bone.isBone) return;
        if ((bone.parent as Bone | null)?.isBone) return;
        skeletonRoots.push(bone);
    });

    let flattened = 0;
    for (const bone of skeletonRoots) {
        if (Object.prototype.hasOwnProperty.call(bone, 'updateMatrixWorld')) {
            bone.traverse(() => { flattened++; });
            continue;
        }
        const flat = makeFlatUpdate(bone);
        if (!flat) continue;
        bone.updateMatrixWorld = flat.update;
        flattened += flat.size;
    }
    return flattened;
}
