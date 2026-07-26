/**
 * World access for Ascension node effects. Implemented by SurvivorsGameplayState,
 * faked in tests. Deliberately NOT an extension of EffectContext.
 *
 * The single most important difference: there is no `enemiesNear(): Enemy[]`.
 * ItemEffectRuntime's version allocates a fresh array on every call, which at
 * wave-40 horde scale with a dozen live nodes is exactly the allocation-in-a-hot-
 * path failure the perf backlog documents. Here the proximity API is a COUNTED
 * VISITOR, so no node *can* allocate — it is a type-level guarantee rather than a
 * convention someone has to remember.
 */

/** Minimal enemy view the effects need — implemented by Enemy, faked in tests. */
export interface AscEnemy {
    isAlive(): boolean;
    getPosition(): { x: number; z: number };
    getHealth(): number;
    getMaxHealth(): number;
}

export interface AscensionContext {
    heroPos(): { x: number; z: number };
    heroHpFraction(): number;

    /** How many alive enemies are within `radius` — allocation-free. */
    enemiesNearCount(x: number, z: number, radius: number): number;
    /** Visit alive enemies within `radius` — allocation-free. */
    forEachEnemyNear(x: number, z: number, radius: number, cb: (e: AscEnemy) => void): void;

    damage(e: AscEnemy, amount: number, element: string): void;
    /** Curse: `fracPerSec` of the target's MAX HP per second. The only mechanic
     *  that keeps scaling through the wave-10/15 red-tier HP explosion. */
    curse(e: AscEnemy, durationS: number, fracPerSec: number): void;
    /** One Fragile stack per call (the underlying model stacks them). */
    fragile(e: AscEnemy, durationS: number): void;
    hasStatus(e: AscEnemy, kind: 'burn' | 'chill' | 'curse' | 'fragile'): boolean;
    /** Consume a rich status, returning its reaction burst damage (0 if absent). */
    detonateStatus(e: AscEnemy, kind: 'burn' | 'chill' | 'curse' | 'fragile'): number;

    heal(amount: number): void;
    basicDamage(): number;
    /** Knock `e` away from (fromX, fromZ) by `force` world units. */
    knockback(e: AscEnemy, fromX: number, fromZ: number, force: number): void;
    /** Shave `seconds` off every ultimate cooldown. */
    reduceAbilityCooldowns(seconds: number): void;
    /** A lingering ground zone. `element` MUST be a finite-palette literal — the
     *  zone material is cached by `fx_zone_${element}`, and an unbounded key is
     *  the documented cause of this project's recurring multi-second freeze. */
    zone(x: number, z: number, opts: {
        radius: number; durationS: number; tickDamage: number;
        element: string; crawlToward?: { x: number; z: number }; crawlSpeed?: number;
    }): void;
    /** Expanding ring FX. colorHex MUST be a finite-palette literal. */
    ring(x: number, z: number, colorHex: string, radius: number): void;
    rng(): number;

    // ── Hero / ability queries ──────────────────────────────────────────────
    heroMaxHp(): number;
    /** Visit EVERY living enemy. Only for arena-wide effects, and only ever from
     *  a throttled timer — at wave 40 this is well over a thousand enemies. */
    forEachEnemyAlive(cb: (e: AscEnemy) => void): void;
    /** Apply chill stacks (they convert to FROZEN at the model's threshold). */
    chill(e: AscEnemy, durationS: number, stacks: number): void;
    /** Slow an enemy by `frac` (0.25 = 25% slower) for `durationS`. */
    slow(e: AscEnemy, frac: number, durationS: number): void;
    /** Remaining seconds on a running timed ability effect, 0 when not active. */
    abilityTimeLeft(id: string): number;
    /** Extend a running timed ability effect; returns the new remaining time. */
    extendAbility(id: string, seconds: number): number;
    /** Shave `seconds` off ONE ability's cooldown (Storm-Born refunds blink only). */
    reduceAbilityCooldown(id: string, seconds: number): void;
    /** Fire the hero's weapon enchantments on one enemy (Runeblooded r3). */
    applyEnchantments(e: AscEnemy): void;
    /** Free Whirlwind re-cast, no cooldown (Bladestorm Echo). */
    castFreeWhirlwind(durationS: number, radiusMult: number): void;
    /** Free Smash at a damage scale, no cooldown. */
    castFreeSmash(damageMult: number): void;
    /** Force-fire every equipped autocast slot (The Endless Canticle discharge).
     *  Deliberately does NOT route back through onPowerCast — forced casts must
     *  generate no Resonance or the resource loop diverges. */
    forceCastAutocastSlots(): void;
    /** Cast one slot free; -1 picks the least-recently-cast (The Second Voice). */
    castSlotFree(index: number): void;
    /** Install the run-wide chain bonus (Forked Lightning). Null clears it. */
    setChainBonus(b: { extraHops: number; radiusBonus: number; split: boolean } | null): void;
}
