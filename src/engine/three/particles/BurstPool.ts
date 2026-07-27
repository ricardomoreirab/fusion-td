/**
 * BurstPool - recycles one-shot particle bursts instead of building and tearing
 * down a whole @newkrok/three-particles system per spawn.
 *
 * WHY
 * ---
 * `spawnFx` is the highest-rate allocator in the game: the barbarian's on-hit
 * passives fire it for EVERY enemy on EVERY hit, so a maxed 4-fusion loadout
 * against ~250 enemies builds ~780 particle systems a SECOND. Each construction
 * deep-merges the library's default config, allocates `maxParticles` Vector3s
 * several times over, a BufferGeometry with ~8 attributes, a ShaderMaterial and
 * an Object3D; each teardown runs a filter over the library's live-system array
 * (O(live), so it degrades as the fight grows). Measured in Node on the real
 * `fireImpactConfig` recipe: create+dispose 15.8 us, re-arming a pooled system
 * 2.3 us - a 6.8x cut, plus several MB/s of garbage that never gets allocated.
 *
 * HOW
 * ---
 * The library exposes no restart: `creationTime`, `lastEmissionTime` and
 * `generalData.burstStates` all live in a closure. But the caller owns the
 * CLOCK - `ParticleEffect` feeds `now` to `handle.update()` - and the library
 * re-arms burst states on its own when a LOOPING system wraps into a new
 * iteration:
 *
 *     if (looping && currentIterationTime < burstTimeMs && cyclesExecuted > 0)
 *         -> reset the burst
 *     if (currentIterationTime >= burstTimeMs && cyclesExecuted < cycles)
 *         -> fire the burst
 *
 * where `currentIterationTime = (now - creationTime) % (duration * 1000)`. So a
 * pooled recipe is the authored one-shot config with three edits:
 *
 *   1. `looping: true`      - the reset branch is gated on it;
 *   2. every burst time +1ms - a burst at time 0 can NEVER satisfy
 *                              `currentIterationTime < 0`, which is exactly why
 *                              the naive "just replay it" approach fails;
 *   3. `duration: 3600s`    - the iteration is made so long that the clock can
 *                              never wrap on its own. Every re-arm is driven
 *                              explicitly by `ParticleEffect.arm()`, so nothing
 *                              can emit a burst the game did not ask for.
 *
 * `arm()` then steps the system twice inside one call: once at the iteration
 * start (resets the burst states, emits nothing) and once at the +1ms lead (the
 * burst fires). The effect is live on the same frame it is spawned, exactly as
 * before.
 *
 * WHY IT IS OUTPUT-EQUIVALENT
 * ---------------------------
 * `activateParticle` re-draws EVERY per-particle value on every activation -
 * colour ratio, start lifetime, size, opacity, rotation, and the shape's random
 * position/velocity. Nothing visible is baked at construction, so a recycled
 * burst is drawn from the same distributions as a fresh one. The three config
 * edits are inert for a burst-only recipe: with `rateOverTime === 0` and every
 * burst already fired, `looping` changes no emission, and `duration` is read
 * only as the iteration length and as `normalizedLifetimePercentage`, which
 * feeds `calculateValue` for the start values - hence the poolability check
 * below rejects any recipe whose start values are lifetime CURVES rather than
 * constants or {min,max} ranges.
 */

import type { Vector3 } from 'three';
import { RendererType, SimulationSpace, type ParticleSystemConfig } from '@newkrok/three-particles';
import { ParticleEffect } from './ParticleEffect';
import type { SceneHost } from '../SceneHost';

/** Iteration length of a pooled recipe. Long enough that the library's own wrap
 *  is unreachable (an effect is retired ~0.5s after it fires), so the ONLY
 *  re-arm is the one `arm()` drives. */
const PERIOD_MS = 3_600_000;

/** How far into an iteration the bursts are moved. Must be > 0 or the reset
 *  branch is unreachable; sub-frame so the shape of a multi-wave nova is
 *  unchanged. `arm()` lands the clock on it exactly, so nothing is delayed. */
const LEAD_MS = 1;

/** Free-list ceiling per recipe. The list only ever holds RETIRED effects, so
 *  it converges on peak concurrency; the cap is a backstop against a recipe
 *  that somehow spikes, not a working limit. */
const MAX_FREE_PER_RECIPE = 128;

export interface PooledBurstRecipe {
    /** The rewritten config every pooled instance of this recipe is built from. */
    readonly config: ParticleSystemConfig;
    readonly periodMs: number;
    readonly leadMs: number;
    /** Simulated ms from the fire step until the last particle is provably gone. */
    readonly lifeMs: number;
}

/** A scalar the library reads through `calculateValue`: a constant or a random
 *  range. Anything with a `type` is a LifeTimeCurve sampled against the SYSTEM's
 *  lifetime percentage, which a pooled recipe's stretched duration would change. */
type Scalar = number | { min?: number; max?: number } | { type: unknown } | undefined;

function isConstantScalar(v: Scalar): boolean {
    if (v === undefined || typeof v === 'number') return true;
    return typeof v === 'object' && !('type' in v);
}

/** Upper bound of a constant scalar, or null when it is a curve. */
function scalarMax(v: Scalar): number | null {
    if (v === undefined) return null;
    if (typeof v === 'number') return v;
    if ('type' in v) return null;
    const range = v as { min?: number; max?: number };
    return Math.max(range.min ?? 0, range.max ?? 0);
}

/**
 * Rewrite a one-shot burst config into a poolable recipe, or return null when
 * the recipe is not provably safe to recycle.
 *
 * Everything rejected here is rejected because recycling it would change what
 * the player sees, not because it is hard:
 *  - a non-zero emission RATE keeps emitting for as long as the system runs, and
 *    `looping: true` removes the `duration` cut-off that stops it;
 *  - a multi-cycle / probabilistic burst carries state the reset does not model;
 *  - LOCAL simulation space bakes the emitter transform into particle positions
 *    differently, and no shipped one-shot recipe uses it;
 *  - sub-emitters and trails own child systems with their own lifecycles;
 *  - a lifetime CURVE on a start value reads the system's duration, which the
 *    rewrite stretches.
 */
export function makePooledBurstRecipe(source: ParticleSystemConfig): PooledBurstRecipe | null {
    const emission = source.emission;
    if (!emission || !emission.bursts || emission.bursts.length === 0) return null;
    if (emission.rateOverTime !== 0) return null;
    if ((emission.rateOverDistance ?? 0) !== 0) return null;
    if (source.looping !== false) return null;
    if (source.simulationSpace !== SimulationSpace.WORLD) return null;
    if ((source.startDelay ?? 0) !== 0) return null;
    if (source.subEmitters && source.subEmitters.length > 0) return null;
    if (source.renderer?.rendererType === RendererType.TRAIL) return null;
    if (source.transform?.position || source.transform?.scale) return null;

    if (!isConstantScalar(source.startSize as Scalar)) return null;
    if (!isConstantScalar(source.startOpacity as Scalar)) return null;
    if (!isConstantScalar(source.startRotation as Scalar)) return null;
    if (!isConstantScalar(source.startSpeed as Scalar)) return null;
    const maxLifeS = scalarMax(source.startLifetime as Scalar);
    if (maxLifeS === null) return null;

    let lastBurstMs = 0;
    const bursts = [];
    for (const burst of emission.bursts) {
        if ((burst.cycles ?? 1) !== 1) return null;
        if ((burst.probability ?? 1) !== 1) return null;
        if (!isConstantScalar(burst.count as Scalar)) return null;
        const timeMs = burst.time * 1000 + LEAD_MS;
        if (timeMs > lastBurstMs) lastBurstMs = timeMs;
        bursts.push({ ...burst, time: timeMs / 1000 });
    }

    // The last particle is deactivated on the first update whose particle age
    // strictly exceeds its start lifetime, and no particle can start later than
    // the last burst - so retiring past this point provably leaves the free list
    // whole. It is also SHORTER than the authored `duration` (which the recipes
    // pad by 0.1s), so a pooled effect ticks for less time than it used to.
    const lifeMs = lastBurstMs + maxLifeS * 1000;

    return {
        config: {
            ...source,
            looping: true,
            duration: PERIOD_MS / 1000,
            emission: { ...emission, bursts },
        },
        periodMs: PERIOD_MS,
        leadMs: LEAD_MS,
        lifeMs,
    };
}

interface PoolEntry {
    readonly host: SceneHost;
    /** Diagnostic name every instance of this recipe carries. Two spawn names
     *  that share one memoised config (the storm impact is spawned under two)
     *  share a pool and the first name; the object name is read only by the
     *  resource census. */
    readonly name: string;
    readonly recipe: PooledBurstRecipe;
    readonly free: ParticleEffect[];
    readonly live: Set<ParticleEffect>;
}

/**
 * Keyed by the SOURCE CONFIG OBJECT, which is what makes the pool safe without
 * a deep comparison per spawn: a pooled instance can only ever be handed back to
 * a caller passing the very object its recipe was derived from. Call sites
 * therefore have to memoise their configs (see ElementParticles), which also
 * bounds this map - same contract as MaterialCache's keys.
 */
const pools = new Map<ParticleSystemConfig, PoolEntry | null>();

/**
 * Spawn `config` at `position` through the pool. Returns false when the recipe
 * is not poolable, in which case the caller builds a one-shot ParticleEffect as
 * before.
 */
export function spawnPooledBurst(
    name: string, host: SceneHost, config: ParticleSystemConfig, position: Vector3
): boolean {
    let entry = pools.get(config);
    if (entry === undefined || (entry !== null && entry.host !== host)) {
        if (entry) disposeEntry(entry);
        const recipe = makePooledBurstRecipe(config);
        entry = recipe ? { host, name, recipe, free: [], live: new Set<ParticleEffect>() } : null;
        pools.set(config, entry);
    }
    if (!entry) return false;

    const owner = entry;
    let effect = owner.free.pop();
    if (!effect) {
        effect = new ParticleEffect(owner.name, host, owner.recipe.config, {
            sharedMaterial: owner.name,
            burst: owner.recipe,
        });
        effect.onBurstFinished = (finished) => {
            owner.live.delete(finished);
            if (owner.free.length < MAX_FREE_PER_RECIPE) owner.free.push(finished);
            else finished.dispose();
        };
    }
    owner.live.add(effect);
    effect.arm(position);
    return true;
}

function disposeEntry(entry: PoolEntry): void {
    for (const effect of entry.free) effect.dispose();
    for (const effect of entry.live) effect.dispose();
    entry.free.length = 0;
    entry.live.clear();
}

/** Frees every pooled effect. Run teardown only - sibling of
 *  clearParticleMaterialCache()/clearMaterialCache()/clearProjectilePools(). */
export function clearBurstPool(): void {
    for (const entry of pools.values()) if (entry) disposeEntry(entry);
    pools.clear();
}

/** Live counts - lets specs assert the pool stays bounded and gives the resource
 *  watchdog something to report. */
export function burstPoolStats(): { recipes: number; free: number; live: number } {
    let free = 0;
    let live = 0;
    for (const entry of pools.values()) {
        if (!entry) continue;
        free += entry.free.length;
        live += entry.live.size;
    }
    return { recipes: pools.size, free, live };
}
