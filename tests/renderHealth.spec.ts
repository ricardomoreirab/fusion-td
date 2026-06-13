import { describe, expect, it } from 'vitest';
import {
    evaluateRenderHealth,
    isFiniteVec3,
    isFiniteMatrix,
    RENDER_HEALTH,
    type RenderHealthSnapshot,
} from '../src/engine/renderHealth';

// A healthy baseline: loop running, context fine, a frame rendered just now, tab
// visible, not paused, JS clock ticking on time. Individual tests override one field.
const healthy: RenderHealthSnapshot = {
    running: true,
    contextLost: false,
    contextLostForMs: 0,
    msSinceLastRenderOk: 0,
    visible: true,
    paused: false,
    jsClockHealthy: true,
};

describe('evaluateRenderHealth — context loss (definitive GPU signal)', () => {
    it('warns immediately when the context is lost', () => {
        expect(evaluateRenderHealth({ ...healthy, contextLost: true, contextLostForMs: 50 })).toBe('warn');
    });

    it('reloads once a lost context stays unrecovered past the grace window', () => {
        expect(
            evaluateRenderHealth({ ...healthy, contextLost: true, contextLostForMs: RENDER_HEALTH.CONTEXT_LOST_RELOAD_MS }),
        ).toBe('reload');
    });

    it('still acts on context loss even when backgrounded — it is not a timing guess', () => {
        // A truly lost context is unrecoverable regardless of visibility, so the
        // false-positive gates must NOT suppress it.
        expect(
            evaluateRenderHealth({
                ...healthy,
                contextLost: true,
                contextLostForMs: RENDER_HEALTH.CONTEXT_LOST_RELOAD_MS,
                visible: false,
                jsClockHealthy: false,
                paused: true,
            }),
        ).toBe('reload');
    });
});

describe('evaluateRenderHealth — silent-stall heuristic (NaN camera / per-frame throw)', () => {
    it('warns after STALL_WARN_MS with no successful frame', () => {
        expect(evaluateRenderHealth({ ...healthy, msSinceLastRenderOk: RENDER_HEALTH.STALL_WARN_MS })).toBe('warn');
    });

    it('reloads after STALL_RELOAD_MS with no successful frame', () => {
        expect(evaluateRenderHealth({ ...healthy, msSinceLastRenderOk: RENDER_HEALTH.STALL_RELOAD_MS })).toBe('reload');
    });

    it('does nothing just below the warn threshold', () => {
        expect(evaluateRenderHealth({ ...healthy, msSinceLastRenderOk: RENDER_HEALTH.STALL_WARN_MS - 1 })).toBe('none');
    });
});

describe('evaluateRenderHealth — false-positive guards', () => {
    it('ignores a stall while the tab is backgrounded (rAF AND setInterval throttle together)', () => {
        expect(evaluateRenderHealth({ ...healthy, msSinceLastRenderOk: 60_000, visible: false })).toBe('none');
    });

    it('ignores a stall when the JS clock itself was throttled/blocked', () => {
        // If the watchdog timer was itself delayed, msSinceLastRenderOk is inflated by
        // the same block and must not be trusted.
        expect(evaluateRenderHealth({ ...healthy, msSinceLastRenderOk: 60_000, jsClockHealthy: false })).toBe('none');
    });

    it('ignores a stall while paused', () => {
        expect(evaluateRenderHealth({ ...healthy, msSinceLastRenderOk: 60_000, paused: true })).toBe('none');
    });

    it('does nothing before the render loop has started (loading/bootstrap)', () => {
        expect(evaluateRenderHealth({ ...healthy, running: false, msSinceLastRenderOk: 60_000 })).toBe('none');
    });
});

describe('isFiniteVec3', () => {
    it('accepts finite triples (incl. negatives and fractions)', () => {
        expect(isFiniteVec3(1, -2, 3.5)).toBe(true);
        expect(isFiniteVec3(0, 0, 0)).toBe(true);
    });

    it('rejects any NaN or Infinity component', () => {
        expect(isFiniteVec3(NaN, 0, 0)).toBe(false);
        expect(isFiniteVec3(0, Infinity, 0)).toBe(false);
        expect(isFiniteVec3(0, 0, -Infinity)).toBe(false);
        expect(isFiniteVec3(NaN, NaN, NaN)).toBe(false);
    });
});

describe('isFiniteMatrix', () => {
    // A 4x4 identity, the shape of a Babylon Matrix's backing `.m` Float32Array(16).
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    it('accepts a fully finite matrix (plain array and Float32Array)', () => {
        expect(isFiniteMatrix(identity)).toBe(true);
        expect(isFiniteMatrix(new Float32Array(identity))).toBe(true);
    });

    it('rejects a projection poisoned by a NaN aspect ratio (the silent black-screen case)', () => {
        const nanProj = identity.slice();
        nanProj[0] = NaN; // perspective m[0] = 1/(tan(fov/2)*aspect) → NaN when aspect is NaN
        expect(isFiniteMatrix(nanProj)).toBe(false);
        expect(isFiniteMatrix(new Float32Array(nanProj))).toBe(false);
    });

    it('rejects any Infinity element', () => {
        const inf = identity.slice();
        inf[5] = Infinity; // m[5] = 1/tan(fov/2) → Infinity when fov collapses to 0
        expect(isFiniteMatrix(inf)).toBe(false);
    });

    it('treats an empty matrix as finite (no element can violate)', () => {
        expect(isFiniteMatrix([])).toBe(true);
    });
});
