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
                if (dSq < bestDistSq) { bestDistSq = dSq; best = e; }
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
        if (!this.active.has('echo') || this.inEcho) return;
        if (this.ctx.rng() < ECHO_CHANCE) {
            this.inEcho = true;
            try {
                this.ctx.recastFree();
                this.ctx.fx.echoShimmer();
            } finally {
                this.inEcho = false;
            }
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
    }
}
