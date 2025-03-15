import { Scene, Vector3, Color3, ParticleSystem } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Base class for all elemental towers
 */
export abstract class ElementalTower extends Tower {
    /**
     * The color of the tower based on its element
     */
    protected elementColor: Color3;

    /**
     * The color of the projectiles fired by this tower
     */
    protected projectileColor: Color3;

    /**
     * Constructor for the ElementalTower
     * @param game The game instance
     * @param scene The scene
     * @param position The position of the tower
     * @param elementType The element type of the tower
     */
    constructor(
        game: Game,
        position: Vector3,
        range: number,
        damage: number,
        fireRate: number,
        cost: number,
        elementType: ElementType
    ) {
        super(game, position, range, damage, fireRate, cost);
        
        // Set the element type
        this.elementType = elementType;
        
        // Set default secondary effect chance
        this.secondaryEffectChance = 0.3;
        
        // Set element color based on element type
        switch (elementType) {
            case ElementType.FIRE:
                this.elementColor = new Color3(1, 0.3, 0);
                this.projectileColor = new Color3(1, 0.5, 0);
                break;
            case ElementType.WATER:
                this.elementColor = new Color3(0, 0.5, 1);
                this.projectileColor = new Color3(0.4, 0.7, 1);
                break;
            case ElementType.WIND:
                this.elementColor = new Color3(0.7, 1, 0.7);
                this.projectileColor = new Color3(0.8, 1, 0.8);
                break;
            case ElementType.EARTH:
                this.elementColor = new Color3(0.5, 0.3, 0);
                this.projectileColor = new Color3(0.6, 0.4, 0.1);
                break;
            default:
                this.elementColor = new Color3(0.7, 0.7, 0.7);
                this.projectileColor = new Color3(0.9, 0.9, 0.9);
                break;
        }
    }

    /**
     * Update tower visuals after creation or upgrade
     */
    protected updateVisuals(): void {
        super.updateVisuals();
        
        // Apply elemental color to the tower
        if (this.mesh && this.mesh.material) {
            const material = this.mesh.material as any;
            material.diffuseColor = this.elementColor;
            material.specularColor = new Color3(0.2, 0.2, 0.2);
        }
    }

    /**
     * Set projectile colors based on element type
     * @param particleSystem The particle system to set colors for
     */
    protected setProjectileColors(particleSystem: ParticleSystem): void {
        // Override the base method to use our custom colors
        switch (this.elementType) {
            case ElementType.FIRE:
                particleSystem.color1 = new Color3(1, 0.5, 0).toColor4(1.0);
                particleSystem.color2 = new Color3(1, 0, 0).toColor4(1.0);
                particleSystem.colorDead = new Color3(0.3, 0, 0).toColor4(0.0);
                break;
            case ElementType.WATER:
                particleSystem.color1 = new Color3(0, 0.5, 1).toColor4(1.0);
                particleSystem.color2 = new Color3(0, 0, 1).toColor4(1.0);
                particleSystem.colorDead = new Color3(0, 0, 0.3).toColor4(0.0);
                break;
            case ElementType.WIND:
                particleSystem.color1 = new Color3(0.7, 1, 0.7).toColor4(1.0);
                particleSystem.color2 = new Color3(0.5, 0.8, 0.5).toColor4(1.0);
                particleSystem.colorDead = new Color3(0.2, 0.3, 0.2).toColor4(0.0);
                break;
            case ElementType.EARTH:
                particleSystem.color1 = new Color3(0.6, 0.3, 0).toColor4(1.0);
                particleSystem.color2 = new Color3(0.4, 0.2, 0).toColor4(1.0);
                particleSystem.colorDead = new Color3(0.2, 0.1, 0).toColor4(0.0);
                break;
            default:
                particleSystem.color1 = new Color3(1, 1, 1).toColor4(1.0);
                particleSystem.color2 = new Color3(0.5, 0.5, 0.5).toColor4(1.0);
                particleSystem.colorDead = new Color3(0, 0, 0).toColor4(0.0);
                break;
        }
    }
} 