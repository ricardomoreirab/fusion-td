import { ItemEffectId } from './ItemTypes';

/** Minimal enemy view the effects need — implemented by Enemy, faked in tests. */
export interface EffectEnemy {
    isAlive(): boolean;
    getPosition(): { x: number; z: number };
}

/** Visual hooks. Implemented with ItemFx helpers by the gameplay state;
 *  every implementation must follow the transient-FX material rules. */
export interface EffectFx {
    rageGlow(on: boolean): void;
    coinNova(x: number, z: number): void;
    shockwave(x: number, z: number, radius: number): void;
    ricochet(fromX: number, fromZ: number, toX: number, toZ: number): void;
    echoShimmer(): void;
    /** Expanding ring at (x,z). colorHex MUST be a finite-palette literal. */
    ring(x: number, z: number, colorHex: string, radius: number): void;
    /** Straight beam between two points. colorHex MUST be a finite-palette literal. */
    beam(x0: number, z0: number, x1: number, z1: number, colorHex: string): void;
}

/** World access for effects. Implemented by SurvivorsGameplayState. */
export interface EffectContext {
    heroPos(): { x: number; z: number };
    heroHpFraction(): number;
    /** Alive enemies within `radius` of (x,z). */
    enemiesNear(x: number, z: number, radius: number): EffectEnemy[];
    damage(e: EffectEnemy, amount: number, element: string): void;
    stun(e: EffectEnemy, seconds: number): void;
    burn(e: EffectEnemy, seconds: number, strength: number): void;
    addGold(amount: number): void;
    /** Reduce every power slot's remaining cooldown by `fraction` (0..1). */
    refundCooldownPct(fraction: number): void;
    /** Recast the most recently cast power for free (no cooldown reset). */
    recastFree(): void;
    wave(): number;
    rng(): number;
    /** Player's current crit chance (critExplode rolls its own). */
    critChance(): number;
    /** If the enemy is at/below `fraction` of max HP, route a lethal hit through
     *  the normal death path (gold/FX) and return true. */
    tryExecuteBelow(e: EffectEnemy, fraction: number): boolean;
    fx: EffectFx;
}

export const RAGE_THRESHOLD = 0.5;
export const RAGE_DAMAGE_BONUS = 0.6;
export const ECHO_CHANCE = 0.25;
export const MIDAS_DOUBLE_CHANCE = 0.15;
export const MIDAS_NOVA_GOLD = 150;
export const MIDAS_NOVA_RADIUS = 6;
export const SHOCKWAVE_EVERY_HITS = 6;
export const SHOCKWAVE_COOLDOWN_S = 1.5;
export const SHOCKWAVE_RADIUS = 5;
export const SHOCKWAVE_DAMAGE = 40;
export const SHOCKWAVE_STUN_S = 1;
export const RICOCHET_RANGE = 8;
export const RICOCHET_DAMAGE_FRACTION = 0.6;
export const CRIT_EXPLODE_RADIUS = 3;
export const CRIT_EXPLODE_FRACTION = 0.5;
export const THORNS_MULTIPLIER = 3;
export const THORNS_RADIUS = 2.5;
export const CHRONO_REFUND_FRACTION = 0.1;
export const CHRONO_COOLDOWN_S = 1;
export const BURN_DURATION_S = 3;
export const BURN_STRENGTH = 3;

// Earthbreaker (Titan's Oath 6-pc)
export const QUAKE_EVERY_HITS = 4, QUAKE_COOLDOWN_S = 1.2, QUAKE_RADIUS = 4.5;
export const QUAKE_BASE_DAMAGE = 45, QUAKE_DAMAGE_PER_STACK = 6, MOMENTUM_MAX = 12, QUAKE_STUN_S = 1;
// Tempest Volley (Tempest Stalker 6-pc)
export const TEMPEST_EVERY_HITS = 8, TEMPEST_COOLDOWN_S = 0.5, TEMPEST_FAN_COUNT = 3;
export const TEMPEST_FAN_RANGE = 9, TEMPEST_FAN_FRACTION = 0.7;
export const TEMPEST_STATIC_EVERY = 4, TEMPEST_CHAIN_TARGETS = 2, TEMPEST_CHAIN_RANGE = 6, TEMPEST_CHAIN_FRACTION = 0.45;
// Arcane Cascade (Voidcaller's Sequence 6-pc)
export const CASCADE_NOVA_BASE = 40, CASCADE_NOVA_PER_WAVE = 6, CASCADE_NOVA_RADIUS = 5;
export const CASCADE_ARC_TARGETS = 3, CASCADE_ARC_RANGE = 8, CASCADE_ARC_FRACTION = 0.5;
export const CASCADE_CD_REFUND = 0.08, CASCADE_COOLDOWN_S = 0.5;
// Apex Cleave (Skullsplitter mythic)
export const CLEAVE_RADIUS = 3, CLEAVE_FRACTION = 0.55, EXECUTE_HP_FRACTION = 0.12;
// Storm Quiver (Windsong mythic)
export const STORM_CHARGE_PER_HIT = 1, STORM_CHARGE_MAX = 10, STORM_STRIKE_TARGETS = 5;
export const STORM_STRIKE_RADIUS = 8, STORM_STRIKE_BASE = 45, STORM_STRIKE_PER_WAVE = 6, STORM_STUN_S = 0.6;
// Singularity (Nullbrand mythic)
export const SINGULARITY_RADIUS = 6, SINGULARITY_BASE = 70, SINGULARITY_PER_WAVE = 9;
export const SINGULARITY_CLUSTER_BONUS = 0.06, SINGULARITY_CLUSTER_CAP = 0.6, SINGULARITY_COOLDOWN_S = 0.6;

/** Runs the unique item/set effects. Babylon-free: all world interaction goes
 *  through the injected EffectContext. The gameplay state calls the on*()
 *  entry points from its existing hooks and tick(dt) once per unpaused frame. */
export class ItemEffectRuntime {
    private active = new Set<ItemEffectId>();
    private rageOn = false;
    private hitCounter = 0;
    private shockwaveCd = 0;
    private chronoCd = 0;
    private novaAccum = 0;
    private inEcho = false;
    private inDoublePay = false;
    private quakeHits = 0; private quakeCd = 0; private momentum = 0;
    private tempestHits = 0; private staticHits = 0; private volleyCd = 0;
    private cascadeCd = 0; private inCascade = false;
    private stormCharge = 0;
    private singularityCd = 0; private inSingularity = false;

    constructor(private ctx: EffectContext) {}

    public setActiveEffects(ids: Set<ItemEffectId>): void {
        this.active = ids;
        if (!ids.has('rage') && this.rageOn) {
            this.rageOn = false;
            this.ctx.fx.rageGlow(false);
        }
    }

    /** Basic-attack damage multiplier contributed by effects (RAGE). The state
     *  folds this into the hero's damageMultiplierProvider. */
    public damageBonusMult(): number {
        return this.rageOn ? 1 + RAGE_DAMAGE_BONUS : 1;
    }

    public tick(dt: number): void {
        this.shockwaveCd = Math.max(0, this.shockwaveCd - dt);
        this.chronoCd = Math.max(0, this.chronoCd - dt);
        this.quakeCd = Math.max(0, this.quakeCd - dt);
        this.volleyCd = Math.max(0, this.volleyCd - dt);
        this.cascadeCd = Math.max(0, this.cascadeCd - dt);
        this.singularityCd = Math.max(0, this.singularityCd - dt);
        if (this.active.has('rage')) {
            const low = this.ctx.heroHpFraction() < RAGE_THRESHOLD;
            if (low !== this.rageOn) {
                this.rageOn = low;
                this.ctx.fx.rageGlow(low);
            }
        }
    }

    public onBasicHit(target: EffectEnemy, damage: number): void {
        if (this.active.has('burnOnHit')) {
            this.ctx.burn(target, BURN_DURATION_S, BURN_STRENGTH);
        }
        if (this.active.has('ricochet')) {
            const tp = target.getPosition();
            let best: EffectEnemy | null = null;
            let bestDistSq = RICOCHET_RANGE * RICOCHET_RANGE;
            for (const e of this.ctx.enemiesNear(tp.x, tp.z, RICOCHET_RANGE)) {
                if (e === target || !e.isAlive()) continue;
                const p = e.getPosition();
                const dSq = (p.x - tp.x) ** 2 + (p.z - tp.z) ** 2;
                if (dSq <= bestDistSq) { bestDistSq = dSq; best = e; } // <= : spec says bounce range "≤ 8u"
            }
            if (best) {
                const bp = best.getPosition();
                this.ctx.damage(best, Math.round(damage * RICOCHET_DAMAGE_FRACTION), 'physical');
                this.ctx.fx.ricochet(tp.x, tp.z, bp.x, bp.z);
            }
        }
        if (this.active.has('critExplode') && this.ctx.rng() < this.ctx.critChance()) {
            const tp = target.getPosition();
            for (const e of this.ctx.enemiesNear(tp.x, tp.z, CRIT_EXPLODE_RADIUS)) {
                if (e === target) continue;
                this.ctx.damage(e, Math.round(damage * CRIT_EXPLODE_FRACTION), 'physical');
            }
            this.ctx.fx.shockwave(tp.x, tp.z, CRIT_EXPLODE_RADIUS);
        }
        if (this.active.has('shockwave')) {
            this.hitCounter++;
            if (this.hitCounter >= SHOCKWAVE_EVERY_HITS && this.shockwaveCd <= 0) {
                this.hitCounter = 0;
                this.shockwaveCd = SHOCKWAVE_COOLDOWN_S;
                const hp = this.ctx.heroPos();
                for (const e of this.ctx.enemiesNear(hp.x, hp.z, SHOCKWAVE_RADIUS)) {
                    this.ctx.damage(e, SHOCKWAVE_DAMAGE, 'physical');
                    this.ctx.stun(e, SHOCKWAVE_STUN_S);
                }
                this.ctx.fx.shockwave(hp.x, hp.z, SHOCKWAVE_RADIUS);
            }
        }
        if (this.active.has('earthbreaker')) {
            this.quakeHits++;
            this.momentum = Math.min(MOMENTUM_MAX, this.momentum + 1);
            if (this.quakeHits >= QUAKE_EVERY_HITS && this.quakeCd <= 0) {
                this.quakeHits = 0; this.quakeCd = QUAKE_COOLDOWN_S;
                const tp = target.getPosition();
                const dmg = QUAKE_BASE_DAMAGE + this.momentum * QUAKE_DAMAGE_PER_STACK;
                for (const e of this.ctx.enemiesNear(tp.x, tp.z, QUAKE_RADIUS)) {
                    this.ctx.damage(e, dmg, 'physical');
                    this.ctx.stun(e, QUAKE_STUN_S);
                }
                this.ctx.fx.ring(tp.x, tp.z, '#c47a2c', QUAKE_RADIUS * (1 + this.momentum / MOMENTUM_MAX * 0.6));
                this.momentum = 0;
            }
        }
        if (this.active.has('tempest_volley')) {
            const tp = target.getPosition();
            this.tempestHits++;
            if (this.tempestHits >= TEMPEST_EVERY_HITS && this.volleyCd <= 0) {
                this.tempestHits = 0; this.volleyCd = TEMPEST_COOLDOWN_S;
                const foes = this.ctx.enemiesNear(tp.x, tp.z, TEMPEST_FAN_RANGE)
                    .filter(e => e !== target && e.isAlive()).slice(0, TEMPEST_FAN_COUNT);
                for (const e of foes) {
                    const ep = e.getPosition();
                    this.ctx.damage(e, Math.round(damage * TEMPEST_FAN_FRACTION), 'storm');
                    this.ctx.fx.beam(tp.x, tp.z, ep.x, ep.z, '#7fd4ff');
                }
            }
            this.staticHits++;
            if (this.staticHits >= TEMPEST_STATIC_EVERY) {
                this.staticHits = 0;
                const foes = this.ctx.enemiesNear(tp.x, tp.z, TEMPEST_CHAIN_RANGE)
                    .filter(e => e !== target && e.isAlive()).slice(0, TEMPEST_CHAIN_TARGETS);
                for (const e of foes) {
                    const ep = e.getPosition();
                    this.ctx.damage(e, Math.round(damage * TEMPEST_CHAIN_FRACTION), 'storm');
                    this.ctx.fx.beam(tp.x, tp.z, ep.x, ep.z, '#bfe9ff');
                }
            }
        }
        if (this.active.has('apex_cleave')) {
            const tp = target.getPosition();
            for (const e of this.ctx.enemiesNear(tp.x, tp.z, CLEAVE_RADIUS)) {
                if (e === target) continue;
                this.ctx.damage(e, Math.round(damage * CLEAVE_FRACTION), 'physical');
                this.ctx.tryExecuteBelow(e, EXECUTE_HP_FRACTION);
            }
            this.ctx.tryExecuteBelow(target, EXECUTE_HP_FRACTION);
            this.ctx.fx.ring(tp.x, tp.z, '#ff3a1f', CLEAVE_RADIUS);
        }
        if (this.active.has('storm_quiver')) {
            this.stormCharge += STORM_CHARGE_PER_HIT;
            if (this.stormCharge >= STORM_CHARGE_MAX) {
                this.stormCharge = 0;
                const hp = this.ctx.heroPos();
                const dmg = STORM_STRIKE_BASE + STORM_STRIKE_PER_WAVE * this.ctx.wave();
                const foes = this.ctx.enemiesNear(hp.x, hp.z, STORM_STRIKE_RADIUS)
                    .filter(e => e.isAlive()).slice(0, STORM_STRIKE_TARGETS);
                for (const e of foes) {
                    const ep = e.getPosition();
                    this.ctx.damage(e, dmg, 'storm');
                    this.ctx.stun(e, STORM_STUN_S);
                    this.ctx.fx.ring(ep.x, ep.z, '#bfe9ff', 1.6);
                }
            }
        }
    }

    /** Called from the state's xpSink lambda — sees every gold income. */
    public onGoldEarned(amount: number): void {
        if (!this.active.has('midas')) return;
        if (!this.inDoublePay && this.ctx.rng() < MIDAS_DOUBLE_CHANCE) {
            this.inDoublePay = true;
            try { this.ctx.addGold(amount); } finally { this.inDoublePay = false; }
        }
        this.novaAccum += amount;
        while (this.novaAccum >= MIDAS_NOVA_GOLD) {
            this.novaAccum -= MIDAS_NOVA_GOLD;
            const hp = this.ctx.heroPos();
            const dmg = 25 + 5 * this.ctx.wave();
            for (const e of this.ctx.enemiesNear(hp.x, hp.z, MIDAS_NOVA_RADIUS)) {
                this.ctx.damage(e, dmg, 'physical');
            }
            this.ctx.fx.coinNova(hp.x, hp.z);
        }
    }

    public onHeroHurt(amount: number): void {
        if (amount <= 0) return;
        if (this.active.has('thorns')) {
            const hp = this.ctx.heroPos();
            for (const e of this.ctx.enemiesNear(hp.x, hp.z, THORNS_RADIUS)) {
                this.ctx.damage(e, amount * THORNS_MULTIPLIER, 'physical');
            }
        }
        if (this.active.has('chrono') && this.chronoCd <= 0) {
            this.chronoCd = CHRONO_COOLDOWN_S;
            this.ctx.refundCooldownPct(CHRONO_REFUND_FRACTION);
        }
    }

    public onPowerCast(): void {
        if (this.active.has('echo') && !this.inEcho && this.ctx.rng() < ECHO_CHANCE) {
            this.inEcho = true;
            try {
                this.ctx.recastFree();
                this.ctx.fx.echoShimmer();
            } finally {
                this.inEcho = false;
            }
        }
        if (this.active.has('arcane_cascade') && !this.inCascade && this.cascadeCd <= 0) {
            this.inCascade = true; this.cascadeCd = CASCADE_COOLDOWN_S;
            try {
                const hp = this.ctx.heroPos();
                const dmg = CASCADE_NOVA_BASE + CASCADE_NOVA_PER_WAVE * this.ctx.wave();
                const inRadius = this.ctx.enemiesNear(hp.x, hp.z, CASCADE_NOVA_RADIUS).filter(e => e.isAlive());
                for (const e of inRadius) this.ctx.damage(e, dmg, 'arcane');
                const arc = this.ctx.enemiesNear(hp.x, hp.z, CASCADE_ARC_RANGE)
                    .filter(e => e.isAlive() && !inRadius.includes(e)).slice(0, CASCADE_ARC_TARGETS);
                for (const e of arc) this.ctx.damage(e, Math.round(dmg * CASCADE_ARC_FRACTION), 'arcane');
                this.ctx.refundCooldownPct(CASCADE_CD_REFUND);
                this.ctx.fx.ring(hp.x, hp.z, '#8a3cff', CASCADE_NOVA_RADIUS);
            } finally { this.inCascade = false; }
        }
        if (this.active.has('singularity') && !this.inSingularity && this.singularityCd <= 0) {
            this.inSingularity = true; this.singularityCd = SINGULARITY_COOLDOWN_S;
            try {
                const hp = this.ctx.heroPos();
                const foes = this.ctx.enemiesNear(hp.x, hp.z, SINGULARITY_RADIUS).filter(e => e.isAlive());
                const base = SINGULARITY_BASE + SINGULARITY_PER_WAVE * this.ctx.wave();
                const mult = 1 + Math.min(SINGULARITY_CLUSTER_CAP, Math.max(0, foes.length - 1) * SINGULARITY_CLUSTER_BONUS);
                const dmg = Math.round(base * mult);
                for (const e of foes) this.ctx.damage(e, dmg, 'arcane');
                this.ctx.fx.ring(hp.x, hp.z, '#7a18ff', SINGULARITY_RADIUS);
                this.ctx.fx.ring(hp.x, hp.z, '#b070ff', 1.5);
            } finally { this.inSingularity = false; }
        }
    }

    public reset(): void {
        if (this.rageOn) this.ctx.fx.rageGlow(false);
        this.active = new Set();
        this.rageOn = false;
        this.hitCounter = 0;
        this.shockwaveCd = 0;
        this.chronoCd = 0;
        this.novaAccum = 0;
        this.inEcho = false;
        this.inDoublePay = false;
        this.quakeHits = 0; this.quakeCd = 0; this.momentum = 0;
        this.tempestHits = 0; this.staticHits = 0; this.volleyCd = 0;
        this.cascadeCd = 0; this.inCascade = false;
        this.stormCharge = 0;
        this.singularityCd = 0; this.inSingularity = false;
    }
}
