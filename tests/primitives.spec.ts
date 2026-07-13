import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';
import {
    clearGeometryCache,
    createBox,
    createGround,
    createSphere,
    createTorus,
    disposeMesh,
    getCachedGeometry,
    getGeometryCacheSize,
    isMeshDisposed,
} from '../src/engine/three/primitives';

describe('primitives', () => {
    it('creates named meshes and adds them to the host scene', () => {
        const host = new SceneHost();
        const box = createBox('b', { width: 2, height: 1, depth: 3 }, host);
        expect(box.name).toBe('b');
        expect(box.parent).toBe(host.scene);
    });

    it('every create call allocates fresh geometry (Babylon lifecycle parity)', () => {
        const a = createSphere('a', { diameter: 1 });
        const b = createSphere('b', { diameter: 1 });
        expect(a.geometry).not.toBe(b.geometry);
    });

    it('torus and ground bake their Babylon orientations into geometry', () => {
        // torus flat in XZ: its Y extent equals the tube thickness, not the diameter
        const torus = createTorus('t', { diameter: 4, thickness: 0.2 });
        torus.geometry.computeBoundingBox();
        const tb = torus.geometry.boundingBox!;
        expect(tb.max.y - tb.min.y).toBeLessThan(0.5);
        expect(tb.max.x - tb.min.x).toBeGreaterThan(3);
        // ground flat in XZ
        const ground = createGround('g', { width: 10, height: 10 });
        ground.geometry.computeBoundingBox();
        const gb = ground.geometry.boundingBox!;
        expect(gb.max.y - gb.min.y).toBeLessThan(0.001);
    });
});

describe('disposeMesh', () => {
    it('removes from parent, marks disposed, and frees geometry', () => {
        const host = new SceneHost();
        const box = createBox('b', {}, host);
        let geoDisposed = false;
        box.geometry.addEventListener('dispose', () => (geoDisposed = true));
        disposeMesh(box);
        expect(box.parent).toBeNull();
        expect(isMeshDisposed(box)).toBe(true);
        expect(geoDisposed).toBe(true);
    });

    it('is idempotent', () => {
        const box = createBox('b', {});
        disposeMesh(box);
        expect(() => disposeMesh(box)).not.toThrow();
    });

    it('keeps the shared default material and cache-owned resources alive', () => {
        const host = new SceneHost();
        const a = createBox('a', {}, host);
        const b = createBox('b', {}, host);
        expect(a.material).toBe(b.material); // shared placeholder
        disposeMesh(a, { materials: true });
        let sharedDisposed = false;
        (b.material as MeshBasicMaterial).addEventListener('dispose', () => (sharedDisposed = true));
        disposeMesh(b, { materials: true });
        expect(sharedDisposed).toBe(false);

        const cachedGeo = getCachedGeometry('unit-box', () => new BoxGeometry(1, 1, 1));
        const mesh = new Mesh(cachedGeo, new MeshBasicMaterial());
        mesh.userData.ownedMaterial = true;
        let cachedGeoDisposed = false;
        cachedGeo.addEventListener('dispose', () => (cachedGeoDisposed = true));
        let ownedMatDisposed = false;
        (mesh.material as MeshBasicMaterial).addEventListener('dispose', () => (ownedMatDisposed = true));
        disposeMesh(mesh);
        expect(cachedGeoDisposed).toBe(false); // cache-owned survives
        expect(ownedMatDisposed).toBe(true); // ownedMaterial flag frees it
        clearGeometryCache();
    });

    it('disposes the whole subtree', () => {
        const parent = createBox('p', {});
        const child = createBox('c', {});
        parent.add(child);
        let childGeoDisposed = false;
        child.geometry.addEventListener('dispose', () => (childGeoDisposed = true));
        disposeMesh(parent);
        expect(childGeoDisposed).toBe(true);
        expect(isMeshDisposed(child)).toBe(true);
    });
});

describe('geometry cache', () => {
    it('returns the same instance per key and clears on demand', () => {
        clearGeometryCache();
        const a = getCachedGeometry('k', () => new BoxGeometry());
        const b = getCachedGeometry('k', () => new BoxGeometry());
        expect(a).toBe(b);
        expect(getGeometryCacheSize()).toBe(1);
        let disposed = false;
        a.addEventListener('dispose', () => (disposed = true));
        clearGeometryCache();
        expect(disposed).toBe(true);
        expect(getGeometryCacheSize()).toBe(0);
    });
});
