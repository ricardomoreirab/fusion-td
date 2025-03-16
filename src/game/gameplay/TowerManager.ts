import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Scene } from '@babylonjs/core';
import { Game } from '../Game';
import { Map } from './Map';
import { Tower } from './towers/Tower';
import { BasicTower } from './towers/BasicTower';
import { FastTower } from './towers/FastTower';
import { HeavyTower } from './towers/HeavyTower';
import { SniperTower } from './towers/SniperTower';
import { FireTower } from './towers/FireTower';
import { WaterTower } from './towers/WaterTower';
import { WindTower } from './towers/WindTower';
import { EarthTower } from './towers/EarthTower';
import { TowerCombiner } from './towers/TowerCombiner';
import { EnemyManager } from './EnemyManager';
// Import hybrid towers
import { SteamTower } from './towers/hybrid/SteamTower';
import { LavaTower } from './towers/hybrid/LavaTower';
import { IceTower } from './towers/hybrid/IceTower';
import { StormTower } from './towers/hybrid/StormTower';
import { MudTower } from './towers/hybrid/MudTower';
import { DustTower } from './towers/hybrid/DustTower';

export class TowerManager {
    private game: Game;
    private scene: Scene;
    private map: Map;
    private towers: Tower[] = [];
    private enemyManager: EnemyManager | null = null;
    private towerCombiner: TowerCombiner;

    constructor(game: Game, map: Map) {
        this.game = game;
        this.scene = game.getScene();
        this.map = map;
        this.towerCombiner = new TowerCombiner(game, this, map);
    }

    /**
     * Set the enemy manager reference for targeting
     * @param enemyManager The enemy manager instance
     */
    public setEnemyManager(enemyManager: EnemyManager): void {
        this.enemyManager = enemyManager;
    }

    /**
     * Update all towers
     * @param deltaTime Time elapsed since last update in seconds
     */
    public update(deltaTime: number): void {
        // Check if we have enemies to target
        const hasEnemies = this.enemyManager && this.enemyManager.getEnemyCount() > 0;
        
        for (const tower of this.towers) {
            // If we have an enemy manager with enemies, find targets for the tower
            if (hasEnemies) {
                const position = tower.getPosition();
                const range = tower.getRange();
                const target = this.enemyManager!.getClosestEnemy(position, range);
                
                // Set the target (or null if no enemy in range)
                tower.setTarget(target);
            } else {
                // No enemies available, clear any existing targets
                tower.setTarget(null);
            }
            
            // Update the tower regardless
            tower.update(deltaTime);
        }
    }

    /**
     * Create a new tower at the specified position
     * @param type The type of tower to create
     * @param position The world position to place the tower
     * @returns The created tower or null if creation failed
     */
    public createTower(type: string, position: Vector3): Tower | null {
        let tower: Tower | null = null;
        
        // Create the appropriate tower type
        switch (type) {
            case 'basicTower':
                tower = new BasicTower(this.game, position);
                break;
            case 'fastTower':
                tower = new FastTower(this.game, position);
                break;
            case 'heavyTower':
                tower = new HeavyTower(this.game, position);
                break;
            case 'sniperTower':
                tower = new SniperTower(this.game, position);
                break;
            // Add elemental tower types
            case 'fireTower':
                tower = new FireTower(this.game, position);
                break;
            case 'waterTower':
                tower = new WaterTower(this.game, position);
                break;
            case 'windTower':
                tower = new WindTower(this.game, position);
                break;
            case 'earthTower':
                tower = new EarthTower(this.game, position);
                break;
            // Add hybrid tower types
            case 'steamTower':
                tower = new SteamTower(this.game, position);
                break;
            case 'lavaTower':
                tower = new LavaTower(this.game, position);
                break;
            case 'iceTower':
                tower = new IceTower(this.game, position);
                break;
            case 'stormTower':
                tower = new StormTower(this.game, position);
                break;
            case 'mudTower':
                tower = new MudTower(this.game, position);
                break;
            case 'dustTower':
                tower = new DustTower(this.game, position);
                break;
            default:
                console.error(`Unknown tower type: ${type}`);
                return null;
        }
        
        // Add to towers list
        this.towers.push(tower);
        
        // Create placement effect
        this.createPlacementEffect(position);
        
        // Check for possible tower combinations
        if (tower && type.includes('Tower') && type !== 'basicTower') {
            this.towerCombiner.checkForCombinations(tower);
        }
        
        return tower;
    }

    /**
     * Create a visual effect when placing a tower
     * @param position The position to create the effect at
     */
    private createPlacementEffect(position: Vector3): void {
        // Create a particle system for the placement effect
        const particleSystem = new ParticleSystem('towerPlacementParticles', 50, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        particleSystem.emitter = new Vector3(position.x, position.y + 1, position.z);
        particleSystem.minEmitBox = new Vector3(-0.5, 0, -0.5);
        particleSystem.maxEmitBox = new Vector3(0.5, 0, 0.5);
        
        // Set particle properties
        particleSystem.color1 = new Color4(0.7, 0.8, 1.0, 1.0);
        particleSystem.color2 = new Color4(0.2, 0.5, 1.0, 1.0);
        particleSystem.colorDead = new Color4(0, 0, 0.2, 0.0);
        
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.5;
        
        particleSystem.minLifeTime = 0.3;
        particleSystem.maxLifeTime = 1.0;
        
        particleSystem.emitRate = 100;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 9.81, 0);
        
        particleSystem.direction1 = new Vector3(-1, 8, -1);
        particleSystem.direction2 = new Vector3(1, 8, 1);
        
        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        // Stop and dispose after 1 second
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1000);
        }, 1000);
    }

    /**
     * Get all towers
     * @returns Array of all towers
     */
    public getTowers(): Tower[] {
        return this.towers;
    }

    /**
     * Find the closest tower to a position within a certain range
     * @param position The position to check from
     * @param maxRange The maximum range to check
     * @returns The closest tower or null if none found
     */
    public getClosestTower(position: Vector3, maxRange: number): Tower | null {
        let closestTower: Tower | null = null;
        let closestDistance = maxRange;
        
        for (const tower of this.towers) {
            const distance = Vector3.Distance(position, tower.getPosition());
            if (distance < closestDistance) {
                closestDistance = distance;
                closestTower = tower;
            }
        }
        
        return closestTower;
    }

    /**
     * Upgrade a tower
     * @param tower The tower to upgrade
     * @returns True if upgrade was successful
     */
    public upgradeTower(tower: Tower | null): boolean {
        if (!tower) return false;
        return tower.upgrade();
    }

    /**
     * Add a tower to the manager
     * @param tower The tower to add
     */
    public addTower(tower: Tower): void {
        this.towers.push(tower);
    }

    /**
     * Remove a tower from the manager
     * @param tower The tower to remove
     */
    public removeTower(tower: Tower): void {
        const index = this.towers.indexOf(tower);
        if (index !== -1) {
            this.towers.splice(index, 1);
            tower.dispose(); // Clean up tower resources
        }
    }

    /**
     * Sell a tower
     * @param tower The tower to sell
     * @returns The amount of money received from selling
     */
    public sellTower(tower: Tower): number {
        const sellValue = tower.getSellValue();
        
        // Get the grid position before removing the tower
        const gridPosition = this.map.worldToGrid(tower.getPosition());
        
        // Remove from towers list
        this.removeTower(tower);
        
        // Dispose the tower
        tower.dispose();
        
        // Update the grid after tower is disposed
        this.map.setTowerPlaced(gridPosition.x, gridPosition.y, false);
        
        return sellValue;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        for (const tower of this.towers) {
            tower.dispose();
        }
        this.towers = [];
    }
} 