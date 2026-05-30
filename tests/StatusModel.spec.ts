import { describe, expect, it } from 'vitest';
import { StatusStacks, STATUS_TUNING } from '../src/survivors/powers/StatusModel';

describe('StatusStacks — burn', () => {
    it('stacks additively and ticks stacks*strength per interval', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, /*strength*/ 2, /*addStacks*/ 3); // 3 stacks, 2 dmg/stack/tick
        expect(s.stacks('burn')).toBe(3);
        // below the 0.5s interval → no damage yet
        expect(s.tick(0.25, 100).burnDamage).toBe(0);
        // crossing the interval → 3 stacks × 2 = 6
        expect(s.tick(0.25, 100).burnDamage).toBe(6);
    });

    it('caps at maxStacks and detonates the pool when applied over cap', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, STATUS_TUNING.burn.maxStacks); // exactly at cap
        expect(s.stacks('burn')).toBe(STATUS_TUNING.burn.maxStacks);
        const r = s.apply('burn', 5, 2, 1); // one more → overflow
        expect(r.overflowDetonate).toBeCloseTo(
            STATUS_TUNING.burn.maxStacks * 2 * STATUS_TUNING.burn.overflowFactor, 5,
        );
        expect(s.stacks('burn')).toBe(STATUS_TUNING.burn.maxStacks); // stays capped, not consumed
    });
});

describe('StatusStacks — chill', () => {
    it('accumulates stacks and slows, with a floor', () => {
        const s = new StatusStacks();
        s.apply('chill', 3, 0, 5); // 5 stacks, below the 7-stack freeze threshold
        const m = s.tick(0.016, 100).chillSlowMultiplier;
        expect(m).toBeCloseTo(Math.max(STATUS_TUNING.chill.slowFloor, 1 - 5 * STATUS_TUNING.chill.slowPerStack), 5);
        expect(m).toBeGreaterThanOrEqual(STATUS_TUNING.chill.slowFloor);
    });

    it('signals freeze at the threshold and consumes chill', () => {
        const s = new StatusStacks();
        s.apply('chill', 3, 0, 6); // 6 stacks, no freeze yet
        expect(s.apply('chill', 3, 0, 1).reachedFreeze).toBe(true); // 7th → freeze
        expect(s.has('chill')).toBe(false); // consumed
    });
});

describe('StatusStacks — fragile', () => {
    it('amplifies incoming damage, capped at maxStacks', () => {
        const s = new StatusStacks();
        expect(s.damageAmplifier()).toBe(1);
        s.apply('fragile', 5, 0, 3);
        expect(s.damageAmplifier()).toBeCloseTo(1 + 3 * STATUS_TUNING.fragile.ampPerStack, 5);
        s.apply('fragile', 5, 0, 999); // over cap
        expect(s.stacks('fragile')).toBe(STATUS_TUNING.fragile.maxStacks);
        expect(s.damageAmplifier()).toBeCloseTo(
            1 + STATUS_TUNING.fragile.maxStacks * STATUS_TUNING.fragile.ampPerStack, 5,
        );
    });
});

describe('StatusStacks — curse', () => {
    it('drains a fraction of max HP per second continuously', () => {
        const s = new StatusStacks();
        s.apply('curse', 5, /*strength = 3%/s*/ 0.03);
        // 0.5s at 3%/s of 200 maxHP = 0.5 * 0.03 * 200 = 3
        expect(s.tick(0.5, 200).curseDamage).toBeCloseTo(3, 5);
    });
});

describe('StatusStacks — expiry', () => {
    it('removes a kind when its timer runs out and reports it', () => {
        const s = new StatusStacks();
        s.apply('fragile', 1, 0, 2);
        expect(s.tick(0.6, 100).expired).toEqual([]);
        const r = s.tick(0.6, 100); // total 1.2s > 1s
        expect(r.expired).toContain('fragile');
        expect(s.has('fragile')).toBe(false);
    });

    it('clear() empties everything; clear(kind) removes one', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, 1);
        s.apply('curse', 5, 0.02);
        s.clear('burn');
        expect(s.has('burn')).toBe(false);
        expect(s.has('curse')).toBe(true);
        s.clear();
        expect(s.has('curse')).toBe(false);
    });
});

describe('StatusStacks — refresh & timing edge cases', () => {
    it('burn re-apply does not truncate a longer remaining duration', () => {
        const s = new StatusStacks();
        s.apply('burn', 10, 2, 1);   // 10s remaining
        s.apply('burn', 2, 2, 1);    // shorter re-apply must NOT shrink it
        s.tick(3, 100);              // 3s elapsed; burn would be gone if truncated to 2s
        expect(s.has('burn')).toBe(true);
    });

    it('burn fires every elapsed interval when dtS spans several', () => {
        const s = new StatusStacks();
        s.apply('burn', 10, 2, 3);   // 3 stacks × 2 = 6 per 0.5s interval
        expect(s.tick(1.5, 100).burnDamage).toBe(18); // three intervals → 3 × 6
    });

    it('burn accumulator resets after expiry (no phantom carry-over on re-apply)', () => {
        const s = new StatusStacks();
        s.apply('burn', 0.4, 2, 1);
        s.tick(0.3, 100);            // 0.1s of burn left, acc=0.3
        s.tick(0.3, 100);           // fires once (acc→0.1), then burn expires & acc resets
        expect(s.has('burn')).toBe(false);
        s.apply('burn', 10, 2, 1);   // fresh burn
        expect(s.tick(0.45, 100).burnDamage).toBe(0); // 0.45<0.5; would fire if acc carried 0.1
    });

    it('curse re-apply keeps the stronger drain rate', () => {
        const s = new StatusStacks();
        s.apply('curse', 5, 0.1);
        s.apply('curse', 5, 0.03);   // weaker — must not override
        expect(s.tick(1, 100).curseDamage).toBeCloseTo(10, 5); // 100 × 0.1 × 1
    });

    it('chill applied at/over the threshold in one shot signals freeze', () => {
        const s = new StatusStacks();
        expect(s.apply('chill', 3, 0, STATUS_TUNING.chill.freezeAtStacks).reachedFreeze).toBe(true);
        expect(s.has('chill')).toBe(false);
    });

    it('burn and curse both deal damage in the same tick', () => {
        const s = new StatusStacks();
        s.apply('burn', 10, 2, 2);
        s.apply('curse', 10, 0.05);
        const r = s.tick(0.5, 100);
        expect(r.burnDamage).toBe(4);            // 2 stacks × 2
        expect(r.curseDamage).toBeCloseTo(2.5, 5); // 100 × 0.05 × 0.5
    });

    it('tick with no active statuses returns a zero result', () => {
        const s = new StatusStacks();
        const r = s.tick(0.016, 100);
        expect(r.burnDamage).toBe(0);
        expect(r.curseDamage).toBe(0);
        expect(r.chillSlowMultiplier).toBe(1);
        expect(r.expired).toEqual([]);
    });
});
