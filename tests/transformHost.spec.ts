import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { createTransformHost, disposeMesh, isMeshDisposed } from '../src/engine/three/primitives';
import { SceneHost } from '../src/engine/three/SceneHost';

/**
 * `createTransformHost` exists for one reason: keep the geometry-less parent
 * nodes (GLB enemy/hero roots, procedural scale groups) out of THREE's render
 * and shadow passes without hiding the rig hanging off them.
 *
 * THREE's render list cannot be exercised headlessly, but every traversal in
 * the library shares the same gate — `object.layers.test(...)` guards only the
 * object's OWN work and the children loop sits outside it. `Raycaster` is that
 * gate in a form these tests can drive with THREE's real code, so the layer
 * contract is asserted through it rather than through a reimplementation.
 */
function childCube(name: string, x: number): Mesh {
    const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    cube.name = name;
    cube.position.x = x;
    return cube;
}

/** Cast down the -Y axis through `x`, collecting the distinct objects hit
 *  (a box returns one intersection per crossed face). */
function hitNames(root: Mesh, x: number): string[] {
    root.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(x, 10, 0), new Vector3(0, -1, 0));
    return [...new Set(ray.intersectObject(root, true).map(h => h.object.name))].sort();
}

describe('createTransformHost', () => {
    it('names the host and parents it to the scene when a host is given', () => {
        const scene = new SceneHost();
        const host = createTransformHost('enemyGlbRoot', scene);

        expect(host.name).toBe('enemyGlbRoot');
        expect(host.parent).toBe(scene.scene);
    });

    it('leaves the host unparented when no scene is given', () => {
        expect(createTransformHost('bare').parent).toBeNull();
    });

    it('disables every layer, so no camera can select the host itself', () => {
        // mask 0 fails layers.test() for ANY camera layer set, which is what
        // drops the node from projectObject and from WebGLShadowMap.
        expect(createTransformHost('h').layers.mask).toBe(0);
    });

    it('stays visible, because projectObject returns BEFORE recursing on visible=false', () => {
        // The whole point is to skip the host while still drawing its children.
        // `visible = false` would skip the subtree too.
        expect(createTransformHost('h').visible).toBe(true);
    });

    it('is skipped by a traversal that gates on layers while its children are not', () => {
        // Same gate shape as WebGLRenderer.projectObject / WebGLShadowMap.renderObject:
        // layers.test() guards the node's own work, the children loop is outside it.
        const host = createTransformHost('host');
        host.add(childCube('child', 0));

        expect(hitNames(host, 0)).toEqual(['child']);
    });

    it('would be hit if its layers were left enabled (control)', () => {
        const host = createTransformHost('host');
        host.geometry = new BoxGeometry(4, 1, 4);
        host.add(childCube('child', 0));

        expect(hitNames(host, 0)).toEqual(['child']);

        host.layers.enableAll();
        expect(hitNames(host, 0)).toEqual(['child', 'host']);
    });

    it('keeps children selectable on the default layer', () => {
        const host = createTransformHost('host');
        const child = childCube('child', 0);
        host.add(child);

        expect(child.layers.mask).toBe(1);
    });

    it('still measures its children through Box3.setFromObject (the feet-offset contract)', () => {
        // Every GLB call site does `new Box3().setFromObject(host)` and shifts the
        // rig by -bbox.min.y. Box3 ignores layers; this pins that it keeps doing so.
        const host = createTransformHost('host');
        const child = childCube('child', 0);
        child.position.set(0, 3, 0);
        host.add(child);
        host.updateMatrixWorld(true);

        const bbox = new Box3().setFromObject(host);
        expect(bbox.min.y).toBeCloseTo(2.5, 6);
        expect(bbox.max.y).toBeCloseTo(3.5, 6);
    });

    it('goes through the normal disposal funnel with its subtree', () => {
        const scene = new SceneHost();
        const host = createTransformHost('host', scene);
        const child = childCube('child', 0);
        host.add(child);

        disposeMesh(host, { materials: true });

        expect(isMeshDisposed(host)).toBe(true);
        expect(isMeshDisposed(child)).toBe(true);
        expect(host.parent).toBeNull();
    });
});
