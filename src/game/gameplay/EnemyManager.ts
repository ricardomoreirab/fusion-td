import { Vector3 } from '@babylonjs/core';
import { Game } from '../Game';
import { Map } from './Map';
import { Enemy } from './enemies/Enemy';
import { BasicEnemy } from './enemies/BasicEnemy';
import { FastEnemy } from './enemies/FastEnemy';
import { TankEnemy } from './enemies/TankEnemy';
import { BossEnemy } from './enemies/BossEnemy';
import { PlayerStats } from './PlayerStats';

export class EnemyManager {
    private game: Game;
    private map: Map;
    private enemies: Enemy[] = [];
    private playerStats: PlayerStats | null = null;

    constructor(game: Game, map: Map) {
        this.game = game;
        this.map = map;
    }

    /**
     * Set the player stats reference for rewarding kills
     * @param playerStats The player stats instance
     */
    public setPlayerStats(playerStats: PlayerStats): void {
        this.playerStats = playerStats;
    }

    /**
     * Update all enemies
     * @param deltaTime Time elapsed since last update in seconds
     */
    public update(deltaTime: number): void {
        // Create a copy of the array to safely remove enemies during iteration
        const enemiesToUpdate = [...this.enemies];
        
        for (const enemy of enemiesToUpdate) {
            // Update enemy and check if it reached the end
            const reachedEnd = enemy.update(deltaTime);
            
            if (reachedEnd) {
                // Enemy reached the end, damage player
                if (this.playerStats) {
                    this.playerStats.takeDamage(enemy.getDamage());
                }
                
                // Remove from enemies list
                this.removeEnemy(enemy);
            } else if (!enemy.isAlive()) {
                // Enemy died, give reward to player
                if (this.playerStats) {
                    this.playerStats.addMoney(enemy.getReward());
                }
                
                // Remove from enemies list
                this.removeEnemy(enemy);
            }
        }
    }

    /**
     * Create a new enemy
     * @param type The type of enemy to create
     * @returns The created enemy
     */
    public createEnemy(type: string): Enemy {
        const path = this.map.getPath();
        const startPosition = this.map.getStartPosition();
        
        let enemy: Enemy;
        
        // Create the appropriate enemy type
        switch (type) {
            case 'basic':
                enemy = new BasicEnemy(this.game, startPosition, path);
                break;
            case 'fast':
                enemy = new FastEnemy(this.game, startPosition, path);
                break;
            case 'tank':
                enemy = new TankEnemy(this.game, startPosition, path);
                break;
            case 'boss':
                enemy = new BossEnemy(this.game, startPosition, path);
                break;
            default:
                // Default to basic enemy
                enemy = new BasicEnemy(this.game, startPosition, path);
                break;
        }
        
        // Add to enemies list
        this.enemies.push(enemy);
        
        return enemy;
    }

    /**
     * Remove an enemy from the manager
     * @param enemy The enemy to remove
     */
    private removeEnemy(enemy: Enemy): void {
        const index = this.enemies.indexOf(enemy);
        if (index !== -1) {
            this.enemies.splice(index, 1);
        }
    }

    /**
     * Get all enemies
     * @returns Array of all enemies
     */
    public getEnemies(): Enemy[] {
        return this.enemies;
    }

    /**
     * Get the number of enemies currently active
     * @returns The number of enemies
     */
    public getEnemyCount(): number {
        return this.enemies.length;
    }

    /**
     * Get enemies within a certain range of a position
     * @param position The center position
     * @param range The maximum range
     * @returns Array of enemies within range
     */
    public getEnemiesInRange(position: Vector3, range: number): Enemy[] {
        return this.enemies.filter(enemy => {
            const distance = Vector3.Distance(position, enemy.getPosition());
            return distance <= range && enemy.isAlive();
        });
    }

    /**
     * Get the closest enemy to a position
     * @param position The position to check from
     * @param maxRange The maximum range to check (optional)
     * @returns The closest enemy or null if none found
     */
    public getClosestEnemy(position: Vector3, maxRange?: number): Enemy | null {
        let closestEnemy: Enemy | null = null;
        let closestDistance = maxRange !== undefined ? maxRange : Number.MAX_VALUE;
        
        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            
            const distance = Vector3.Distance(position, enemy.getPosition());
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemy;
            }
        }
        
        return closestEnemy;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        for (const enemy of this.enemies) {
            enemy.dispose();
        }
        this.enemies = [];
    }
} 