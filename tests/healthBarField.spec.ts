// tests/healthBarField.spec.ts
//
// The instanced enemy health-bar field. Two things are worth proving here and
// both are pure enough to run headless (SceneHost needs no WebGL):
//
//   1. The bar MATH — band thresholds and the left-anchored fill — because the
//      per-mesh path it replaced encoded them in scale/position writes that are
//      now instance-matrix composition. A drifting anchor or a shifted band
//      threshold is invisible in a type-check and obvious in play.
//   2. The SLOT bookkeeping — compaction, hiding, release/reuse, overflow and
//      disposal — because those are what turn ~160 draws into 2-3 and what keeps
//      a torn-down run from writing into the next one's buffers.

import { afterEach, describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';
import {
    BAR_FRAME_PAD_X,
    BAR_TIER_ELITE,
    BAR_TIER_NORMAL,
    disposeHealthBarField,
    fillAnchorOffsetX,
    getHealthBarField,
    HealthBarField,
    healthBandIndex,
    HEALTH_BAR_RENDER_GROUP,
} from '../src/survivors/enemies/HealthBarField';

/** A camera source with a fixed orientation. Identity by default so instance
 *  translations read directly as world position. */
function cameraSource(quaternion?: Quaternion) {
    const camera = new PerspectiveCamera();
    if (quaternion) camera.quaternion.copy(quaternion);
    return { camera, getActiveCamera: () => camera };
}

function makeField(quaternion?: Quaternion, capacity?: number) {
    const host = new SceneHost();
    const src = cameraSource(quaternion);
    const field = new HealthBarField(host, src, capacity);
    return { host, field, camera: src.camera };
}

const _m = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();

function layer(host: SceneHost, name: string): InstancedMesh {
    const mesh = host.scene.children.find(c => c.name === name);
    expect(mesh, `layer ${name} in scene`).toBeTruthy();
    return mesh as InstancedMesh;
}

function instance(mesh: InstancedMesh, i: number) {
    mesh.getMatrixAt(i, _m);
    _m.decompose(_pos, _quat, _scale);
    return { position: _pos.clone(), scale: _scale.clone() };
}

afterEach(() => {
    disposeHealthBarField();
});

describe('health-bar math', () => {
    it('bands at the same thresholds the material swap used', () => {
        expect(healthBandIndex(1)).toBe(0);
        expect(healthBandIndex(0.61)).toBe(0);
        expect(healthBandIndex(0.6)).toBe(1);   // > 0.6, not >=
        expect(healthBandIndex(0.31)).toBe(1);
        expect(healthBandIndex(0.3)).toBe(2);
        expect(healthBandIndex(0)).toBe(2);
    });

    it('anchors the fill left so the bar drains from the right', () => {
        expect(fillAnchorOffsetX(1, 1.0)).toBeCloseTo(0, 6);
        expect(fillAnchorOffsetX(0.5, 1.0)).toBeCloseTo(-0.25, 6);
        expect(fillAnchorOffsetX(0, 1.0)).toBeCloseTo(-0.5, 6);
        // The offset is half the REMOVED width, so it scales with the bar.
        expect(fillAnchorOffsetX(0.5, 2.5)).toBeCloseTo(-0.625, 6);
    });
});

describe('HealthBarField instances', () => {
    it('writes a bg + fill for a normal bar and no frame', () => {
        const { host, field } = makeField();
        const slot = field.acquire(BAR_TIER_NORMAL, 1.0, 0.08);
        field.setState(slot, 3, 2, -1, 1);
        field.flush();

        expect(field.drawnCounts).toEqual({ frame: 0, bg: 1, fill: 1 });
        // An empty layer hides itself rather than issuing a zero-instance draw.
        expect(layer(host, 'healthbar_field_frame').visible).toBe(false);
        expect(layer(host, 'healthbar_field_bg').visible).toBe(true);

        const bg = instance(layer(host, 'healthbar_field_bg'), 0);
        expect(bg.position.x).toBeCloseTo(3, 6);
        expect(bg.position.y).toBeCloseTo(2, 6);
        expect(bg.position.z).toBeCloseTo(-1, 6);
        // The near-black slab is the frame: fill size plus the pad.
        expect(bg.scale.x).toBeCloseTo(1.0 + BAR_FRAME_PAD_X, 6);

        const fill = instance(layer(host, 'healthbar_field_fill'), 0);
        expect(fill.scale.x).toBeCloseTo(1.0, 6);
        expect(fill.position.x).toBeCloseTo(3, 6); // full HP: no anchor shift
        field.dispose();
    });

    it('adds the outline layer only for elite bars', () => {
        const { host, field } = makeField();
        field.setState(field.acquire(BAR_TIER_NORMAL, 1.0, 0.08), 0, 0, 0, 1);
        field.setState(field.acquire(BAR_TIER_ELITE, 1.5, 0.12), 5, 0, 0, 1);
        field.flush();

        expect(field.drawnCounts).toEqual({ frame: 1, bg: 2, fill: 2 });
        expect(layer(host, 'healthbar_field_frame').visible).toBe(true);
        const frame = instance(layer(host, 'healthbar_field_frame'), 0);
        expect(frame.position.x).toBeCloseTo(5, 6);
        expect(frame.scale.x).toBeCloseTo(1.5 + BAR_FRAME_PAD_X, 6);
        field.dispose();
    });

    it('keeps the fill left edge fixed as health drains', () => {
        const { host, field } = makeField();
        const slot = field.acquire(BAR_TIER_NORMAL, 1.0, 0.08);
        const leftEdge = (fraction: number): number => {
            field.setState(slot, 10, 1, 0, fraction);
            field.flush();
            const fill = instance(layer(host, 'healthbar_field_fill'), 0);
            return fill.position.x - fill.scale.x * 0.5;
        };
        const full = leftEdge(1);
        expect(full).toBeCloseTo(9.5, 6);
        expect(leftEdge(0.5)).toBeCloseTo(full, 6);
        expect(leftEdge(0.01)).toBeCloseTo(full, 6);
        field.dispose();
    });

    it('billboards every instance to the camera and anchors in ITS x axis', () => {
        // A 90° yaw: the bar's local +x now points down world -z, so a drained
        // fill must shift along z, not x. (The mesh bars shifted in world x
        // regardless of where the camera was, which slid the fill off the slab.)
        const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
        const { host, field } = makeField(yaw);
        const slot = field.acquire(BAR_TIER_NORMAL, 1.0, 0.08);
        field.setState(slot, 0, 0, 0, 0.5);
        field.flush();

        const mesh = layer(host, 'healthbar_field_fill');
        mesh.getMatrixAt(0, _m);
        _m.decompose(_pos, _quat, _scale);
        expect(_quat.angleTo(yaw)).toBeCloseTo(0, 6);
        expect(_pos.x).toBeCloseTo(0, 6);
        expect(_pos.z).toBeCloseTo(0.25, 6); // -0.25 along local +x = +0.25 world z
        field.dispose();
    });

    it('never composes a singular fill matrix at zero health', () => {
        // A zero x-scale makes the instanced normal transform divide by zero,
        // which is NaN lighting rather than a harmless invisible triangle.
        const { host, field } = makeField();
        field.setState(field.acquire(BAR_TIER_NORMAL, 1.0, 0.08), 0, 0, 0, 0);
        field.flush();
        const fill = instance(layer(host, 'healthbar_field_fill'), 0);
        expect(fill.scale.x).toBeGreaterThan(0);
        expect(Number.isFinite(fill.position.x)).toBe(true);
        field.dispose();
    });

    it('layers frame under bg under fill', () => {
        const { host, field } = makeField();
        expect(layer(host, 'healthbar_field_frame').renderOrder).toBe(HEALTH_BAR_RENDER_GROUP);
        expect(layer(host, 'healthbar_field_bg').renderOrder).toBe(HEALTH_BAR_RENDER_GROUP + 1);
        expect(layer(host, 'healthbar_field_fill').renderOrder).toBe(HEALTH_BAR_RENDER_GROUP + 2);
        // The whole point of instancing here: the field NEVER frustum-culls as a
        // unit — its instances span the view and the per-enemy cull owns hiding.
        expect(layer(host, 'healthbar_field_fill').frustumCulled).toBe(false);
        field.dispose();
    });
});

describe('HealthBarField slots', () => {
    it('compacts hidden slots out of the draw entirely', () => {
        const { host, field } = makeField();
        const a = field.acquire(BAR_TIER_NORMAL, 1, 0.08);
        const b = field.acquire(BAR_TIER_NORMAL, 1, 0.08);
        const c = field.acquire(BAR_TIER_NORMAL, 1, 0.08);
        field.setState(a, 1, 0, 0, 1);
        field.setState(b, 2, 0, 0, 1);
        field.setState(c, 3, 0, 0, 1);
        field.flush();
        expect(field.drawnCounts.fill).toBe(3);

        // Parking the middle enemy (off-screen cull) drops it to zero vertices
        // and slides the survivors down — no gap instance left behind.
        field.setVisible(b, false);
        field.flush();
        expect(field.drawnCounts.fill).toBe(2);
        expect(instance(layer(host, 'healthbar_field_fill'), 0).position.x).toBeCloseTo(1, 6);
        expect(instance(layer(host, 'healthbar_field_fill'), 1).position.x).toBeCloseTo(3, 6);

        field.setVisible(b, true);
        field.flush();
        expect(field.drawnCounts.fill).toBe(3);
        field.dispose();
    });

    it('drops a released slot immediately and reuses it', () => {
        const { field } = makeField();
        const a = field.acquire(BAR_TIER_NORMAL, 1, 0.08);
        field.setState(a, 1, 0, 0, 1);
        field.flush();
        expect(field.activeCount).toBe(1);

        field.release(a);
        field.flush();
        expect(field.activeCount).toBe(0);
        expect(field.drawnCounts).toEqual({ frame: 0, bg: 0, fill: 0 });

        // Release is idempotent and a stale slot id cannot resurrect a bar.
        field.release(a);
        field.setState(a, 9, 9, 9, 1);
        field.flush();
        expect(field.drawnCounts.fill).toBe(0);

        expect(field.acquire(BAR_TIER_NORMAL, 1, 0.08)).toBe(a);
        field.dispose();
    });

    it('clamps at capacity instead of throwing', () => {
        const { field } = makeField(undefined, 2);
        expect(field.acquire(BAR_TIER_NORMAL, 1, 0.08)).toBe(0);
        expect(field.acquire(BAR_TIER_NORMAL, 1, 0.08)).toBe(1);
        expect(field.acquire(BAR_TIER_NORMAL, 1, 0.08)).toBe(-1);
        // -1 must stay inert everywhere: an enemy without a bar keeps playing.
        expect(() => {
            field.setState(-1, 1, 1, 1, 1);
            field.setVisible(-1, true);
            field.release(-1);
            field.flush();
        }).not.toThrow();
        expect(field.drawnCounts.fill).toBe(2);
        field.dispose();
    });

    it('flushes once per host tick', () => {
        const { host, field } = makeField();
        field.setState(field.acquire(BAR_TIER_NORMAL, 1, 0.08), 4, 0, 0, 1);
        expect(field.drawnCounts.fill).toBe(0);
        host.tick(1 / 60);
        expect(field.drawnCounts.fill).toBe(1);
        expect(instance(layer(host, 'healthbar_field_fill'), 0).position.x).toBeCloseTo(4, 6);
        field.dispose();
    });
});

describe('HealthBarField teardown', () => {
    it('frees its meshes, geometry and bus hook exactly once', () => {
        const { host, field } = makeField();
        const meshes = ['frame', 'bg', 'fill'].map(n => layer(host, `healthbar_field_${n}`));
        const geometry = meshes[0].geometry;
        expect(meshes[1].geometry).toBe(geometry);
        expect(meshes[2].geometry).toBe(geometry);
        expect(host.onBeforeRender.size).toBe(1);

        // three frees GPU resources through the dispose EVENT, so count it: the
        // three layers share ONE plane and it must be released exactly once
        // (disposeMesh skipping it, then one explicit dispose at the end).
        let geometryDisposals = 0;
        geometry.addEventListener('dispose', () => { geometryDisposals++; });
        const materialDisposals = new Set<string>();
        for (const m of meshes) {
            const material = m.material as { name: string; addEventListener: (t: string, cb: () => void) => void };
            material.addEventListener('dispose', () => { materialDisposals.add(material.name); });
        }

        field.dispose();
        expect(host.onBeforeRender.size).toBe(0);
        expect(host.scene.children.filter(c => c.name.startsWith('healthbar_field_'))).toHaveLength(0);
        for (const m of meshes) expect(m.userData.disposed).toBe(true);
        expect(geometryDisposals).toBe(1);
        expect(materialDisposals).toEqual(new Set([
            'healthbar_field_frame', 'healthbar_field_bg', 'healthbar_field_fill',
        ]));

        expect(() => {
            field.dispose();
            field.flush();
            field.setState(0, 1, 1, 1, 1);
        }).not.toThrow();
        expect(field.acquire(BAR_TIER_NORMAL, 1, 0.08)).toBe(-1);
    });

    it('hands out one shared field per host and replaces a disposed one', () => {
        const host = new SceneHost();
        const src = cameraSource();
        const a = getHealthBarField(host, src);
        expect(getHealthBarField(host, src)).toBe(a);

        disposeHealthBarField();
        const b = getHealthBarField(host, src);
        expect(b).not.toBe(a);
        expect(b.isDisposed).toBe(false);

        // A new run's host gets a new field; the old one is torn down, not leaked.
        const host2 = new SceneHost();
        const c = getHealthBarField(host2, src);
        expect(c).not.toBe(b);
        expect(b.isDisposed).toBe(true);
        expect(host.scene.children.filter(o => o.name.startsWith('healthbar_field_'))).toHaveLength(0);
    });
});
