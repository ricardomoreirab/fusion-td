import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Fire Tower - Deals fire damage and can burn enemies
 * - Primary Effect: Burning (DoT)
 * - Strong against: Wind, Earth, Plant
 * - Weak against: Water, Ice
 */
export class FireTower extends ElementalTower {
    /**
     * Constructor for the FireTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for fire tower
        const damage = 12;
        const range = 5;
        const fireRate = 1.2;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.FIRE);
        
        // Set fire-specific properties
        this.secondaryEffectChance = 0.4; // 40% chance to apply burning
        this.statusEffectDuration = 3; // 3 seconds of burning
        this.statusEffectStrength = 0.2; // 20% of damage per second
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WIND,
            EnemyType.EARTH,
            EnemyType.PLANT
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WATER,
            EnemyType.ICE
        ];
        
        // Update visuals to apply fire appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a cylinder for the tower base
        this.mesh = MeshBuilder.CreateCylinder(
            'fireTower',
            {
                height: 1.5,
                diameter: 1,
                tessellation: 12
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('fireTowerMaterial', this.scene);
        material.diffuseColor = this.elementColor;
        material.specularColor = new Color3(1, 0.6, 0.3);
        material.emissiveColor = new Color3(0.5, 0.1, 0);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.75, this.position.z);
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Apply burning effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.BURNING,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // For fire tower, secondary effect is just additional burning damage
        // Apply a shorter but more intense burning effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.BURNING,
            1.5, // 1.5 seconds
            this.statusEffectStrength * 2 // Double strength
        );
    }
} 