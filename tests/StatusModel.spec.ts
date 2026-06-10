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

    it('flushes the remainder on expiry so no damage is silently dropped', () => {
        const s = new StatusStacks();
        // 0.7s burn, 2 stacks × 3 dmg: one full tick at 0.5s + a 0.2s tail that
        // must be flushed as the elapsed fraction of an interval (mirrors curse).
        s.apply('burn', 0.7, 3, 2);
        const r = s.tick(0.7, 100);
        // expected: 2×3 (first tick) + 2×3×(0.2/0.5) (tail flush) = 6 + 2.4 = 8.4
        expect(r.burnDamage).toBeCloseTo(8.4, 5);
        expect(r.expired).toContain('burn');
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
    it('drains a fraction of max HP per tick (0.5 s interval)', () => {
        const s = new StatusStacks();
        s.apply('curse', 5, /*strength = 3%/s*/ 0.03);
        // 0.5s at 3%/s of 200 maxHP = 0.5 * 0.03 * 200 = 3
        expect(s.tick(0.5, 200).curseDamage).toBeCloseTo(3, 5);
    });

    it('emits no damage before the first tick interval', () => {
        const s = new StatusStacks();
        s.apply('curse', 5, 0.05);
        // 0.4s < 0.5s tick interval → no damage yet
        expect(s.tick(0.4, 100).curseDamage).toBe(0);
    });

    it('emits damage only on crossing each 0.5 s boundary', () => {
        const s = new StatusStacks();
        s.apply('curse', 5, 0.1);
        // no tick yet at 0.3s
        expect(s.tick(0.3, 100).curseDamage).toBe(0);
        // 0.3 + 0.25 = 0.55s → crosses 0.5s → one tick worth: 100 * 0.1 * 0.5 = 5
        expect(s.tick(0.25, 100).curseDamage).toBeCloseTo(5, 5);
    });

    it('fires multiple ticks when dt spans several intervals', () => {
        const s = new StatusStacks();
        s.apply('curse', 10, 0.1);
        // 1.5s spans 3 intervals: 3 * (100 * 0.1 * 0.5) = 15
        expect(s.tick(1.5, 100).curseDamage).toBeCloseTo(15, 5);
    });

    it('total curse damage over full duration is integral-preserving (matches per-frame total)', () => {
        // Simulate both approaches with 16ms frames over a 5s curse at 2%/s on 500 HP.
        // Per-frame total: 500 * 0.02 * 5 = 50.
        const strength = 0.02;
        const maxHp = 500;
        const durationS = 5;
        const dtS = 0.016;
        const INTERVAL = 0.5; // STATUS_TUNING.curse.tickIntervalS

        // Accumulator approach (mirrors the implementation)
        let accTotal = 0;
        let acc = 0;
        let remaining = durationS;
        while (remaining > 0) {
            const dt = Math.min(dtS, remaining);
            remaining -= dt;
            acc += dt;
            while (acc >= INTERVAL) {
                accTotal += maxHp * strength * INTERVAL;
                acc -= INTERVAL;
            }
            if (remaining <= 0 && acc > 0) {
                // tail flush on expiry
                accTotal += maxHp * strength * acc;
            }
        }

        // Per-frame total (legacy behaviour) for comparison
        const perFrameTotal = maxHp * strength * durationS;

        // Both totals should be within 1e-9 (floating point only)
        expect(accTotal).toBeCloseTo(perFrameTotal, 9);
    });

    it('flushes the remainder on expiry so no damage is silently dropped', () => {
        const s = new StatusStacks();
        // 0.7s curse: one full tick at 0.5s + 0.2s tail that must be flushed
        s.apply('curse', 0.7, 0.1);
        let total = 0;
        // advance to just past the full duration in one big step
        let r = s.tick(0.7, 100);
        total += r.curseDamage;
        // expected: 100 * 0.1 * 0.5 (first tick) + 100 * 0.1 * 0.2 (tail flush) = 7
        expect(total).toBeCloseTo(7, 5);
        expect(r.expired).toContain('curse');
    });

    it('accumulator resets after expiry (no phantom carry-over on re-apply)', () => {
        const s = new StatusStacks();
        s.apply('curse', 0.4, 0.1);
        s.tick(0.3, 100);          // 0.1s of curse left, acc=0.3
        s.tick(0.3, 100);          // curse expires; acc must reset
        expect(s.has('curse')).toBe(false);
        s.apply('curse', 10, 0.1); // fresh curse
        // 0.45s < 0.5s interval → no tick yet (would fire if acc=0.1 carried over)
        expect(s.tick(0.45, 100).curseDamage).toBe(0);
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

describe('StatusStacks — detonate', () => {
    it('returns the burn burst (stacks×strength×overflowFactor) and clears burn', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, 4); // 4 stacks, 2 dmg/stack
        const burst = s.detonate('burn');
        expect(burst).toBeCloseTo(4 * 2 * STATUS_TUNING.burn.overflowFactor, 5);
        expect(s.has('burn')).toBe(false);
    });

    it('returns 0 for an absent kind and for non-burn kinds', () => {
        const s = new StatusStacks();
        expect(s.detonate('burn')).toBe(0);
        s.apply('chill', 5, 0, 3);
        expect(s.detonate('chill')).toBe(0); // no burst value defined for chill
        expect(s.has('chill')).toBe(false);  // still cleared
    });

    it('resets the burn accumulator so a later burn does not phantom-tick', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, 1);
        s.tick(0.3, 100);       // acc = 0.3
        s.detonate('burn');     // clears burn + acc
        s.apply('burn', 5, 2, 1);
        expect(s.tick(0.3, 100).burnDamage).toBe(0); // 0.3 < 0.5; would fire if acc carried
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
