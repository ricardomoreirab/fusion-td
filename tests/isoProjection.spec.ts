import { describe, it, expect } from 'vitest';
import {
    ISO_PITCH_RAD, ISO_YAW_RAD, ISO_VIEW_HEIGHT, ISO_ZOOM_MAX, ISO_ZOOM_MIN,
    ISO_ZOOM_DEFAULT,
    clampIsoZoom, stepIsoZoom, lerpIsoZoom, parsePersistedIsoZoom,
    isoFrustum, isoViewHalfDiagonal, isSpawnRingOffscreen,
    screenToWorldDir, worldToScreenDir,
} from '../src/survivors/world/isoProjection';

// The spawn ring the survivors mode uses. Mirrored here rather than imported so
// this suite fails loudly if the gameplay constant moves without a review of the
// framing contract below.
const SPAWN_RING_RADIUS = 40;

describe('iso projection angles', () => {
    it('pitch is the true isometric atan(1/sqrt(2))', () => {
        expect(ISO_PITCH_RAD).toBeCloseTo(0.6154797, 6);
        expect(ISO_PITCH_RAD * 180 / Math.PI).toBeCloseTo(35.26439, 4);
    });

    it('yaw is 45 degrees', () => {
        expect(ISO_YAW_RAD * 180 / Math.PI).toBeCloseTo(45, 10);
    });
});

describe('screenToWorldDir', () => {
    const out = { dx: 0, dz: 0 };

    // Regression: these two originally asserted W → (+X, +Z), which encoded the
    // bug rather than the contract — the suite passed while W/S were inverted
    // in game. The camera-basis test below is the real guard; these pin the
    // resulting values.
    it('maps W (screen up) toward -X/-Z, i.e. AWAY from the camera', () => {
        screenToWorldDir(0, 1, out);
        expect(out.dx).toBeCloseTo(-Math.SQRT1_2, 6);
        expect(out.dz).toBeCloseTo(-Math.SQRT1_2, 6);
    });

    it('maps S (screen down) toward +X/+Z, i.e. TOWARD the camera', () => {
        screenToWorldDir(0, -1, out);
        expect(out.dx).toBeCloseTo(Math.SQRT1_2, 6);
        expect(out.dz).toBeCloseTo(Math.SQRT1_2, 6);
    });

    it('maps D (screen right) toward +X/-Z', () => {
        screenToWorldDir(1, 0, out);
        expect(out.dx).toBeCloseTo(Math.SQRT1_2, 6);
        expect(out.dz).toBeCloseTo(-Math.SQRT1_2, 6);
    });

    it('maps A (screen left) toward -X/+Z', () => {
        screenToWorldDir(-1, 0, out);
        expect(out.dx).toBeCloseTo(-Math.SQRT1_2, 6);
        expect(out.dz).toBeCloseTo(Math.SQRT1_2, 6);
    });

    it('is a pure rotation: unit input stays unit length', () => {
        for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            screenToWorldDir(x, y, out);
            expect(Math.hypot(out.dx, out.dz)).toBeCloseTo(1, 6);
        }
    });

    it('preserves analog magnitude below 1 (joystick must not be normalized)', () => {
        screenToWorldDir(0, 0.4, out);
        expect(Math.hypot(out.dx, out.dz)).toBeCloseTo(0.4, 6);
    });

    it('keeps opposite inputs opposite', () => {
        const a = { dx: 0, dz: 0 };
        const b = { dx: 0, dz: 0 };
        screenToWorldDir(1, 0.3, a);
        screenToWorldDir(-1, -0.3, b);
        expect(a.dx).toBeCloseTo(-b.dx, 6);
        expect(a.dz).toBeCloseTo(-b.dz, 6);
    });

    // The real guard. Rather than restating the expected numbers (which is how
    // the inverted-W bug slipped through), this rebuilds the camera basis the
    // same way THREE's lookAt does and checks the mapping against it. If the
    // camera geometry ever changes, this fails instead of silently disagreeing
    // with the rendered view.
    it('agrees with the camera basis THREE.lookAt actually builds', () => {
        // lookAt: z = normalize(eye - target); x = normalize(worldUp × z); y = z × x
        const n = (v: number[]) => { const l = Math.hypot(...v); return v.map(c => c / l); };
        const cross = (a: number[], b: number[]) => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ];
        const z = n([1, 1, 1]);                 // eye - target, along the iso diagonal
        const camRight = n(cross([0, 1, 0], z));
        const camUp = cross(z, camRight);
        // Screen-up as felt on the ground plane: camera up with Y dropped.
        const upGround = n([camUp[0], 0, camUp[2]]);

        // Moving "up the screen" must go AWAY from the camera, never toward it.
        expect(upGround[0] * z[0] + upGround[2] * z[2]).toBeLessThan(0);

        const w = { dx: 0, dz: 0 };
        screenToWorldDir(0, 1, w);
        expect(w.dx).toBeCloseTo(upGround[0], 6);
        expect(w.dz).toBeCloseTo(upGround[2], 6);

        const d = { dx: 0, dz: 0 };
        screenToWorldDir(1, 0, d);
        expect(d.dx).toBeCloseTo(camRight[0], 6);
        expect(d.dz).toBeCloseTo(camRight[2], 6);
    });

    it('round-trips through worldToScreenDir', () => {
        const world = { dx: 0, dz: 0 };
        const screen = { x: 0, y: 0 };
        for (const [x, y] of [[1, 0], [0.3, -0.8], [-0.5, 0.5]]) {
            screenToWorldDir(x, y, world);
            worldToScreenDir(world.dx, world.dz, screen);
            expect(screen.x).toBeCloseTo(x, 6);
            expect(screen.y).toBeCloseTo(y, 6);
        }
    });
});

describe('zoom', () => {
    it('clamps into range and rejects non-finite', () => {
        expect(clampIsoZoom(99)).toBe(ISO_ZOOM_MAX);
        expect(clampIsoZoom(0.01)).toBe(ISO_ZOOM_MIN);
        expect(clampIsoZoom(NaN)).toBe(ISO_ZOOM_DEFAULT);
        expect(clampIsoZoom(Infinity)).toBe(ISO_ZOOM_DEFAULT);
    });

    it('scroll up zooms in, scroll down zooms out, zero is a no-op', () => {
        expect(stepIsoZoom(1, -1)).toBeLessThan(1);
        expect(stepIsoZoom(1, 1)).toBeGreaterThan(1);
        expect(stepIsoZoom(1, 0)).toBe(1);
    });

    it('never escapes the range no matter how many notches', () => {
        let z = 1;
        for (let i = 0; i < 200; i++) z = stepIsoZoom(z, 1);
        expect(z).toBe(ISO_ZOOM_MAX);
        for (let i = 0; i < 200; i++) z = stepIsoZoom(z, -1);
        expect(z).toBe(ISO_ZOOM_MIN);
    });

    it('lerp eases toward target and is a no-op for dt <= 0', () => {
        expect(lerpIsoZoom(1, 2, 0)).toBe(1);
        expect(lerpIsoZoom(1, 2, -1)).toBe(1);
        const stepped = lerpIsoZoom(1, 2, 0.016);
        expect(stepped).toBeGreaterThan(1);
        expect(stepped).toBeLessThan(2);
    });

    it('parses persisted values defensively', () => {
        expect(parsePersistedIsoZoom(null)).toBe(ISO_ZOOM_DEFAULT);
        expect(parsePersistedIsoZoom('garbage')).toBe(ISO_ZOOM_DEFAULT);
        expect(parsePersistedIsoZoom('1.1')).toBeCloseTo(1.1, 6);
        expect(parsePersistedIsoZoom('999')).toBe(ISO_ZOOM_MAX);
    });
});

describe('frustum', () => {
    const f = { left: 0, right: 0, top: 0, bottom: 0 };

    it('is symmetric and scales with aspect', () => {
        isoFrustum(28, 16 / 9, 1, f);
        expect(f.right).toBeCloseTo(-f.left, 10);
        expect(f.top).toBeCloseTo(-f.bottom, 10);
        expect(f.top).toBeCloseTo(14, 6);
        expect(f.right).toBeCloseTo(14 * (16 / 9), 6);
    });

    it('falls back to aspect 1 on a degenerate viewport', () => {
        isoFrustum(28, 0, 1, f);
        expect(f.right).toBeCloseTo(14, 6);
        isoFrustum(28, NaN, 1, f);
        expect(f.right).toBeCloseTo(14, 6);
    });

    it('zoom scales the frustum, not the position', () => {
        isoFrustum(28, 1, 1, f);
        const at1 = f.top;
        isoFrustum(28, 1, 1.2, f);
        expect(f.top).toBeCloseTo(at1 * 1.2, 6);
    });
});

describe('spawn-ring framing contract', () => {
    // The Vampire Survivors contract: enemies must always enter from off-screen.
    // If this fails, enemies visibly pop into existence and the zoom range needs
    // tightening (see ISO_ZOOM_MAX's comment).
    const aspects = [16 / 9, 16 / 10, 4 / 3, 1];

    it('keeps the spawn ring off-screen at max zoom on common aspects', () => {
        for (const aspect of aspects) {
            expect(
                isSpawnRingOffscreen(SPAWN_RING_RADIUS, ISO_VIEW_HEIGHT, aspect, ISO_ZOOM_MAX),
                `aspect ${aspect.toFixed(3)} exposes the spawn ring`,
            ).toBe(true);
        }
    });

    it('half-diagonal grows with zoom', () => {
        const near = isoViewHalfDiagonal(ISO_VIEW_HEIGHT, 16 / 9, ISO_ZOOM_MIN);
        const far = isoViewHalfDiagonal(ISO_VIEW_HEIGHT, 16 / 9, ISO_ZOOM_MAX);
        expect(far).toBeGreaterThan(near);
    });

    it('documents that ultrawide is outside the guarantee', () => {
        // 21:9 exceeds the ring; recorded deliberately so the limitation is a
        // known, tested fact rather than a surprise in the field.
        expect(isSpawnRingOffscreen(SPAWN_RING_RADIUS, ISO_VIEW_HEIGHT, 21 / 9, ISO_ZOOM_MAX)).toBe(false);
    });
});
