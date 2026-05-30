// Babylon-free. Pure stack math for the four RICH status kinds:
//   burn   — stacking DoT, capped, overflow-detonates when applied past cap
//   chill  — stacking soft-slow that converts to a Freeze at threshold
//   curse  — drains a fraction of MAX HP per second
//   fragile — stacking amplifier that raises incoming direct damage
// Legacy CC (slow/freeze/stun/push/confused) stays in Enemy.ts unchanged.
// MUST NOT import @babylonjs/core — this module is unit-tested under node.

export type RichStatusKind = 'burn' | 'chill' | 'curse' | 'fragile';

export const STATUS_TUNING = {
    burn:    { tickIntervalS: 0.5, maxStacks: 20, overflowFactor: 2 },
    chill:   { freezeAtStacks: 7, slowPerStack: 0.08, slowFloor: 0.2, freezeDurationS: 2 },
    fragile: { maxStacks: 10, ampPerStack: 0.05 },
} as const;

interface Track {
    stacks: number;
    remainingS: number;
    /** burn: damage per stack per tick · curse: fraction of maxHP/s · chill/fragile: always 0 (unused). */
    strength: number;
}

export interface ApplyResult {
    /** Burst damage to deal NOW because burn was applied at/over cap (0 otherwise). */
    overflowDetonate: number;
    /** True when chill reached the freeze threshold — caller should apply a Freeze
     *  for STATUS_TUNING.chill.freezeDurationS seconds. */
    reachedFreeze: boolean;
}

export interface StatusTickResult {
    burnDamage: number;   // deal as element 'fire'
    curseDamage: number;  // deal as element 'arcane'
    /** Speed multiplier from chill, in [slowFloor..1]. 1 when no chill present. */
    chillSlowMultiplier: number;
    /** Rich kinds whose timer expired this tick (already removed from state). */
    expired: RichStatusKind[];
}

// Shared zero-result for the common "no active statuses" case — avoids a per-frame
// object+array allocation on every enemy (hundreds of enemies × 60fps). Callers MUST
// treat the returned value as read-only and never mutate `expired`.
const EMPTY_TICK_RESULT: StatusTickResult = {
    burnDamage: 0, curseDamage: 0, chillSlowMultiplier: 1, expired: [],
};

export class StatusStacks {
    private tracks = new Map<RichStatusKind, Track>();
    private burnTickAcc = 0;

    has(kind: RichStatusKind): boolean { return this.tracks.has(kind); }
    stacks(kind: RichStatusKind): number { return this.tracks.get(kind)?.stacks ?? 0; }

    /** 1 + fragileStacks × ampPerStack. Multiply incoming direct damage by this. */
    damageAmplifier(): number {
        const f = this.tracks.get('fragile');
        return f ? 1 + f.stacks * STATUS_TUNING.fragile.ampPerStack : 1;
    }

    /**
     * Apply (or refresh) a rich status.
     * @param strength burn: damage per stack per tick · curse: fraction of maxHP/s · others: unused
     * @param addStacks number of stacks to add (default 1)
     */
    apply(kind: RichStatusKind, durationS: number, strength = 0, addStacks = 1): ApplyResult {
        const res: ApplyResult = { overflowDetonate: 0, reachedFreeze: false };
        switch (kind) {
            case 'burn': {
                const t = this.tracks.get('burn');
                const dmg = Math.max(t?.strength ?? 0, strength);
                if (t && t.stacks >= STATUS_TUNING.burn.maxStacks) {
                    // At cap: applying more detonates the pool; stacks stay capped.
                    res.overflowDetonate = t.stacks * t.strength * STATUS_TUNING.burn.overflowFactor;
                    t.remainingS = Math.max(t.remainingS, durationS);
                    t.strength = dmg;
                } else {
                    const stacks = Math.min(STATUS_TUNING.burn.maxStacks, (t?.stacks ?? 0) + addStacks);
                    this.tracks.set('burn', { stacks, remainingS: Math.max(t?.remainingS ?? 0, durationS), strength: dmg });
                }
                break;
            }
            case 'chill': {
                const t = this.tracks.get('chill');
                const stacks = (t?.stacks ?? 0) + addStacks;
                if (stacks >= STATUS_TUNING.chill.freezeAtStacks) {
                    this.tracks.delete('chill'); // consumed into a Freeze (caller applies it)
                    res.reachedFreeze = true;
                } else {
                    this.tracks.set('chill', { stacks, remainingS: Math.max(t?.remainingS ?? 0, durationS), strength: 0 });
                }
                break;
            }
            case 'curse': {
                const t = this.tracks.get('curse');
                this.tracks.set('curse', {
                    stacks: 1,
                    remainingS: Math.max(t?.remainingS ?? 0, durationS),
                    strength: Math.max(t?.strength ?? 0, strength),
                });
                break;
            }
            case 'fragile': {
                const t = this.tracks.get('fragile');
                const stacks = Math.min(STATUS_TUNING.fragile.maxStacks, (t?.stacks ?? 0) + addStacks);
                this.tracks.set('fragile', { stacks, remainingS: Math.max(t?.remainingS ?? 0, durationS), strength: 0 });
                break;
            }
        }
        return res;
    }

    /** Advance all timers by dtS; return DoT damage + chill slow + expiries. */
    tick(dtS: number, maxHp: number): StatusTickResult {
        if (this.tracks.size === 0) { this.burnTickAcc = 0; return EMPTY_TICK_RESULT; }
        const out: StatusTickResult = { burnDamage: 0, curseDamage: 0, chillSlowMultiplier: 1, expired: [] };

        const burn = this.tracks.get('burn');
        if (burn) {
            this.burnTickAcc += dtS;
            while (this.burnTickAcc >= STATUS_TUNING.burn.tickIntervalS) {
                out.burnDamage += burn.stacks * burn.strength;
                this.burnTickAcc -= STATUS_TUNING.burn.tickIntervalS;
            }
        } else {
            this.burnTickAcc = 0;
        }

        const curse = this.tracks.get('curse');
        if (curse) out.curseDamage = maxHp * curse.strength * dtS;

        const chill = this.tracks.get('chill');
        if (chill) {
            out.chillSlowMultiplier = Math.max(
                STATUS_TUNING.chill.slowFloor,
                1 - chill.stacks * STATUS_TUNING.chill.slowPerStack,
            );
        }

        let burnExpired = false;
        for (const [kind, t] of this.tracks) {
            t.remainingS -= dtS;
            if (t.remainingS <= 0) {
                out.expired.push(kind);
                if (kind === 'burn') burnExpired = true;
            }
        }
        for (const kind of out.expired) this.tracks.delete(kind);
        if (burnExpired) this.burnTickAcc = 0;
        return out;
    }

    /**
     * Remove a status and return its "burst" damage for a reaction (e.g. Overload
     * detonating burn). Currently only burn yields a burst
     * (stacks × strength × overflowFactor); other kinds return 0 but are still cleared.
     */
    detonate(kind: RichStatusKind): number {
        const t = this.tracks.get(kind);
        if (!t) return 0;
        const burst = kind === 'burn' ? t.stacks * t.strength * STATUS_TUNING.burn.overflowFactor : 0;
        this.tracks.delete(kind);
        if (kind === 'burn') this.burnTickAcc = 0;
        return burst;
    }

    clear(kind?: RichStatusKind): void {
        if (kind) this.tracks.delete(kind);
        else this.tracks.clear();
    }
}
