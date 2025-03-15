import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Earth Tower - Deals earth damage and can stun or confuse enemies
 * - Primary Effect: High damage to ground units
 * - Secondary Effect: Chance to confuse
 * - Strong against: Wind, Electric, Heavy
 * - Weak against: Fire, Water
 */
export class EarthTower extends ElementalTower {
    /**
     * Constructor for the EarthTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for earth tower
        const damage = 15;
        const range = 4;
        const fireRate = 0.8;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.EARTH);
        
        // Set earth-specific properties
        this.secondaryEffectChance = 0.15; // 15% chance to confuse
        this.statusEffectDuration = 2.0; // 2 seconds of confusion
        this.statusEffectStrength = 0.7; // 70% confusion strength
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WIND,
            EnemyType.ELECTRIC,
            EnemyType.HEAVY
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.FIRE,
            EnemyType.WATER
        ];
        
        // Earth towers cannot target flying enemies
        this.canTargetFlying = false;
        
        // Update visuals to apply earth appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a box for the tower base
        this.mesh = MeshBuilder.CreateBox(
            'earthTower',
            {
                width: 1.2,
                height: 1.0,
                depth: 1.2
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('earthTowerMaterial', this.scene);
        material.diffuseColor = this.elementColor;
        material.specularColor = new Color3(0.2, 0.1, 0);
        material.emissiveColor = new Color3(0.1, 0.05, 0);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.5, this.position.z);
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Earth tower doesn't apply a status effect as primary
        // Instead, it deals extra damage to ground units in the calculateDamage method
        
        // But we can apply a short stun as a primary effect
        if (enemy.getEnemyType() !== EnemyType.FLYING) {
            this.applyStatusEffect(
                enemy,
                StatusEffect.STUNNED,
                0.3, // 0.3 seconds of stunning
                1.0 // 100% stun (complete stop)
            );
        }
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // Apply confusion effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.CONFUSED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Calculate damage based on elemental strengths/weaknesses
     * @param enemy The target enemy
     * @returns The calculated damage
     */
    protected calculateDamage(enemy: Enemy): number {
        let damage = super.calculateDamage(enemy);
        
        // Earth towers deal extra damage to ground units
        if (enemy.getEnemyType() !== EnemyType.FLYING) {
            damage *= 1.5; // 50% extra damage to ground units
        }
        
        return damage;
    }
} 