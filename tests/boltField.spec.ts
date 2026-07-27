import { describe, expect, it } from 'vitest';
import { Color, Vector3 } from 'three';
import { BoltField } from '../src/survivors/powers/BoltField';
import { SceneHost } from '../src/engine/three/SceneHost';

const LIFE = 0.18;
const DT = 1 / 60;

function positions(field: BoltField): Float32Array {
    return field.getMesh().geometry.getAttribute('position').array as Float32Array;
}
function colors(field: BoltField): Float32Array {
    return field.getMesh().geometry.getAttribute('color').array as Float32Array;
}
function drawCount(field: BoltField): number {
    return field.getMesh().geometry.drawRange.count;
}
/** Alpha of bolt `i`, read from both of its vertices (they must agree). */
function alphaOf(field: BoltField, i: number): number {
    const c = colors(field);
    expect(c[i * 8 + 7]).toBe(c[i * 8 + 3]);
    return c[i * 8 + 3];
}

function spawn(field: BoltField, from: [number, number, number], to: [number, number, number], color = new Color(0.2, 0.4, 0.9)): void {
    field.spawn(new Vector3(...from), new Vector3(...to), color, LIFE);
}

describe('BoltField', () => {
    it('renders each bolt as one segment of a single shared LineSegments', () => {
        const host = new SceneHost();
        const field = new BoltField(host);

        spawn(field, [1, 2, 3], [4, 5, 6]);
        spawn(field, [7, 8, 9], [10, 11, 12]);

        const mesh = field.getMesh();
        expect(host.scene.children.filter(c => c === mesh)).toHaveLength(1);
        expect(field.liveCount).toBe(2);
        expect(drawCount(field)).toBe(4);
        expect(Array.from(positions(field).subarray(0, 12)))
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        field.dispose();
    });

    it('carries colour AND fade alpha per vertex so diffuse×vColor equals the old per-bolt material', () => {
        const host = new SceneHost();
        const field = new BoltField(host);
        const mat = field.getMesh().material as unknown as
            { vertexColors: boolean; transparent: boolean; depthWrite: boolean; opacity: number; color: Color };

        // The old bolt rendered vec4(material.color, material.opacity). Reproducing
        // that through vertex colours requires the material factor to be identity
        // and the colour attribute to be RGBA (three's USE_COLOR_ALPHA trigger).
        expect(mat.vertexColors).toBe(true);
        expect(mat.transparent).toBe(true);
        expect(mat.depthWrite).toBe(false);
        expect(mat.opacity).toBe(1);
        expect(mat.color.getHex()).toBe(0xffffff);
        expect(field.getMesh().geometry.getAttribute('color').itemSize).toBe(4);

        spawn(field, [0, 1, 0], [1, 1, 1], new Color(0.25, 0.5, 0.75));
        const c = colors(field);
        expect(Array.from(c.subarray(0, 8)))
            .toEqual([0.25, 0.5, 0.75, 1, 0.25, 0.5, 0.75, 1]);

        field.dispose();
    });

    it('fades exactly like the per-bolt `1 - elapsed/lifeS` it replaces, and expires on the same frame', () => {
        const host = new SceneHost();
        const field = new BoltField(host);
        spawn(field, [0, 1, 0], [1, 1, 1]);

        // Reference implementation: the old spawnBolt token, verbatim.
        let elapsed = 0;
        let alive = true;
        for (let frame = 0; frame < 20; frame++) {
            host.tick(DT);
            elapsed += DT;
            const expectedAlpha = Math.max(0, 1 - elapsed / LIFE);
            if (elapsed >= LIFE) alive = false;

            expect(field.liveCount).toBe(alive ? 1 : 0);
            if (alive) expect(alphaOf(field, 0)).toBeCloseTo(expectedAlpha, 6);
        }
        expect(alive).toBe(false);

        field.dispose();
    });

    it('hides the mesh entirely while no bolt is live', () => {
        const host = new SceneHost();
        const field = new BoltField(host);
        expect(field.getMesh().visible).toBe(false);

        spawn(field, [0, 1, 0], [1, 1, 1]);
        expect(field.getMesh().visible).toBe(true);

        for (let i = 0; i < 20; i++) host.tick(DT);
        expect(field.liveCount).toBe(0);
        expect(field.getMesh().visible).toBe(false);
        expect(drawCount(field)).toBe(0);

        field.dispose();
    });

    it('compacts around a bolt that expires in the middle of the buffer', () => {
        const host = new SceneHost();
        const field = new BoltField(host);

        // Short-lived middle bolt; the outer two outlive it.
        field.spawn(new Vector3(1, 1, 1), new Vector3(2, 2, 2), new Color(1, 0, 0), 1);
        field.spawn(new Vector3(3, 3, 3), new Vector3(4, 4, 4), new Color(0, 1, 0), DT);
        field.spawn(new Vector3(5, 5, 5), new Vector3(6, 6, 6), new Color(0, 0, 1), 1);

        host.tick(DT);

        expect(field.liveCount).toBe(2);
        expect(drawCount(field)).toBe(4);
        const p = positions(field);
        // Slot 0 untouched; the last bolt was swapped down into slot 1.
        expect(Array.from(p.subarray(0, 6))).toEqual([1, 1, 1, 2, 2, 2]);
        expect(Array.from(p.subarray(6, 12))).toEqual([5, 5, 5, 6, 6, 6]);
        const c = colors(field);
        expect(Array.from(c.subarray(8, 11))).toEqual([0, 0, 1]);

        field.dispose();
    });

    it('grows its buffers without losing or corrupting live bolts', () => {
        const host = new SceneHost();
        const field = new BoltField(host);
        const initial = field.capacityCount;

        for (let i = 0; i < initial + 1; i++) {
            spawn(field, [i, 0, 0], [i, 1, 0], new Color(i / 1000, 0, 0));
        }

        expect(field.capacityCount).toBe(initial * 2);
        expect(field.liveCount).toBe(initial + 1);
        expect(drawCount(field)).toBe((initial + 1) * 2);
        const p = positions(field);
        expect(p.length).toBe(initial * 2 * 6);
        for (const i of [0, 1, initial - 1, initial]) {
            expect(p[i * 6]).toBe(i);
            expect(p[i * 6 + 3]).toBe(i);
            expect(colors(field)[i * 8]).toBeCloseTo(i / 1000, 6);
        }
        // The geometry must be pointing at the GROWN buffers, not the originals.
        expect(field.getMesh().geometry.getAttribute('position').count).toBe(initial * 2 * 2);

        field.dispose();
    });

    it('adds exactly one frame hook and releases it (plus the scene object) on dispose', () => {
        const host = new SceneHost();
        const before = host.onBeforeRender.size;

        const field = new BoltField(host);
        expect(host.onBeforeRender.size).toBe(before + 1);
        spawn(field, [0, 1, 0], [1, 1, 1]);
        spawn(field, [0, 1, 0], [1, 1, 1]);
        expect(host.onBeforeRender.size).toBe(before + 1);

        const mesh = field.getMesh();
        field.dispose();
        expect(host.onBeforeRender.size).toBe(before);
        expect(mesh.parent).toBeNull();

        // Idempotent, and a spawn after teardown is inert rather than a throw.
        field.dispose();
        spawn(field, [0, 1, 0], [1, 1, 1]);
        expect(field.liveCount).toBe(0);
    });

    it('reuses freed slots, so a long run cannot grow the buffers without bound', () => {
        const host = new SceneHost();
        const field = new BoltField(host);
        const initial = field.capacityCount;

        for (let burst = 0; burst < 40; burst++) {
            for (let i = 0; i < 40; i++) spawn(field, [i, 1, burst], [i, 2, burst]);
            for (let f = 0; f < 20; f++) host.tick(DT);
            expect(field.liveCount).toBe(0);
        }
        expect(field.capacityCount).toBe(initial);

        field.dispose();
    });
});
