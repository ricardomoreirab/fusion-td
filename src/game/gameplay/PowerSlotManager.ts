import { Scene, Vector3 } from '@babylonjs/core';
import { PowerDefinition, PowerRuntimeState, PowerContext, POWER_DEFS } from './powers/PowerDefinitions';
import { Enemy } from './enemies/Enemy';

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
        const def = POWER_DEFS[defId];
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

    public replaceSlot(index: number, defId: string): boolean {
        const def = POWER_DEFS[defId];
        if (!def || index < 0 || index >= this.slots.length) return false;
        // Dispose blade meshes from the replaced slot if any
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

    public update(deltaTime: number): void {
        const ctx = this.buildContext();
        const cooldownMult = this.cooldownMultiplierProvider();
        for (const slot of this.slots) {
            if (!slot) continue;
            // Skip passive enchantments — they have no cast loop
            if (slot.def.mode === 'passive') continue;
            slot.state.cooldownRemaining -= deltaTime;
            if (slot.state.cooldownRemaining <= 0) {
                if (slot.def.cast) {
                    slot.def.cast(slot.state, ctx);
                }
                slot.state.cooldownRemaining = slot.def.cooldownFor(slot.state) * cooldownMult;
            }
        }
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

    /** Dispose all persistent slot data (blade meshes etc.) */
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
        };
    }

    private disposeSlotData(slot: PowerSlot | null): void {
        if (!slot?.state?.data) return;
        const blades = slot.state.data['blades'] as { mesh: { dispose: () => void } }[] | undefined;
        if (blades) {
            for (const b of blades) {
                try { b.mesh.dispose(); } catch { /* ignore */ }
            }
        }
    }
}
