import { afterEach, describe, expect, it } from 'vitest';
import { clearMaterialCache, getCachedMaterial } from '../src/engine/rendering/MaterialCache';
import { createEmissiveMaterial, createLowPolyMaterial, setMeshOpacity } from '../src/engine/rendering/LowPolyMaterial';
import { createBox, disposeMesh } from '../src/engine/three/primitives';
import { Color } from 'three';

afterEach(() => clearMaterialCache());

describe('material factories', () => {
    it('createLowPolyMaterial clones the input color (no shared-constant mutation)', () => {
        const input = new Color(0.5, 0.2, 0.1);
        const mat = createLowPolyMaterial('m', input);
        mat.color.set(1, 1, 1);
        expect(input.r).toBeCloseTo(0.5);
    });

    it('createEmissiveMaterial scales emissive without touching the input', () => {
        const input = new Color(1, 0.5, 0);
        const mat = createEmissiveMaterial('m', input, 0.5);
        expect(mat.emissive.r).toBeCloseTo(0.5);
        expect(input.r).toBe(1);
    });
});

describe('setMeshOpacity', () => {
    it('clones a shared material once and reuses the owned clone', () => {
        const mesh = createBox('b', {});
        const shared = mesh.material;
        setMeshOpacity(mesh, 0.5);
        expect(mesh.material).not.toBe(shared);
        const owned = mesh.material;
        setMeshOpacity(mesh, 0.25);
        expect(mesh.material).toBe(owned);
        expect((owned as { opacity: number }).opacity).toBeCloseTo(0.25);
        expect(mesh.userData.ownedMaterial).toBe(true);
    });

    it('a clone of a CACHED material loses the cached flag so disposeMesh frees it', () => {
        // Regression guard: Material.clone() copies userData - without
        // clearing it, every faded FX mesh whose material came from
        // getCachedMaterial would leak one material (the recurring-freeze
        // bug class).
        const mesh = createBox('b', {});
        mesh.material = getCachedMaterial('fx_red', m => m.color.set('#ff0000'));
        setMeshOpacity(mesh, 0.5);
        expect((mesh.material as { userData: { cached?: boolean } }).userData.cached).toBe(false);
        let ownedDisposed = false;
        (mesh.material as unknown as { addEventListener: (e: string, cb: () => void) => void })
            .addEventListener('dispose', () => (ownedDisposed = true));
        disposeMesh(mesh);
        expect(ownedDisposed).toBe(true);
    });
});
