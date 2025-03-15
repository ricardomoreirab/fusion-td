import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Wind Tower - Deals wind damage and can push or stun enemies
 * - Primary Effect: Push enemies back
 * - Secondary Effect: Chance to stun
 * - Strong against: Water, Flying
 * - Weak against: Earth, Heavy
 */
export class WindTower extends ElementalTower {
    /**
     * Constructor for the WindTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for wind tower
        const damage = 6;
        const range = 7;
        const fireRate = 2.0;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.WIND);
        
        // Set wind-specific properties
        this.secondaryEffectChance = 0.2; // 20% chance to stun
        this.statusEffectDuration = 1.0; // 1 second of push/stun
        this.statusEffectStrength = 0.5; // 50% push strength
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WATER,
            EnemyType.FLYING,
            EnemyType.LIGHT
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.EARTH,
            EnemyType.HEAVY
        ];
        
        // Update visuals to apply wind appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a cylinder for the tower base
        this.mesh = MeshBuilder.CreateCylinder(
            'windTower',
            {
                height: 2.0,
                diameter: 0.8,
                tessellation: 8
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('windTowerMaterial', this.scene);
        material.diffuseColor = this.elementColor;
        material.specularColor = new Color3(0.9, 0.9, 0.9);
        material.emissiveColor = new Color3(0.2, 0.3, 0.2);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 1.0, this.position.z);
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Apply push effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.PUSHED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // Apply stunning effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.STUNNED,
            0.5, // 0.5 seconds of stunning
            1.0 // 100% stun (complete stop)
        );
    }
} 