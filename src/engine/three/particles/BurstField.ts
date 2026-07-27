/**
 * BurstField - draws and simulates EVERY live one-shot burst of a recipe through
 * ONE @newkrok/three-particles system instead of one system per spawn.
 *
 * WHY
 * ---
 * `BurstPool` removed the cost of BUILDING a system per hit, but a pooled effect
 * is still a scene object of its own: at a maxed 4-fusion loadout the frame draws
 * one `Points`/`Mesh` per live burst, and a live census at a 529-enemy horde
 * counted 325 `arcaneBiteImpact` + 268 `flamingEdgeImpact` draws in a 2734-draw
 * frame - 22% of everything submitted, the largest bucket after the enemies
 * themselves. Each one also pays the library's per-system frame overhead: a
 * compose -> multiply -> decompose -> euler chain that runs once per system
 * regardless of particle count (~35% of the per-system tick, measured with
 * `node --cpu-prof`), plus a frustum test, a render-list push, a sort key and a
 * `setProgram`.
 *
 * One system for the whole recipe collapses all of that to one of each, and the
 * per-PARTICLE work is unchanged - the same library loop over the same number of
 * live particles.
 *
 * HOW
 * ---
 * Two facts about the library make it possible, both verified against the
 * shipped `dist/index.js` rather than assumed:
 *
 *  1. `emission.bursts` is read fresh out of the caller's own array on every
 *     update (`createParticleSystem` keeps the reference), so a burst's `time`
 *     and `count` can be rewritten in place per frame at no cost.
 *  2. `activateParticle` writes a WORLD-space particle position as
 *     `shapeOffset * worldScale + systemWorldTranslation` and sets the slot's
 *     `lifetime` scalar to 0. With the field parked at the ORIGIN, a fresh
 *     particle therefore holds exactly the shape offset a per-spawn system would
 *     have produced before its own translation was added - so adding the spawn
 *     position to the freshly-born slots reproduces that system exactly, and
 *     `lifetime === 0 && isActive` identifies precisely those slots.
 *
 * Firing on demand needs TWO bursts. The library's reset branch
 * (`currentIterationTime < burstTime`) and its fire branch
 * (`currentIterationTime >= burstTime`) are mutually exclusive within one
 * update, so a single burst could fire only every other frame. Two bursts
 * alternate roles instead: each frame the field puts the one it wants to fire
 * just BEHIND the clock and the other just AHEAD of it, which fires the first
 * and re-arms the second in the same update.
 *
 * WHAT IS DELIBERATELY NOT MERGED
 * -------------------------------
 * `makeBurstFieldRecipe` is the gate and it is strict; anything it rejects keeps
 * the caller's existing pooled/one-shot path. On top of everything `BurstPool`
 * rejects it additionally requires:
 *
 *  - EXACTLY ONE burst at time 0 with a CONSTANT count. Multi-wave recipes would
 *    need a per-spawn schedule, and a `{min,max}` count is drawn once for the
 *    whole merged burst rather than once per spawn.
 *  - ADDITIVE blending. Merging N transparent objects into one changes where the
 *    result sits in the transparent queue; under additive blending the fragments
 *    commute, so that reordering cannot change the image.
 *  - No noise, force fields or collision planes - all three read state the merge
 *    would share across spawns that used to own it privately.
 *
 * Overflow is not a failure mode: once a field's capacity is committed the
 * caller falls back to the pool, so an extreme spike degrades to the previous
 * behaviour instead of dropping particles.
 */

import { AdditiveBlending, type BufferAttribute, type InterleavedBufferAttribute, type Object3D, type Vector3 } from 'three';
import {
    RendererType,
    SimulationSpace,
    createParticleSystem,
    type ParticleSystemConfig,
    type ParticleSystem as LibParticleSystem,
} from '@newkrok/three-particles';
import type { SceneHost, SceneParticleSystem } from '../SceneHost';
import { getSoftParticleTexture } from './ParticleEffect';

/** Iteration length of a field's system. The clock only ever advances by real
 *  frame time, so at 24h the library can never wrap on its own and
 *  `normalizedLifetimePercentage` stays near 0 - which is why the gate below
 *  rejects any start value read from a lifetime CURVE. */
const FIELD_DURATION_S = 86_400;

/** How far AHEAD of the clock a burst is parked to re-arm it. Any positive value
 *  works; the burst is moved again before it could ever be reached. */
const RESET_LEAD_MS = 1_000;

/** Roughly how many particle slots ONE field carries, rounded to a whole number
 *  of spawns so capacity accounting is exact.
 *
 *  A field scans all of its slots every frame it is attached, live or not, so a
 *  single field sized for the worst case would tax every quiet frame. Peak load
 *  is covered by CHAINING instead: spawns pack into the earliest field with
 *  room, a new one is built when they are all full, and a field that empties
 *  detaches from the scene and the tick registry until it is needed again. A
 *  measured endgame peak (~330 concurrent impact bursts of one recipe) lands at
 *  four attached fields - four draws in place of 330. */
const FIELD_PARTICLE_TARGET = 1_024;

/** Chain ceiling per recipe. Past this the caller falls back to its pooled path,
 *  which is the pre-merge behaviour - never a dropped particle. */
const MAX_FIELDS_PER_RECIPE = 8;

/** Guarantees the clock advances even on a zero-length frame, so a particle born
 *  last frame can never still read `lifetime === 0` and be mistaken for a fresh
 *  one. One microsecond is four orders of magnitude below a frame. */
const MIN_CLOCK_STEP_MS = 0.001;

interface MutableBurst {
    time: number;
    count: number;
}

export interface BurstFieldRecipe {
    /** The rewritten config the field's single system is built from. */
    readonly config: ParticleSystemConfig;
    /** The two burst objects INSIDE `config.emission.bursts`, rewritten in place
     *  each frame. */
    readonly bursts: readonly [MutableBurst, MutableBurst];
    readonly particlesPerSpawn: number;
    readonly capacity: number;
}

/** A scalar the library reads through `calculateValue`: constant or random range.
 *  Anything with a `type` is a curve sampled against the SYSTEM lifetime, which a
 *  permanent field does not share with a one-shot. */
type Scalar = number | { min?: number; max?: number } | { type: unknown } | undefined;

function isConstantScalar(v: Scalar): boolean {
    if (v === undefined || typeof v === 'number') return true;
    return typeof v === 'object' && !('type' in v);
}

/**
 * Rewrite a one-shot burst config into a mergeable field recipe, or return null
 * when merging it could change what the player sees.
 */
export function makeBurstFieldRecipe(source: ParticleSystemConfig): BurstFieldRecipe | null {
    const emission = source.emission;
    if (!emission || !emission.bursts || emission.bursts.length !== 1) return null;
    if (emission.rateOverTime !== 0) return null;
    if ((emission.rateOverDistance ?? 0) !== 0) return null;
    if (source.looping !== false) return null;
    if (source.simulationSpace !== SimulationSpace.WORLD) return null;
    if ((source.startDelay ?? 0) !== 0) return null;
    if (source.subEmitters && source.subEmitters.length > 0) return null;
    if (source.renderer?.rendererType === RendererType.TRAIL) return null;
    if (source.transform?.position || source.transform?.scale) return null;
    if (source.forceFields && source.forceFields.length > 0) return null;
    if (source.collisionPlanes && source.collisionPlanes.length > 0) return null;
    if (source.noise?.isActive) return null;

    // Additive is what makes one merged object indistinguishable from N: the
    // fragments sum, so the transparent-queue position the merge collapses
    // cannot matter.
    if (source.renderer?.blending !== AdditiveBlending) return null;

    if (!isConstantScalar(source.startSize as Scalar)) return null;
    if (!isConstantScalar(source.startOpacity as Scalar)) return null;
    if (!isConstantScalar(source.startRotation as Scalar)) return null;
    if (!isConstantScalar(source.startSpeed as Scalar)) return null;
    if (!isConstantScalar(source.startLifetime as Scalar)) return null;

    const burst = emission.bursts[0];
    if (burst.time !== 0) return null;
    if ((burst.cycles ?? 1) !== 1) return null;
    if ((burst.probability ?? 1) !== 1) return null;
    if (typeof burst.count !== 'number' || burst.count <= 0) return null;

    const particlesPerSpawn = Math.floor(burst.count);
    const spawns = Math.max(1, Math.round(FIELD_PARTICLE_TARGET / particlesPerSpawn));
    const capacity = particlesPerSpawn * spawns;

    // Both parked ahead of the clock and inert until the first frame that fires.
    const bursts: [MutableBurst, MutableBurst] = [
        { ...burst, time: FIELD_DURATION_S, count: 0 },
        { ...burst, time: FIELD_DURATION_S, count: 0 },
    ];

    return {
        config: {
            ...source,
            looping: true,
            duration: FIELD_DURATION_S,
            maxParticles: capacity,
            // A memoised source config can be carrying ParticleEffect's
            // auto-dispose hook; a looping system never reaches onComplete, but
            // there is no reason for the field to hold a foreign callback.
            onComplete: undefined,
            emission: { ...emission, bursts },
        },
        bursts,
        particlesPerSpawn,
        capacity,
    };
}

type ScalarAttr = InterleavedBufferAttribute;

/** One merged system: every live burst of one recipe. */
class BurstField implements SceneParticleSystem {
    public readonly object: Object3D;

    private readonly handle: LibParticleSystem;
    private readonly recipe: BurstFieldRecipe;
    private readonly host: SceneHost;

    /** Flat x,y,z of the spawns requested since the last tick. */
    private readonly pending: number[] = [];
    /** Reused argument for handle.update() - the library destructures it. */
    private readonly updateArg = { now: 1, delta: 0, elapsed: 0 };

    private nowMs = 1;
    private readonly creationMs = 1;
    private elapsed = 0;
    /** Which of the two bursts fires next; they swap every firing frame. */
    private activeBurst = 0;
    private attached = false;
    private disposed = false;

    /** Slots holding a live particle, refreshed by every tick. */
    private live = 0;
    /** Slots this frame's pending spawns have already claimed. */
    private claimed = 0;

    private readonly offsets: BufferAttribute;
    private readonly scalars: Float32Array;
    private readonly scalarBuffer: { needsUpdate: boolean };
    private readonly stride: number;
    private readonly isActiveAt: number;
    private readonly lifetimeAt: number;
    private readonly sizeAt: number;
    /** Scratch for _placeFresh: indices of the slots born this update. */
    private readonly freshSlots: Int32Array;

    constructor(name: string, host: SceneHost, recipe: BurstFieldRecipe) {
        this.host = host;
        this.recipe = recipe;
        recipe.config.map ??= getSoftParticleTexture();
        this.handle = createParticleSystem(recipe.config, this.nowMs);
        this.object = this.handle.instance;
        this.object.name = name;
        // The field spans the whole arena and its geometry's bounding sphere is
        // computed once and cached forever, so the only correct answer is to opt
        // out of the frustum test entirely - for ONE object, not for the ~300
        // this replaces.
        this.object.frustumCulled = false;

        const attrs = (this.object as Object3D & { geometry: { attributes: Record<string, BufferAttribute | ScalarAttr> } }).geometry.attributes;
        // The MESH renderer keeps per-particle positions in `instanceOffset`;
        // `position` there is the ember/shard model.
        this.offsets = (attrs.instanceOffset ?? attrs.position) as BufferAttribute;
        const active = (attrs.instanceIsActive ?? attrs.isActive) as ScalarAttr;
        const lifetime = (attrs.instanceLifetime ?? attrs.lifetime) as ScalarAttr;
        const size = (attrs.instanceSize ?? attrs.size) as ScalarAttr;
        this.scalars = active.data.array as Float32Array;
        this.scalarBuffer = active.data;
        this.stride = active.data.stride;
        this.isActiveAt = active.offset;
        this.lifetimeAt = lifetime.offset;
        this.sizeAt = size.offset;
        this.freshSlots = new Int32Array(recipe.capacity);
    }

    /** Slots left for new spawns this frame. */
    public get room(): number {
        return this.recipe.capacity - this.live - this.claimed;
    }

    /** Queue a burst at `position`; it fires in this frame's particle tick. */
    public enqueue(position: Vector3): void {
        this.pending.push(position.x, position.y, position.z);
        this.claimed += this.recipe.particlesPerSpawn;
        if (!this.attached) {
            this.attached = true;
            this.host.scene.add(this.object);
            this.host.registerParticleSystem(this);
        }
    }

    public tick(dtSeconds: number): void {
        if (this.disposed) return;
        const stepMs = Math.max(dtSeconds * 1000, MIN_CLOCK_STEP_MS);
        this.nowMs += stepMs;
        this.elapsed += stepMs / 1000;

        const groups = this.pending.length / 3;
        const iterationMs = this.nowMs - this.creationMs;
        const [first, second] = this.recipe.bursts;
        const firing = groups > 0 ? this.recipe.bursts[this.activeBurst] : null;
        // Everything not firing is parked AHEAD of the clock, which is what
        // re-arms whichever burst went off last frame.
        first.count = 0;
        second.count = 0;
        first.time = (iterationMs + RESET_LEAD_MS) / 1000;
        second.time = (iterationMs + RESET_LEAD_MS) / 1000;
        if (firing) {
            firing.time = (iterationMs - 1) / 1000;
            firing.count = groups * this.recipe.particlesPerSpawn;
        }

        this.updateArg.now = this.nowMs;
        this.updateArg.delta = dtSeconds;
        this.updateArg.elapsed = this.elapsed;
        this.handle.update(this.updateArg);

        if (firing) this.activeBurst ^= 1;
        this.live = this._placeFresh(groups);
        this.pending.length = 0;
        this.claimed = 0;

        if (this.live === 0) this._detach();
    }

    /**
     * Translate this update's newly-born slots onto their spawn positions, zero
     * the size of every dead slot, and return the live count.
     *
     * The two jobs share one pass because both need the same scan, and zeroing
     * dead slots matters: a merged field carries far more idle capacity than a
     * per-spawn system ever did, and the library's vertex shader derives
     * `gl_PointSize` (and the MESH instance scale) straight from the size scalar
     * without consulting `isActive`.
     *
     * Fresh slots are collected in INDEX order rather than birth order, so a
     * group can receive particles the library emitted for a different one. That
     * is invisible: every per-particle value is drawn independently from the same
     * distributions on every activation, so all that matters is that each group
     * gets its own count.
     */
    private _placeFresh(groups: number): number {
        const scalars = this.scalars;
        const stride = this.stride;
        const isActiveAt = this.isActiveAt;
        const lifetimeAt = this.lifetimeAt;
        const sizeAt = this.sizeAt;
        const capacity = this.recipe.capacity;
        const fresh = this.freshSlots;
        let freshCount = 0;
        let live = 0;
        let deadZeroed = false;

        for (let i = 0, base = 0; i < capacity; i++, base += stride) {
            if (scalars[base + isActiveAt] === 0) {
                if (scalars[base + sizeAt] !== 0) {
                    scalars[base + sizeAt] = 0;
                    deadZeroed = true;
                }
                continue;
            }
            live++;
            if (groups > 0 && scalars[base + lifetimeAt] === 0) fresh[freshCount++] = i;
        }
        if (deadZeroed) this.scalarBuffer.needsUpdate = true;
        if (freshCount === 0) return live;

        const offsets = this.offsets.array as Float32Array;
        const pending = this.pending;
        const per = this.recipe.particlesPerSpawn;
        for (let n = 0; n < freshCount; n++) {
            // A group short of particles can only happen if the free list ran
            // out mid-burst, which the capacity accounting is there to prevent.
            const group = Math.min((n / per) | 0, groups - 1);
            const slot = fresh[n] * 3;
            const src = group * 3;
            offsets[slot] += pending[src];
            offsets[slot + 1] += pending[src + 1];
            offsets[slot + 2] += pending[src + 2];
        }
        this.offsets.needsUpdate = true;
        return live;
    }

    private _detach(): void {
        if (!this.attached) return;
        this.attached = false;
        this.object.removeFromParent();
        this.host.unregisterParticleSystem(this);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this._detach();
        this.handle.dispose();
    }

    /** Diagnostics only. */
    public get liveParticles(): number {
        return this.live;
    }
}

interface FieldEntry {
    readonly host: SceneHost;
    readonly name: string;
    readonly recipe: BurstFieldRecipe;
    /** Chained fields, filled earliest-first so the tail stays detached. */
    readonly chain: BurstField[];
}

/**
 * Keyed on the SOURCE CONFIG OBJECT, exactly like `BurstPool`: call sites
 * memoise their recipes (see ElementParticles), which both bounds this map and
 * removes any need for a per-spawn deep comparison.
 */
const fields = new Map<ParticleSystemConfig, FieldEntry | null>();

/**
 * Spawn `config` at `position` through the recipe's merged field. Returns false
 * when the recipe cannot be merged or the field is full for this frame, in which
 * case the caller falls back to its pooled / one-shot path.
 */
export function spawnFieldBurst(
    name: string, host: SceneHost, config: ParticleSystemConfig, position: Vector3
): boolean {
    let entry = fields.get(config);
    if (entry === undefined || (entry !== null && entry.host !== host)) {
        if (entry) disposeEntry(entry);
        const recipe = makeBurstFieldRecipe(config);
        entry = recipe ? { host, name, recipe, chain: [] } : null;
        fields.set(config, entry);
    }
    if (!entry) return false;

    for (const field of entry.chain) {
        if (field.room < 1) continue;
        field.enqueue(position);
        return true;
    }
    if (entry.chain.length >= MAX_FIELDS_PER_RECIPE) return false;
    const field = new BurstField(entry.name, host, entry.recipe);
    entry.chain.push(field);
    field.enqueue(position);
    return true;
}

function disposeEntry(entry: FieldEntry): void {
    for (const field of entry.chain) field.dispose();
    entry.chain.length = 0;
}

/** Frees every merged field. Run teardown only - sibling of clearBurstPool(). */
export function clearBurstFields(): void {
    for (const entry of fields.values()) if (entry) disposeEntry(entry);
    fields.clear();
}

/** Live counts - lets specs and the resource census assert boundedness. */
export function burstFieldStats(): { recipes: number; fields: number; liveParticles: number } {
    let count = 0;
    let liveParticles = 0;
    for (const entry of fields.values()) {
        if (!entry) continue;
        count += entry.chain.length;
        for (const field of entry.chain) liveParticles += field.liveParticles;
    }
    return { recipes: fields.size, fields: count, liveParticles };
}
