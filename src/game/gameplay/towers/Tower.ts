import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Scene, ParticleSystem, Texture, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { TowerDefinition, getTowerDefinition, getUpgradeOptions } from './TowerDefinitions';
import { TowerVisualBuilder } from './TowerVisualBuilder';
import { TowerAbilitySystem, AbilityState } from './abilities/TowerAbilitySystem';
import { getAncestryChain, getSellValue as calcSellValue, isValidUpgrade } from './UpgradeTree';

// Define element types
export enum ElementType {
    NONE = 'none',
    FIRE = 'fire',
    WATER = 'water',
    WIND = 'wind',
    EARTH = 'earth'
}

// Define enemy types for targeting priorities
export enum EnemyType {
    NORMAL = 'normal',
    FIRE = 'fire',
    WATER = 'water',
    WIND = 'wind',
    EARTH = 'earth',
    ICE = 'ice',
    PLANT = 'plant',
    FLYING = 'flying',
    HEAVY = 'heavy',
    LIGHT = 'light',
    ELECTRIC = 'electric'
}

// Targeting mode for tower priority
export enum TargetingMode {
    CLOSEST = 'closest',
    FIRST = 'first',       // Furthest along path
    STRONGEST = 'strongest' // Highest current HP
}

// Define status effects
export enum StatusEffect {
    NONE = 'none',
    BURNING = 'burning',
    SLOWED = 'slowed',
    FROZEN = 'frozen',
    STUNNED = 'stunned',
    PUSHED = 'pushed',
    CONFUSED = 'confused'
}

/**
 * Data-driven tower class. Instead of subclassing, towers are configured
 * via TowerDefinition data and can evolve in-place to new definitions.
 */
export class Tower {
    protected game: Game;
    protected scene: Scene;
    protected position: Vector3;
    protected mesh: Mesh | null = null;
    protected range: number = 0;
    protected damage: number = 0;
    protected fireRate: number = 0;
    protected cost: number = 0;
    protected level: number = 1;
    protected maxLevel: number = 1;
    protected sellValue: number = 0;
    protected lastFireTime: number = 0;
    protected targetEnemy: Enemy | null = null;
    protected rangeIndicator: Mesh | null = null;
    protected showingRange: boolean = false;
    protected isInitialized: boolean = false;
    protected isSelected: boolean = false;
    protected selectionIndicator: Mesh | null = null;
    protected towerId: string;
    protected targetingMode: TargetingMode = TargetingMode.CLOSEST;

    // Data-driven properties
    protected definitionId: string;
    protected tier: number = 1;
    protected treeType: 'medieval' | 'elemental' = 'medieval';

    // Elemental properties
    protected elementType: ElementType = ElementType.NONE;
    protected projectileColor: Color3 = new Color3(0.8, 0.8, 0.8);

    // Status effect from definition
    protected statusEffectConfig: { effect: StatusEffect; duration: number; strength: number; chance: number } | null = null;

    // Status effect tracking
    protected appliedStatusEffects: Map<Enemy, { effect: StatusEffect, endTime: number, strength: number }> = new Map();

    // Ability system
    protected abilityState: AbilityState | null = null;
    protected static abilitySystem: TowerAbilitySystem | null = null;
    protected static visualBuilder: TowerVisualBuilder | null = null;

    // Aura buff cache (from nearby commander towers)
    protected auraDamageBonus: number = 0;
    protected auraFireRateBonus: number = 0;
    protected auraRangeBonus: number = 0;

    constructor(game: Game, position: Vector3, definitionId: string) {
        this.game = game;
        this.scene = game.getScene();
        this.position = position;
        this.towerId = `tower_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        this.definitionId = definitionId;

        // Initialize static systems if needed
        if (!Tower.abilitySystem) {
            Tower.abilitySystem = new TowerAbilitySystem(game);
        }
        if (!Tower.visualBuilder) {
            Tower.visualBuilder = new TowerVisualBuilder(this.scene);
        }

        const def = getTowerDefinition(definitionId);
        if (!def) {
            throw new Error(`Unknown tower definition: ${definitionId}`);
        }

        // Apply definition stats
        this.applyDefinition(def);

        // Build visual mesh
        this.mesh = Tower.visualBuilder.build(def.visual, position, this.towerId);

        // Add a small delay before the tower can target and fire
        setTimeout(() => {
            this.isInitialized = true;
        }, 500);
    }

    /**
     * Apply a tower definition's stats and properties to this tower.
     */
    protected applyDefinition(def: TowerDefinition): void {
        this.definitionId = def.id;
        this.range = def.stats.range;
        this.damage = def.stats.damage;
        this.fireRate = def.stats.fireRate;
        this.cost = def.stats.cost;
        this.tier = def.tier;
        this.treeType = def.tree;
        this.level = def.tier; // tier acts as level
        this.projectileColor = new Color3(def.projectileColor[0], def.projectileColor[1], def.projectileColor[2]);

        // Map tree type to element type for projectile colors
        if (def.tree === 'elemental') {
            if (def.category.includes('fire') || def.category.includes('inferno') || def.category.includes('ember')) {
                this.elementType = ElementType.FIRE;
            } else if (def.category.includes('ice') || def.category.includes('frost') || def.category.includes('glacier') || def.category.includes('tidal')) {
                this.elementType = ElementType.WATER;
            } else if (def.category.includes('storm') || def.category.includes('lightning') || def.category.includes('plasma')) {
                this.elementType = ElementType.FIRE; // lightning uses fire-orange visuals
            } else if (def.category.includes('nature') || def.category.includes('thorn') || def.category.includes('shadow')) {
                this.elementType = ElementType.EARTH;
            } else {
                this.elementType = ElementType.NONE;
            }
        } else {
            this.elementType = ElementType.NONE;
        }

        // Status effect config
        if (def.statusEffect) {
            this.statusEffectConfig = { ...def.statusEffect };
        } else {
            this.statusEffectConfig = null;
        }

        // Sell value = 60% of total investment across all tiers
        this.updateSellValue();

        // Initialize ability
        if (def.ability && Tower.abilitySystem) {
            this.abilityState = Tower.abilitySystem.createState(def.ability);
        }
    }

    /**
     * Evolve this tower to a new definition (upgrade path).
     * Validates the upgrade is legal, rebuilds mesh, updates stats.
     */
    public evolve(targetId: string): boolean {
        if (!isValidUpgrade(this.definitionId, targetId)) {
            console.error(`Invalid upgrade: ${this.definitionId} -> ${targetId}`);
            return false;
        }

        const targetDef = getTowerDefinition(targetId);
        if (!targetDef) {
            console.error(`Unknown target definition: ${targetId}`);
            return false;
        }

        // Dispose current mesh
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }

        // Hide range/selection during rebuild
        this.hideRangeIndicator();
        this.removeSelectionIndicator();

        // Apply new definition
        this.applyDefinition(targetDef);

        // Build new mesh
        if (Tower.visualBuilder) {
            this.mesh = Tower.visualBuilder.build(targetDef.visual, this.position, this.towerId);
        }

        // Re-show selection if was selected
        if (this.isSelected) {
            this.showRangeIndicator();
            this.createSelectionIndicator();
        }

        return true;
    }

    /**
     * Get the tower definition ID.
     */
    public getDefinitionId(): string {
        return this.definitionId;
    }

    /**
     * Get the tower's tier (1-8).
     */
    public getTier(): number {
        return this.tier;
    }

    /**
     * Get available upgrade paths for this tower.
     */
    public getUpgradeOptions(): TowerDefinition[] {
        return getUpgradeOptions(this.definitionId);
    }

    /**
     * Update the tower each frame.
     */
    public update(deltaTime: number): void {
        // Update status effects
        this.updateStatusEffects();

        // Find a target if we don't have one or if current target is dead
        if (!this.targetEnemy || !this.targetEnemy.isAlive()) {
            this.targetEnemy = null;
        }

        // If we have a target, check if it's still in range
        if (this.targetEnemy) {
            const effectiveRange = this.range + this.auraRangeBonus;
            const distance = Vector3.Distance(this.position, this.targetEnemy.getPosition());
            if (distance > effectiveRange) {
                this.targetEnemy = null;
            }
        }

        // If we have a target, try to fire
        if (this.targetEnemy && this.targetEnemy.isAlive()) {
            const currentTime = performance.now();
            const effectiveFireRate = this.fireRate + this.auraFireRateBonus;
            const timeSinceLastFire = (currentTime - this.lastFireTime) / 1000;

            if (timeSinceLastFire >= 1 / effectiveFireRate) {
                this.fire();
                this.lastFireTime = currentTime;
            }

            this.rotateTowerToTarget();
        }

        // Process auto abilities
        if (this.abilityState && Tower.abilitySystem && this.abilityState.definition.type === 'active_auto') {
            // We need access to enemies for auto abilities - this will be called from TowerManager
        }
    }

    /**
     * Process auto abilities with enemy list (called from TowerManager).
     */
    public processAutoAbilities(allEnemies: Enemy[]): void {
        if (this.abilityState && Tower.abilitySystem) {
            Tower.abilitySystem.processAutoAbility(
                this.abilityState,
                this.position,
                this.range + this.auraRangeBonus,
                allEnemies
            );
        }
    }

    /**
     * Fire at the current target.
     */
    protected fire(): void {
        if (!this.targetEnemy || !this.isInitialized) return;

        let finalDamage = this.damage + this.auraDamageBonus;
        const targetPosition = this.targetEnemy.getPosition().clone();

        // Process ability on fire
        let extraTargets: Enemy[] | undefined;
        if (this.abilityState && Tower.abilitySystem) {
            // We pass an empty array for allEnemies here; TowerManager fills it via processAutoAbilities
            const result = Tower.abilitySystem.onFire(
                this.abilityState,
                finalDamage,
                this.targetEnemy,
                this.position,
                [], // allEnemies filled by TowerManager for AoE
                0
            );
            finalDamage = result.damage;
            extraTargets = result.extraTargets;
        }

        // Deal damage to the target
        this.targetEnemy.takeDamage(finalDamage);

        // Emit damage event for floating numbers
        const damageEvent = new CustomEvent('towerDamage', {
            detail: {
                position: targetPosition,
                damage: finalDamage,
                elementType: this.elementType
            }
        });
        document.dispatchEvent(damageEvent);

        // Apply status effect if configured
        if (this.statusEffectConfig && Math.random() < this.statusEffectConfig.chance) {
            this.applyStatusEffect(
                this.targetEnemy,
                this.statusEffectConfig.effect,
                this.statusEffectConfig.duration,
                this.statusEffectConfig.strength
            );
        }

        // Damage extra targets from abilities
        if (extraTargets) {
            for (const extra of extraTargets) {
                if (extra.isAlive()) {
                    const extraDmg = finalDamage * 0.7; // Extra targets take 70%
                    extra.takeDamage(extraDmg);
                    const extraEvent = new CustomEvent('towerDamage', {
                        detail: {
                            position: extra.getPosition().clone(),
                            damage: extraDmg,
                            elementType: this.elementType
                        }
                    });
                    document.dispatchEvent(extraEvent);
                }
            }
        }

        // Create projectile effect
        this.createProjectileEffect(targetPosition);

        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }

    /**
     * Fire with access to all enemies (for ability targeting).
     */
    public fireWithEnemies(allEnemies: Enemy[]): void {
        if (!this.targetEnemy || !this.isInitialized) return;

        let finalDamage = this.damage + this.auraDamageBonus;
        const targetPosition = this.targetEnemy.getPosition().clone();

        let extraTargets: Enemy[] | undefined;
        if (this.abilityState && Tower.abilitySystem) {
            const result = Tower.abilitySystem.onFire(
                this.abilityState,
                finalDamage,
                this.targetEnemy,
                this.position,
                allEnemies,
                0
            );
            finalDamage = result.damage;
            extraTargets = result.extraTargets;
        }

        this.targetEnemy.takeDamage(finalDamage);

        const damageEvent = new CustomEvent('towerDamage', {
            detail: { position: targetPosition, damage: finalDamage, elementType: this.elementType }
        });
        document.dispatchEvent(damageEvent);

        if (this.statusEffectConfig && Math.random() < this.statusEffectConfig.chance) {
            this.applyStatusEffect(
                this.targetEnemy,
                this.statusEffectConfig.effect,
                this.statusEffectConfig.duration,
                this.statusEffectConfig.strength
            );
        }

        if (extraTargets) {
            for (const extra of extraTargets) {
                if (extra.isAlive()) {
                    const extraDmg = finalDamage * 0.7;
                    extra.takeDamage(extraDmg);
                    const extraEvent = new CustomEvent('towerDamage', {
                        detail: { position: extra.getPosition().clone(), damage: extraDmg, elementType: this.elementType }
                    });
                    document.dispatchEvent(extraEvent);
                }
            }
        }

        this.createProjectileEffect(targetPosition);
        this.game.getAssetManager().playSound('towerShoot');
    }

    protected updateStatusEffects(): void {
        const currentTime = performance.now();
        const expiredEffects: Enemy[] = [];

        this.appliedStatusEffects.forEach((effectData, enemy) => {
            if (currentTime > effectData.endTime || !enemy.isAlive()) {
                expiredEffects.push(enemy);
            }
        });

        for (const enemy of expiredEffects) {
            this.appliedStatusEffects.delete(enemy);
        }
    }

    public setTarget(enemy: Enemy | null): void {
        if (this.isInitialized) {
            this.targetEnemy = enemy;
        }
    }

    protected applyStatusEffect(enemy: Enemy, effect: StatusEffect, duration: number, strength: number): void {
        const endTime = performance.now() + (duration * 1000);
        this.appliedStatusEffects.set(enemy, { effect, endTime, strength });
        enemy.applyStatusEffect(effect, duration, strength);
    }

    protected createProjectileEffect(targetPosition: Vector3): void {
        if (!this.mesh) return;

        const direction = targetPosition.subtract(this.position);
        const distance = direction.length();
        direction.normalize();

        const projectileMesh = MeshBuilder.CreateIcoSphere('projectile', {
            radius: 0.15,
            subdivisions: 0
        }, this.scene);
        makeFlatShaded(projectileMesh);

        const startPosition = new Vector3(
            this.position.x,
            this.position.y + 1.5,
            this.position.z
        );
        projectileMesh.position = startPosition;

        const projectileMaterial = createEmissiveMaterial('projectileMat', this.projectileColor, 0.6, this.scene);
        projectileMesh.material = projectileMaterial;

        const animationSpeed = 15;
        const travelTime = distance / animationSpeed;
        const frameRate = 30;

        const projectileAnimation = new Animation(
            'projectileAnimation', 'position', frameRate,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        projectileAnimation.setKeys([
            { frame: 0, value: startPosition },
            { frame: frameRate * travelTime, value: targetPosition }
        ]);
        projectileMesh.animations = [projectileAnimation];

        this.scene.beginAnimation(projectileMesh, 0, frameRate * travelTime, false, 1, () => {
            this.createImpactEffect(targetPosition);
            projectileMesh.dispose();
            projectileMaterial.dispose();
        });
    }

    protected createImpactEffect(position: Vector3): void {
        const impactSystem = new ParticleSystem('impactParticles', 15, this.scene);
        impactSystem.emitter = position;
        impactSystem.minEmitBox = new Vector3(-0.1, 0, -0.1);
        impactSystem.maxEmitBox = new Vector3(0.1, 0, 0.1);

        const r = this.projectileColor.r;
        const g = this.projectileColor.g;
        const b = this.projectileColor.b;
        impactSystem.color1 = new Color4(r, g, b, 1.0);
        impactSystem.color2 = new Color4(r * 0.7, g * 0.7, b * 0.7, 1.0);
        impactSystem.colorDead = new Color4(r * 0.3, g * 0.3, b * 0.3, 0.0);

        impactSystem.minSize = 0.2;
        impactSystem.maxSize = 0.5;
        impactSystem.minLifeTime = 0.15;
        impactSystem.maxLifeTime = 0.35;
        impactSystem.emitRate = 80;
        impactSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        impactSystem.direction1 = new Vector3(-1, -1, -1);
        impactSystem.direction2 = new Vector3(1, 1, 1);
        impactSystem.minEmitPower = 1;
        impactSystem.maxEmitPower = 2.5;
        impactSystem.updateSpeed = 0.01;
        impactSystem.start();

        setTimeout(() => {
            impactSystem.stop();
            setTimeout(() => impactSystem.dispose(), 400);
        }, 150);
    }

    protected rotateTowerToTarget(): void {
        if (!this.mesh || !this.targetEnemy) return;
        const targetPosition = this.targetEnemy.getPosition();
        const direction = targetPosition.subtract(this.position);
        const angle = Math.atan2(direction.x, direction.z);
        this.mesh.rotation.y = angle;
    }

    // Aura buff setters (called by TowerManager when processing aura towers)
    public setAuraBuffs(damage: number, fireRate: number, range: number): void {
        this.auraDamageBonus = damage;
        this.auraFireRateBonus = fireRate;
        this.auraRangeBonus = range;
    }

    public getAbilityState(): AbilityState | null {
        return this.abilityState;
    }

    public static getAbilitySystem(): TowerAbilitySystem | null {
        return Tower.abilitySystem;
    }

    // ===== Getters =====

    public getMaxLevel(): number {
        return 8; // max tier
    }

    public getTargetingMode(): TargetingMode {
        return this.targetingMode;
    }

    public setTargetingMode(mode: TargetingMode): void {
        this.targetingMode = mode;
    }

    public cycleTargetingMode(): TargetingMode {
        const modes = [TargetingMode.CLOSEST, TargetingMode.FIRST, TargetingMode.STRONGEST];
        const currentIndex = modes.indexOf(this.targetingMode);
        this.targetingMode = modes[(currentIndex + 1) % modes.length];
        return this.targetingMode;
    }

    /**
     * Legacy upgrade method — in the new system, use evolve() instead.
     * This now returns false; the upgrade flow should use evolve().
     */
    public upgrade(): boolean {
        return false;
    }

    public getUpgradeCost(): number {
        const options = this.getUpgradeOptions();
        if (options.length === 0) return 0;
        return options[0].stats.cost;
    }

    public toggleRangeIndicator(): void {
        if (this.showingRange) {
            this.hideRangeIndicator();
        } else {
            this.showRangeIndicator();
        }
    }

    protected showRangeIndicator(): void {
        if (this.rangeIndicator) return;

        const effectiveRange = this.range + this.auraRangeBonus;
        this.rangeIndicator = MeshBuilder.CreateDisc(
            'rangeIndicator' + this.towerId,
            { radius: effectiveRange, tessellation: 32, sideOrientation: Mesh.DOUBLESIDE },
            this.scene
        );
        this.rangeIndicator.position = new Vector3(this.position.x, 0.02, this.position.z);
        this.rangeIndicator.rotation = new Vector3(Math.PI / 2, 0, 0);
        this.rangeIndicator.renderingGroupId = 1;

        let rangeColor = new Color3(1.0, 0.8, 0.2);
        switch (this.elementType) {
            case ElementType.FIRE: rangeColor = new Color3(0.9, 0.3, 0.1); break;
            case ElementType.WATER: rangeColor = new Color3(0.1, 0.4, 0.9); break;
            case ElementType.WIND: rangeColor = new Color3(0.5, 0.9, 0.1); break;
            case ElementType.EARTH: rangeColor = new Color3(0.7, 0.5, 0.1); break;
        }

        const rangeMaterial = new StandardMaterial('rangeMaterial_' + this.towerId, this.scene);
        rangeMaterial.diffuseColor = rangeColor;
        rangeMaterial.specularColor = Color3.Black();
        rangeMaterial.emissiveColor = rangeColor.scale(0.3);
        rangeMaterial.alpha = 0.2;
        rangeMaterial.disableLighting = true;
        this.rangeIndicator.material = rangeMaterial;

        const outerRing = MeshBuilder.CreateTorus(
            'rangeRing' + this.towerId,
            { diameter: effectiveRange * 2, thickness: 0.08, tessellation: 32 },
            this.scene
        );
        outerRing.position = new Vector3(this.position.x, 0.03, this.position.z);
        outerRing.parent = this.rangeIndicator;

        const ringMaterial = new StandardMaterial('ringMaterial_' + this.towerId, this.scene);
        ringMaterial.diffuseColor = rangeColor;
        ringMaterial.emissiveColor = rangeColor.scale(0.5);
        ringMaterial.specularColor = Color3.Black();
        ringMaterial.alpha = 0.6;
        ringMaterial.disableLighting = true;
        outerRing.material = ringMaterial;

        this.rangeIndicator.metadata = {};
        this.showingRange = true;
    }

    protected hideRangeIndicator(): void {
        if (this.rangeIndicator) {
            this.rangeIndicator.dispose();
            this.rangeIndicator = null;
            this.showingRange = false;
        }
    }

    public getPosition(): Vector3 {
        return this.position;
    }

    public getRange(): number {
        return this.range + this.auraRangeBonus;
    }

    public getDamage(): number {
        return this.damage + this.auraDamageBonus;
    }

    public getFireRate(): number {
        return this.fireRate + this.auraFireRateBonus;
    }

    public getLevel(): number {
        return this.tier;
    }

    public getSellValue(): number {
        return this.sellValue;
    }

    public dispose(): void {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        this.hideRangeIndicator();
        this.removeSelectionIndicator();
    }

    public getElementType(): ElementType {
        return this.elementType;
    }

    public getType(): string {
        return this.definitionId;
    }

    public applyFireRateBoost(multiplier: number, duration: number): void {
        const originalRate = this.fireRate;
        this.fireRate *= multiplier;
        setTimeout(() => {
            this.fireRate = originalRate;
        }, duration * 1000);
    }

    public getGridPosition(): { x: number, y: number } {
        return { x: 0, y: 0 };
    }

    public select(): void {
        if (this.isSelected) return;
        this.isSelected = true;
        this.showRangeIndicator();
        this.createSelectionIndicator();
    }

    public deselect(): void {
        if (!this.isSelected) return;
        this.isSelected = false;
        this.hideRangeIndicator();
        this.removeSelectionIndicator();
    }

    public getIsSelected(): boolean {
        return this.isSelected;
    }

    protected createSelectionIndicator(): void {
        if (this.selectionIndicator) return;
        this.selectionIndicator = MeshBuilder.CreateTorus('selectionIndicator', {
            diameter: 2.2,
            thickness: 0.12,
            tessellation: 16
        }, this.scene);
        this.selectionIndicator.position = new Vector3(this.position.x, 0.1, this.position.z);
        const selectionColor = new Color3(0.3, 0.8, 1.0);
        const material = createEmissiveMaterial('selectionMat', selectionColor, 0.8, this.scene);
        material.alpha = 0.7;
        this.selectionIndicator.material = material;
    }

    protected removeSelectionIndicator(): void {
        if (this.selectionIndicator) {
            this.selectionIndicator.dispose();
            this.selectionIndicator = null;
        }
    }

    public updateSellValue(): void {
        this.sellValue = calcSellValue(this.definitionId);
    }

    public getMesh(): Mesh | null {
        return this.mesh;
    }

    protected safeColor4(color3: Color3, alpha: number = 1.0): Color4 {
        if (!color3) return new Color4(1, 1, 1, alpha);
        try {
            return new Color4(
                color3.r !== undefined ? color3.r : 1.0,
                color3.g !== undefined ? color3.g : 1.0,
                color3.b !== undefined ? color3.b : 1.0,
                alpha
            );
        } catch {
            return new Color4(1, 1, 1, alpha);
        }
    }

    public getId(): string {
        return this.towerId;
    }

    public getCost(): number {
        return this.cost;
    }

    public getTreeType(): 'medieval' | 'elemental' {
        return this.treeType;
    }

    public getAbilityDescription(): string {
        if (!this.abilityState) return '';
        return `${this.abilityState.definition.name}: ${this.abilityState.definition.description}`;
    }

    public getAbilityName(): string {
        if (!this.abilityState) return '';
        return this.abilityState.definition.name;
    }
}
