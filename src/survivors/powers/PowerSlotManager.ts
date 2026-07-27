import { Vector3 } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { PowerDefinition, PowerRuntimeState, PowerContext, PowerElement } from './PowerDefinitions';
import { getAnyPowerDef, getFusionFor } from './FusionDefinitions';
import { Enemy } from '../enemies/Enemy';

export interface PowerSlot {
    def: PowerDefinition;
    state: PowerRuntimeState;
}

/** One equipped passive enchantment, as consumed by HeroBasicAttack per hit. */
export interface ActiveEnchantment {
    element: string;
    level: number;
    slot: PowerSlot;
}

export class PowerSlotManager {
    public static readonly MAX_SLOTS = 4;
    private slots: (PowerSlot | null)[] = [null, null, null, null];
    private scene: SceneHost;
    private heroProvider: () => Vector3;
    private enemyProvider: () => Enemy[];
    private damageMultiplierProvider: () => number;
    private cooldownMultiplierProvider: () => number;
    /** Fires whenever any power slot's cast() runs (after cooldown elapsed).
     *  Used to drive hero attack animations for special/power attacks. */
    private onCastCallback: ((slot: PowerSlot) => void) | null = null;
    /** Seconds between the cast animation starting and the power actually firing
     *  (the clip's visual release point). Default 0 = fire immediately, which
     *  keeps procedural champions and unit tests on the old same-frame behavior. */
    private castDelayProvider: () => number = () => 0;
    /** Casts waiting for their animation wind-up to reach the release point.
     *  `target` is the enemy the cast was committed to when the animation started
     *  — see PowerContext.committedTarget. */
    private pendingCasts: { slot: PowerSlot; timer: number; target: Enemy | null }[] = [];
    /** Most recently cast slot — target for the Echo item effect's free recast. */
    private lastCastSlot: PowerSlot | null = null;
    /** Derived views of `slots` rebuilt only when the loadout changes — both are
     *  read every frame (element visuals) or every hit (enchantments), so
     *  rebuilding them per read allocated a Set + an array + one record per
     *  passive on the hottest paths in the game. Callers treat them as read-only. */
    private readonly cachedElements = new Set<PowerElement>();
    private readonly cachedElementList: PowerElement[] = [];
    private readonly cachedEnchantments: ActiveEnchantment[] = [];
    private derivedDirty = true;
    /** Reused context for the per-frame `tick` hook ONLY. Tick implementations
     *  read it synchronously and never retain it. `cast` is the opposite — its
     *  projectile observers keep the context alive for the whole flight — so the
     *  cast path still builds its own (that path is cooldown-gated, not per-frame). */
    private readonly tickCtx: PowerContext;

    constructor(
        scene: SceneHost,
        heroProvider: () => Vector3,
        enemyProvider: () => Enemy[],
        damageMultiplierProvider: () => number = () => 1.0,
        cooldownMultiplierProvider: () => number = () => 1.0,
    ) {
        this.scene = scene;
        this.heroProvider = heroProvider;
        this.enemyProvider = enemyProvider;
        this.damageMultiplierProvider = damageMultiplierProvider;
        this.cooldownMultiplierProvider = cooldownMultiplierProvider;
        this.tickCtx = {
            scene,
            heroPosition: new Vector3(),
            enemies: [],
            damageMultiplier: 1,
            element: 'physical',
            range: 0,
        };
    }

    public getSlots(): (PowerSlot | null)[] {
        return this.slots;
    }

    public hasPower(id: string): boolean {
        return this.slots.some(s => s?.def.id === id);
    }

    public emptySlotIndex(): number {
        return this.slots.findIndex(s => s === null);
    }

    /** Add a power by id. Returns false if unknown, true on success (including level-up). */
    public addPower(defId: string): boolean {
        const def = getAnyPowerDef(defId);
        if (!def) return false;
        if (this.hasPower(defId)) return this.levelUp(defId);
        const idx = this.emptySlotIndex();
        if (idx < 0) return false; // caller must open replace prompt
        const slot: PowerSlot = {
            def,
            state: { level: 1, cooldownRemaining: def.baseCooldown },
        };
        this.slots[idx] = slot;
        this.derivedDirty = true;
        // Run init hook if present (Whirling Blades spawns its blade meshes here)
        if (def.init) {
            const ctx = this.buildContext(def.baseRange);
            def.init(slot.state, ctx);
        }
        return true;
    }

    public levelUp(defId: string): boolean {
        const slot = this.slots.find(s => s?.def.id === defId);
        if (!slot) return false;
        if (slot.state.level >= slot.def.maxLevel) return false;
        slot.state.level += 1;
        return true;
    }

    /** Slots whose power has reached its level cap. */
    public getMaxedSlots(): PowerSlot[] {
        return this.slots.filter(
            (s): s is PowerSlot => s !== null && s.state.level >= s.def.maxLevel,
        );
    }

    /**
     * Forge two equipped, level-capped powers into `resultDefId`.
     * Consumes both parents (disposing their persistent data), inserts the
     * result at level 1 into one of the freed slots, and runs its init.
     * Returns false if validation fails (defs missing, not both present & maxed).
     *
     * Callers are expected to obtain `resultDefId` from `fusionResultFor(idA, idB)`
     * (tier-2) or `getUltimatesForClass()` (tier-3). This method does NOT enforce
     * class/element compatibility between the parents and the result.
     */
    public fuse(idA: string, idB: string, resultDefId: string): boolean {
        if (idA === idB) return false;
        const idxA = this.slots.findIndex(s => s?.def.id === idA);
        const idxB = this.slots.findIndex(s => s?.def.id === idB);
        if (idxA < 0 || idxB < 0 || idxA === idxB) return false;
        const slotA = this.slots[idxA]!;
        const slotB = this.slots[idxB]!;
        if (slotA.state.level < slotA.def.maxLevel) return false;
        if (slotB.state.level < slotB.def.maxLevel) return false;
        const resultDef = getAnyPowerDef(resultDefId);
        if (!resultDef) return false;

        this.disposeSlotData(slotA);
        this.disposeSlotData(slotB);
        this.slots[idxB] = null;

        const slot: PowerSlot = {
            def: resultDef,
            state: { level: 1, cooldownRemaining: resultDef.baseCooldown },
        };
        this.slots[idxA] = slot;
        this.derivedDirty = true;
        if (resultDef.init) {
            const ctx = this.buildContext(resultDef.baseRange);
            resultDef.init(slot.state, ctx);
        }
        return true;
    }

    /** Convenience: the tier-2 fusion def for two equipped base power ids, or null. */
    public fusionResultFor(idA: string, idB: string): PowerDefinition | null {
        return getFusionFor(idA, idB);
    }

    public replaceSlot(index: number, defId: string): boolean {
        const def = getAnyPowerDef(defId);
        if (!def || index < 0 || index >= this.slots.length) return false;
        // Dispose any persistent slot resources (meshes etc.) via the def hook
        this.disposeSlotData(this.slots[index]);
        const slot: PowerSlot = {
            def,
            state: { level: 1, cooldownRemaining: def.baseCooldown },
        };
        this.slots[index] = slot;
        this.derivedDirty = true;
        if (def.init) {
            const ctx = this.buildContext(def.baseRange);
            def.init(slot.state, ctx);
        }
        return true;
    }

    /** DEV/TEST ONLY (?test fusion cycler): replace all 4 slots with `def` at max
     *  level, disposing prior slot data and running init per slot. */
    public debugEquipAllMaxed(def: PowerDefinition): void {
        for (let i = 0; i < this.slots.length; i++) {
            this.disposeSlotData(this.slots[i]);
            const slot: PowerSlot = { def, state: { level: def.maxLevel, cooldownRemaining: 0 } };
            this.slots[i] = slot;
            if (def.init) def.init(slot.state, this.buildContext(def.baseRange));
        }
        this.derivedDirty = true;
    }

    /** DEV/TEST: fill slots 0..N with DIFFERENT defs (each maxed), disposing prior
     *  slot data + running init. Used by the ?test stress button to fire several
     *  distinct effect types at once. */
    public debugEquipManyMaxed(defs: PowerDefinition[]): void {
        if (defs.length === 0) return;
        for (let i = 0; i < this.slots.length; i++) {
            const def = defs[i % defs.length];
            this.disposeSlotData(this.slots[i]);
            const slot: PowerSlot = { def, state: { level: def.maxLevel, cooldownRemaining: 0 } };
            this.slots[i] = slot;
            if (def.init) def.init(slot.state, this.buildContext(def.baseRange));
        }
        this.derivedDirty = true;
    }

    /** Register a callback fired every time a power-slot's cast() executes. */
    public setOnCast(fn: (slot: PowerSlot) => void): void {
        this.onCastCallback = fn;
    }

    /** Wire the animation wind-up: when a slot fires, the cast animation starts
     *  immediately but the actual cast() is deferred by the provided seconds so
     *  the projectile leaves the hand on the clip's release pose. */
    public setCastDelayProvider(fn: () => number): void {
        this.castDelayProvider = fn;
    }

    /** Nearest live enemy to the hero and its squared distance (`null`/Infinity
     *  when the arena is empty). Computed at most once per frame and compared
     *  against each ready slot's own reach — one O(n) scan, not one per slot.
     *
     *  The ENEMY, not just the distance: whichever slot fires this frame commits
     *  to it (PowerContext.committedTarget), which is what keeps the cast that
     *  lands after the animation wind-up from re-deriving a different answer. */
    private nearestEnemy(): { enemy: Enemy | null; dist2: number } {
        const heroPos = this.heroProvider();
        const hx = heroPos.x, hz = heroPos.z;
        let best: Enemy | null = null;
        let bestD2 = Infinity;
        const list = this.enemyProvider();
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (!e.alive) continue;
            const p = e.position;
            const dx = p.x - hx;
            const dz = p.z - hz;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; best = e; }
        }
        return { enemy: best, dist2: bestD2 };
    }

    public update(deltaTime: number): void {
        const cooldownMult = this.cooldownMultiplierProvider();
        // Fire any casts whose animation wind-up reached the release point. The
        // context is built fresh here so the projectile spawns from the hero's
        // CURRENT position, not where it stood when the wind-up started.
        if (this.pendingCasts.length > 0) {
            for (let i = this.pendingCasts.length - 1; i >= 0; i--) {
                const pending = this.pendingCasts[i];
                pending.timer -= deltaTime;
                if (pending.timer > 0) continue;
                this.pendingCasts.splice(i, 1);
                // The slot may have been replaced/fused mid-wind-up — skip if gone.
                if (!this.slots.includes(pending.slot) || !pending.slot.def.cast) continue;
                const castCtx = this.buildContext(pending.slot.def.baseRange);
                castCtx.element = pending.slot.def.element;
                // Honour the target the animation was started for. It may well be
                // out of range by now — the hero has been moving for the whole
                // wind-up — and re-deriving it here is exactly how the champion
                // ends up miming a shot it already committed to. A target that
                // DIED mid-wind-up releases the commitment (null → the cast falls
                // back to its own scan).
                castCtx.committedTarget = pending.target?.alive ? pending.target : null;
                pending.slot.def.cast(pending.slot.state, castCtx);
                this.lastCastSlot = pending.slot;
            }
        }
        // Cooldowns are measured in seconds, so on the vast majority of frames no
        // slot reaches ready. Defer the O(n) target scan and the context object
        // allocation until a slot is actually ready to fire — when nothing fires
        // this loop does no allocation and no enemy scan at all.
        let nearest: { enemy: Enemy | null; dist2: number } | null = null; // lazily, once per frame
        for (const slot of this.slots) {
            if (!slot) continue;
            // Persistent per-frame powers (e.g. Whirling Blades) update every frame —
            // independent of cooldown or whether an enemy is in range — and never
            // trigger the hero attack animation. The tick context is reused (see
            // tickCtx); the cast context below is not, and must stay that way.
            if (slot.def.tick) {
                const tctx = this.tickContext(slot.def.baseRange);
                tctx.element = slot.def.element;
                slot.def.tick(slot.state, tctx, deltaTime);
            }
            // Skip passive enchantments — they have no cast loop
            if (slot.def.mode === 'passive') continue;
            slot.state.cooldownRemaining -= deltaTime;
            if (slot.state.cooldownRemaining <= 0) {
                // Resolve the nearest enemy once per frame, lazily, then gate each
                // ready slot on ITS OWN reach. A single generous radius shared by
                // every slot made the hero play the cast animation at enemies the
                // power could not reach — the cast() then found nothing in range
                // and silently dropped, so the champion mimed shots into space.
                //
                // The reach is the slot's declared range EXACTLY — no slack. Slack
                // is what the commitment below is for: an enemy one frame outside
                // reach simply holds the (already-ready) cooldown and fires the
                // frame it steps inside, whereas a gate wider than the cast's own
                // scan is a mimed shot every time the target never closes.
                nearest ??= this.nearestEnemy();
                const reach = slot.def.baseRange;
                if (nearest.dist2 > reach * reach) continue; // hold the cooldown, stay idle
                if (slot.def.cast) {
                    const delay = this.castDelayProvider();
                    if (delay > 0) {
                        // Animation starts now (callback below); the actual cast fires
                        // at the clip's release point — against THIS target, not
                        // whatever is nearest once the wind-up ends.
                        this.pendingCasts.push({ slot, timer: delay, target: nearest.enemy });
                    } else {
                        // ONE CONTEXT PER CAST — never shared between slots. A
                        // cast's projectile observer holds this object for the
                        // whole flight and reads ctx.element off it every frame,
                        // so a second slot firing in the same tick used to
                        // repaint the first one's damage numbers and impact FX
                        // with ITS element. buildContext() is reached only when a
                        // slot actually fires, so an idle frame still allocates
                        // nothing (that is what the lazy build was really for).
                        const castCtx = this.buildContext(reach);
                        castCtx.element = slot.def.element;
                        castCtx.committedTarget = nearest.enemy;
                        slot.def.cast(slot.state, castCtx);
                        this.lastCastSlot = slot;
                    }
                    // Only a real cast drives the special-attack animation — a slot with
                    // no cast() (a pure tick power) must not retrigger it every cooldown.
                    if (this.onCastCallback) this.onCastCallback(slot);
                }
                slot.state.cooldownRemaining = slot.def.cooldownFor(slot.state) * cooldownMult;
            }
        }
    }

    /**
     * Force-fire every currently equipped autocast slot once, ignoring cooldowns.
     * Slot cooldowns are intentionally left untouched so regular autocast resumes
     * exactly where it was after the burst. Returns the number of slots that fired.
     */
    public forceCastAutocastSlots(): number {
        let count = 0;
        for (const slot of this.slots) {
            if (!slot) continue;
            if (slot.def.mode !== 'autocast') continue;
            if (!slot.def.cast) continue;
            // One context per cast, same contract as update(): this burst fires
            // several slots back to back, so a shared object would hand every
            // projectile in flight the LAST slot's element.
            const castCtx = this.buildContext(slot.def.baseRange);
            castCtx.element = slot.def.element;
            slot.def.cast(slot.state, castCtx);
            this.lastCastSlot = slot;
            count++;
        }
        return count;
    }

    /** Echo item effect: recast the most recently cast power for free — fresh
     *  context, no cooldown reset, and deliberately NO onCast notification
     *  (free recasts must not re-trigger cast-driven hooks like Echo itself). */
    public recastFree(): boolean {
        const slot = this.lastCastSlot;
        if (!slot || !this.slots.includes(slot) || !slot.def.cast) return false;
        const ctx = this.buildContext(slot.def.baseRange);
        ctx.element = slot.def.element;
        slot.def.cast(slot.state, ctx);
        return true;
    }

    /**
     * Cast ONE slot for free (The Second Voice). Sibling of recastFree, but
     * targets a specific slot and picks the least-recently-cast one when the
     * caller passes -1. Touches neither cooldownRemaining nor onCastCallback:
     * a free cast must not feed the Resonance loop it was triggered by.
     */
    public castSlotFree(index: number): boolean {
        let slot = index >= 0 ? this.slots[index] : null;
        if (!slot) {
            // Least-recently-cast: anything that is not the slot we just fired.
            for (const s2 of this.slots) {
                if (s2 && s2 !== this.lastCastSlot && s2.def.cast) { slot = s2; break; }
            }
        }
        if (!slot || !slot.def.cast) return false;
        // ONE fresh context per cast — the documented rule for this manager.
        const ctx = this.buildContext(slot.def.baseRange);
        ctx.element = slot.def.element;
        slot.def.cast(slot.state, ctx);
        return true;
    }

    /** Rebuild the derived loadout views if a slot changed since the last read. */
    private refreshDerived(): void {
        if (!this.derivedDirty) return;
        this.derivedDirty = false;
        this.cachedElements.clear();
        this.cachedElementList.length = 0;
        this.cachedEnchantments.length = 0;
        for (const slot of this.slots) {
            if (!slot) continue;
            if (!this.cachedElements.has(slot.def.element)) {
                this.cachedElements.add(slot.def.element);
                this.cachedElementList.push(slot.def.element);
            }
            if (slot.def.mode === 'passive') {
                this.cachedEnchantments.push({
                    element: slot.def.element, level: slot.state.level, slot,
                });
            }
        }
    }

    /**
     * The set of unique elements from all currently equipped power slots.
     * Used to drive per-element weapon visual decorations on the Champion.
     * Read every frame — returns the CACHED set; callers must not mutate it.
     */
    public getActiveElements(): Set<PowerElement> {
        this.refreshDerived();
        return this.cachedElements;
    }

    /** The same elements as an array, for the colour-blend call sites (per swing
     *  and per projectile). CACHED — callers must not mutate it. */
    public getActiveElementList(): PowerElement[] {
        this.refreshDerived();
        return this.cachedElementList;
    }

    /**
     * All passive (enchantment) slots with their element and level.
     * Used by HeroBasicAttack to apply enchantments on every melee/projectile hit
     * (i.e. per enemy per frame during Whirlwind) — returns the CACHED array;
     * callers must not mutate it. `level` is refreshed on every read because a
     * level-up does not go through a slot write.
     */
    public getActiveEnchantments(): ActiveEnchantment[] {
        this.refreshDerived();
        for (let i = 0; i < this.cachedEnchantments.length; i++) {
            const e = this.cachedEnchantments[i];
            e.level = e.slot.state.level;
        }
        return this.cachedEnchantments;
    }

    /**
     * Total range bonus from passive enchantments that extend melee swing radius.
     * (Heavy Strike contributes +0.3 per level.)
     */
    public getMeleeRangeBonus(): number {
        let bonus = 0;
        for (const slot of this.slots) {
            if (!slot) continue;
            if (slot.def.mode === 'passive' && slot.def.rangeBonus) {
                bonus += slot.def.rangeBonus(slot.state.level);
            }
        }
        return bonus;
    }

    /** Dispose all persistent slot data via each slot's def.dispose hook. */
    public dispose(): void {
        this.pendingCasts.length = 0;
        this.lastCastSlot = null;
        for (const slot of this.slots) {
            this.disposeSlotData(slot);
        }
        this.slots = [null, null, null, null];
        this.derivedDirty = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    /** A FRESH context, and it must stay one PER CALL. cast()/init() hand this
     *  object to projectile observers that keep reading ctx.scene/ctx.element
     *  long after the call returns, so two casts may never share one. Only the
     *  per-frame tick path reuses a context (tickContext).
     *
     *  `range` is the firing reach of the slot the context is being built for —
     *  the same number the cast gate tests, which is the whole point of carrying
     *  it on the context at all (see PowerContext.range). */
    private buildContext(range: number): PowerContext {
        return {
            scene: this.scene,
            heroPosition: this.heroProvider(),
            enemies: this.enemyProvider(),
            damageMultiplier: this.damageMultiplierProvider(),
            element: 'physical',
            range,
        };
    }

    /** The shared per-frame context for tick() hooks, refreshed in place. */
    private tickContext(range: number): PowerContext {
        const c = this.tickCtx;
        c.heroPosition = this.heroProvider();
        c.enemies = this.enemyProvider();
        c.damageMultiplier = this.damageMultiplierProvider();
        c.range = range;
        return c;
    }

    private disposeSlotData(slot: PowerSlot | null): void {
        if (!slot) return;
        try { slot.def.dispose?.(slot.state); } catch { /* ignore */ }
    }
}
