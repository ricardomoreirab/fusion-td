import { describe, it, expect } from 'vitest';
import { isGroundFxKind, isLaneFxKind, LANE_FX } from '../src/survivors/enemies/EnemyGroundFx';

/**
 * These two guards sit on the co-op wire boundary: the kind arrives as a plain
 * string in an FxMsg and is used to index the style tables and the material
 * cache. A guard that let an arbitrary string through would take an
 * attacker-chosen (i.e. unbounded) material-cache key — the exact leak class
 * CLAUDE.md calls out — so "rejects anything not in the union" is the property,
 * not "accepts the ones we ship".
 */
describe('ground-FX kind guards', () => {
    it('accepts exactly the radial kinds', () => {
        expect(isGroundFxKind('boulder')).toBe(true);
        expect(isGroundFxKind('quake')).toBe(true);
        // Impact-only: a boss landing its leap. Never drawn as a telegraph, but it
        // travels the same wire channel and indexes the same style table.
        expect(isGroundFxKind('slam')).toBe(true);
    });

    it('accepts exactly the lane kinds', () => {
        expect(isLaneFxKind('charge')).toBe(true);
    });

    it('keeps the radial and lane namespaces disjoint', () => {
        // They index different style tables and are replayed by different
        // primitives, so a kind answering to both would draw the wrong shape.
        expect(isGroundFxKind('charge')).toBe(false);
        expect(isLaneFxKind('boulder')).toBe(false);
        expect(isLaneFxKind('quake')).toBe(false);
        expect(isLaneFxKind('slam')).toBe(false);
    });

    it.each([
        '', 'BOULDER', 'quake ', 'boulder;quake', '__proto__', 'constructor',
        'toString', 'quakeWave', 'boulderFill', '0', 'null', 'undefined',
    ])('rejects %o off the wire', s => {
        expect(isGroundFxKind(s)).toBe(false);
        expect(isLaneFxKind(s)).toBe(false);
    });

    it('gives every lane kind a drawable style', () => {
        // The charging enemy and the guest replaying its marker both read the
        // wind-up from here, which is what stops the two drifting apart.
        for (const [kind, spec] of Object.entries(LANE_FX)) {
            expect(isLaneFxKind(kind)).toBe(true);
            expect(spec.width).toBeGreaterThan(0);
            expect(spec.windupS).toBeGreaterThan(0);
            // A telegraph shorter than a couple of frames is not a warning.
            expect(spec.windupS).toBeGreaterThan(0.2);
            expect(spec.color).toBeDefined();
        }
    });
});
