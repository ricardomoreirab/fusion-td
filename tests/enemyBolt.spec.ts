import { describe, it, expect } from 'vitest';
import { ENEMY_BOLTS, HERO_MAX_MOVE_SPEED } from '../src/survivors/enemies/EnemyBolt';

const ALL = Object.entries(ENEMY_BOLTS);

describe('enemy bolt registry', () => {
    it('keeps every pool/material key distinct', () => {
        // The key indexes BOTH the mesh pool and the material cache, so two
        // variants sharing one would hand a lance the mage's material and pool
        // the two shapes together.
        const keys = ALL.map(([, spec]) => spec.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('is a closed set, which is what bounds the cache keys', () => {
        // The leak class in CLAUDE.md is an unbounded material-cache key. Having
        // every variant enumerated here is the structural guarantee; a spawn-time
        // literal would reintroduce it.
        expect(ALL.length).toBeGreaterThan(0);
        for (const [, spec] of ALL) {
            expect(spec.key).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(Object.isFrozen(spec)).toBe(true);
        }
    });

    it.each(ALL.filter(([, s]) => s.flight === 'homing'))(
        '%s out-runs a fully-levelled hero, or "always hits" is a lie',
        (_name, spec) => {
            // A homing bolt only connects if it closes. At the level cap the hero
            // moves at HERO_MAX_MOVE_SPEED, so anything at or below that would
            // trail a running player until its flight timeout and hit nobody.
            expect(spec.speed).toBeGreaterThan(HERO_MAX_MOVE_SPEED);
        },
    );

    it('gives a homing bolt enough flight time to cross its own range', () => {
        // Even guaranteed hits are abandoned at maxFlightS. That budget has to
        // cover the caster's reach with room to spare or long shots silently fizzle.
        for (const [name, spec] of ALL) {
            if (spec.flight !== 'homing') continue;
            const reach = spec.speed * spec.maxFlightS;
            expect(reach, `${name} can only fly ${reach}u`).toBeGreaterThan(20);
        }
    });

    it('keeps exactly one dodgeable variant — the artillery lance', () => {
        // The whole division: mages are damage you out-heal, artillery is damage
        // you out-move. If a mage bolt ever became 'straight' it would be
        // dodgeable chip damage, i.e. no threat at all.
        const straight = ALL.filter(([, s]) => s.flight === 'straight').map(([n]) => n);
        expect(straight).toEqual(['lance']);
        expect(ENEMY_BOLTS.mage.flight).toBe('homing');
        expect(ENEMY_BOLTS.redWizard.flight).toBe('homing');
    });

    it('gives the lance a shaft to point down its travel', () => {
        expect(ENEMY_BOLTS.lance.shape).toBe('lance');
        expect(ENEMY_BOLTS.lance.length).toBeGreaterThan(ENEMY_BOLTS.lance.diameter);
    });

    it('makes every bolt hittable and finite', () => {
        for (const [name, spec] of ALL) {
            expect(spec.speed, name).toBeGreaterThan(0);
            expect(spec.hitRadius, name).toBeGreaterThan(0);
            expect(spec.maxFlightS, name).toBeGreaterThan(0);
            expect(spec.diameter, name).toBeGreaterThan(0);
        }
    });
});
