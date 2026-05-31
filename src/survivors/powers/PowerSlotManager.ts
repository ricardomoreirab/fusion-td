import { Scene, Vector3 } from '@babylonjs/core';
import { PowerDefinition, PowerRuntimeState, PowerContext, PowerElement } from './PowerDefinitions';
import { getAnyPowerDef, getFusionFor } from './FusionDefinitions';
import { Enemy } from '../enemies/Enemy';

export interface PowerSlot {
    def: PowerDefinition;
    state: PowerRuntimeState;
}

export class PowerSlotManager {
    public static readonly MAX_SLOTS = 4;
    private slots: (PowerSlot | null)[] = [null, null, null, null];
    private scene: Scene;
    private heroProvider: () => Vector3;
    private enemyProvider: () => Enemy[];
    private damageMultiplierProvider: () => number;
    private cooldownMultiplierProvider: () => number;
    /** Fires whenever any power slot's cast() runs (after cooldown elapsed).
     *  Used to drive hero attack animations for special/power attacks. */
    private onCastCallback: ((slot: PowerSlot) => void) | null = null;

    constructor(
        scene: Scene,
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
        // Run init hook if present (Whirling Blades spawns its blade meshes here)
        if (def.init) {
            const ctx = this.buildContext();
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
        if (resultDef.init) {
            const ctx = this.buildContext();
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
        if (def.init) {
            const ctx = this.buildContext();
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
            if (def.init) def.init(slot.state, this.buildContext());
        }
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
            if (def.init) def.init(slot.state, this.buildContext());
        }
    }

    /** Register a callback fired every time a power-slot's cast() executes. */
    public setOnCast(fn: (slot: PowerSlot) => void): void {
        this.onCastCallback = fn;
    }

    /** Generous "is any enemy near enough for a power to matter" radius. Powers all
     *  have different ranges (some global, some AOE around hero) — using one big
     *  number avoids per-power range bookkeeping and just answers the question
     *  "is there anything worth shooting at right now?". */
    private static readonly ANY_TARGET_RADIUS = 20;

    private hasAnyTargetInRange(): boolean {
        const heroPos = this.heroProvider();
        const r = PowerSlotManager.ANY_TARGET_RADIUS;
        const rSq = r * r;
        for (const e of this.enemyProvider()) {
            if (!e.isAlive()) continue;
            const ePos = e.getPosition();
            const dx = ePos.x - heroPos.x;
            const dz = ePos.z - heroPos.z;
            if (dx * dx + dz * dz <= rSq) return true;
        }
        return false;
    }

    public update(deltaTime: number): void {
        const cooldownMult = this.cooldownMultiplierProvider();
        // Cooldowns are measured in seconds, so on the vast majority of frames no
        // slot reaches ready. Defer the O(n) target scan and the context object
        // allocation until a slot is actually ready to fire — when nothing fires
        // this loop does no allocation and no enemy scan at all.
        let ctx: PowerContext | null = null;
        let hasTarget = false;
        let targetChecked = false;
        for (const slot of this.slots) {
            if (!slot) continue;
            // Skip passive enchantments — they have no cast loop
            if (slot.def.mode === 'passive') continue;
            slot.state.cooldownRemaining -= deltaTime;
            if (slot.state.cooldownRemaining <= 0) {
                // Resolve "anything to shoot at?" once per frame, lazily.
                if (!targetChecked) {
                    hasTarget = this.hasAnyTargetInRange();
                    targetChecked = true;
                }
                if (!hasTarget) continue; // hold the cooldown, don't fire into empty arena
                if (slot.def.cast) {
                    if (!ctx) ctx = this.buildContext();
                    ctx.element = slot.def.element;
                    slot.def.cast(slot.state, ctx);
                }
                if (this.onCastCallback) this.onCastCallback(slot);
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
        const ctx = this.buildContext();
        let count = 0;
        for (const slot of this.slots) {
            if (!slot) continue;
            if (slot.def.mode !== 'autocast') continue;
            if (!slot.def.cast) continue;
            ctx.element = slot.def.element;
            slot.def.cast(slot.state, ctx);
            count++;
        }
        return count;
    }

    /**
     * Returns the set of unique elements from all currently equipped power slots.
     * Used to drive per-element weapon visual decorations on the Champion.
     */
    public getActiveElements(): Set<PowerElement> {
        const set = new Set<PowerElement>();
        for (const slot of this.slots) {
            if (slot) set.add(slot.def.element);
        }
        return set;
    }

    /**
     * Returns all passive (enchantment) slots with their element and level.
     * Used by HeroBasicAttack to apply enchantments on every melee/projectile hit.
     */
    public getActiveEnchantments(): { element: string; level: number; slot: PowerSlot }[] {
        const result: { element: string; level: number; slot: PowerSlot }[] = [];
        for (const slot of this.slots) {
            if (!slot) continue;
            if (slot.def.mode === 'passive') {
                result.push({ element: slot.def.element, level: slot.state.level, slot });
            }
        }
        return result;
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
        for (const slot of this.slots) {
            this.disposeSlotData(slot);
        }
        this.slots = [null, null, null, null];
    }

    // ─────────────────────────────────────────────────────────────────────────
    private buildContext(): PowerContext {
        return {
            scene: this.scene,
            heroPosition: this.heroProvider(),
            enemies: this.enemyProvider(),
            damageMultiplier: this.damageMultiplierProvider(),
            element: 'physical',
        };
    }

    private disposeSlotData(slot: PowerSlot | null): void {
        if (!slot) return;
        try { slot.def.dispose?.(slot.state); } catch { /* ignore */ }
    }
}
