import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { GlbContainer } from '../src/engine/three/assets';
import { SceneHost } from '../src/engine/three/SceneHost';
import { collectHitFlash, hitFlashVariant, restoreHitFlash, HIT_TINT } from '../src/survivors/enemies/hitFlash';
import type { FlashSwap, FlashTint } from '../src/survivors/enemies/hitFlash';

/**
 * A one-mesh "rig". No animations: this file is about material ownership, not
 * about the mixer.
 */
function makeContainer(matName = 'body'): GlbContainer {
    const scene = new Group();
    const mesh = new Mesh();
    mesh.name = 'body';
    mesh.material = new MeshStandardMaterial({ name: matName });
    scene.add(mesh);
    return new GlbContainer({ scene, animations: [] } as never);
}

function bodyMaterial(root: Group): MeshStandardMaterial {
    return (root.getObjectByName('body') as Mesh).material as MeshStandardMaterial;
}

describe('GLB instance material ownership', () => {
    it('marks the container source materials as shared and cache-owned', () => {
        const container = makeContainer();
        const source = bodyMaterial(container.gltf.scene as Group);
        expect(source.userData.glbShared).toBe(true);
        // disposeMesh only spares materials carrying this flag.
        expect(source.userData.cached).toBe(true);
    });

    it('shares the container material with every instance by default', () => {
        const host = new SceneHost();
        const container = makeContainer();
        const source = bodyMaterial(container.gltf.scene as Group);

        const a = container.instantiate(host);
        const b = container.instantiate(host);

        expect(bodyMaterial(a.root)).toBe(source);
        expect(bodyMaterial(b.root)).toBe(source);
        a.dispose();
        b.dispose();
    });

    it('ensureOwnMaterials gives each instance a private, unshared clone', () => {
        const host = new SceneHost();
        const container = makeContainer('body');
        const source = bodyMaterial(container.gltf.scene as Group);

        const a = container.instantiate(host);
        const b = container.instantiate(host);
        a.ensureOwnMaterials();

        const own = bodyMaterial(a.root);
        expect(own).not.toBe(source);
        expect(own.name).toBe('body');
        // The clone must not inherit the shared markers, or effects would treat
        // a private copy as untouchable and disposal would skip it.
        expect(own.userData.glbShared).toBeUndefined();
        expect(own.userData.cached).toBeUndefined();
        // The other instance is untouched.
        expect(bodyMaterial(b.root)).toBe(source);
        a.dispose();
        b.dispose();
    });

    it('ensureOwnMaterials is idempotent', () => {
        const host = new SceneHost();
        const inst = makeContainer().instantiate(host);
        inst.ensureOwnMaterials();
        const first = bodyMaterial(inst.root);
        inst.ensureOwnMaterials();
        expect(bodyMaterial(inst.root)).toBe(first);
        inst.dispose();
    });

    it('dispose frees only the materials the instance cloned', () => {
        const host = new SceneHost();
        const container = makeContainer();
        const source = bodyMaterial(container.gltf.scene as Group);
        let sourceDisposals = 0;
        source.addEventListener('dispose', () => { sourceDisposals++; });

        const sharing = container.instantiate(host);
        sharing.dispose();
        expect(sourceDisposals).toBe(0);

        const owning = container.instantiate(host);
        owning.ensureOwnMaterials();
        const own = bodyMaterial(owning.root);
        let ownDisposals = 0;
        own.addEventListener('dispose', () => { ownDisposals++; });
        owning.dispose();
        expect(ownDisposals).toBe(1);
        expect(sourceDisposals).toBe(0);
    });
});

describe('hit flash', () => {
    it('swaps a container-shared material instead of tinting it', () => {
        const host = new SceneHost();
        const container = makeContainer();
        const source = bodyMaterial(container.gltf.scene as Group);
        const a = container.instantiate(host);
        const b = container.instantiate(host);

        const swaps: FlashSwap[] = [];
        const tints: FlashTint[] = [];
        collectHitFlash(a.root.getObjectByName('body') as Mesh, swaps, tints);

        // The flashing enemy shows the tint...
        const shown = bodyMaterial(a.root) as unknown as { emissive: unknown };
        expect(shown).not.toBe(source);
        expect(shown.emissive).toBe(HIT_TINT);
        // ...and nothing else in the horde moved.
        expect(bodyMaterial(b.root)).toBe(source);
        expect(source.emissive.getHex()).toBe(0x000000);
        expect(tints).toHaveLength(0);

        restoreHitFlash(swaps, tints);
        expect(bodyMaterial(a.root)).toBe(source);
        a.dispose();
        b.dispose();
    });

    it('reuses one flash twin per source material, however many enemies flash', () => {
        const host = new SceneHost();
        const container = makeContainer();
        const source = bodyMaterial(container.gltf.scene as Group);

        const seen = new Set<unknown>();
        const instances: { dispose(): void }[] = [];
        for (let i = 0; i < 8; i++) {
            const inst = container.instantiate(host);
            const swaps: FlashSwap[] = [];
            const tints: FlashTint[] = [];
            collectHitFlash(inst.root.getObjectByName('body') as Mesh, swaps, tints);
            seen.add(bodyMaterial(inst.root));
            instances.push(inst);
        }
        expect(seen.size).toBe(1);
        expect(seen.has(hitFlashVariant(source))).toBe(true);
        for (const inst of instances) inst.dispose();
    });

    it('still tints an instance-owned material in place', () => {
        const host = new SceneHost();
        const inst = makeContainer().instantiate(host);
        inst.ensureOwnMaterials();
        const own = bodyMaterial(inst.root);
        const before = own.emissive;

        const swaps: FlashSwap[] = [];
        const tints: FlashTint[] = [];
        collectHitFlash(inst.root.getObjectByName('body') as Mesh, swaps, tints);

        expect(swaps).toHaveLength(0);
        expect(bodyMaterial(inst.root)).toBe(own);
        expect(own.emissive).toBe(HIT_TINT);

        restoreHitFlash(swaps, tints);
        expect(own.emissive).toBe(before);
        inst.dispose();
    });

    it('the flash twin is cache-owned so disposeMesh cannot free it', () => {
        const source = new MeshStandardMaterial({ name: 'rig' });
        source.userData.glbShared = true;
        const variant = hitFlashVariant(source);
        expect(variant.userData.cached).toBe(true);
        // A twin must never be mistaken for a swap SOURCE, or a re-flash would
        // clone a twin of the twin on every hit.
        expect(variant.userData.glbShared).toBeUndefined();
    });

    it('ignores nodes with no material', () => {
        const swaps: FlashSwap[] = [];
        const tints: FlashTint[] = [];
        collectHitFlash({}, swaps, tints);
        expect(swaps).toHaveLength(0);
        expect(tints).toHaveLength(0);
    });
});
