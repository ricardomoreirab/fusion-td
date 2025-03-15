import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Water Tower - Deals water damage and can slow or freeze enemies
 * - Primary Effect: Slowed movement
 * - Secondary Effect: Chance to freeze
 * - Strong against: Fire, Earth
 * - Weak against: Wind, Electric
 */
export class WaterTower extends ElementalTower {
    /**
     * Constructor for the WaterTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for water tower
        const damage = 8;
        const range = 6;
        const fireRate = 1.5;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.WATER);
        
        // Set water-specific properties
        this.secondaryEffectChance = 0.25; // 25% chance to freeze
        this.statusEffectDuration = 2.5; // 2.5 seconds of slowing
        this.statusEffectStrength = 0.4; // 40% slow
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.EARTH
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WIND,
            EnemyType.ELECTRIC
        ];
        
        // Update visuals to apply water appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a cylinder for the tower base
        this.mesh = MeshBuilder.CreateCylinder(
            'waterTower',
            {
                height: 1.2,
                diameter: 1,
                tessellation: 16
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('waterTowerMaterial', this.scene);
        material.diffuseColor = this.elementColor;
        material.specularColor = new Color3(0.4, 0.7, 1);
        material.emissiveColor = new Color3(0, 0.2, 0.5);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.6, this.position.z);
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Apply slowing effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.SLOWED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // Apply freezing effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.FROZEN,
            1.0, // 1 second of freezing
            1.0 // 100% freeze (complete stop)
        );
    }
} 