import { Vector3 } from '@babylonjs/core';
import { Game } from '../Game';
import { Map } from './Map';
import { Enemy } from './enemies/Enemy';
import { BasicEnemy } from './enemies/BasicEnemy';
import { FastEnemy } from './enemies/FastEnemy';
import { TankEnemy } from './enemies/TankEnemy';
import { BossEnemy } from './enemies/BossEnemy';
import { PlayerStats } from './PlayerStats';
import { TowerManager } from './TowerManager';

export class EnemyManager {
    private game: Game;
    private map: Map;
    private enemies: Enemy[] = [];
    private playerStats: PlayerStats | null = null;
    private towerManager: TowerManager | null = null;
    private compositePath: Vector3[] | null = null;

    constructor(game: Game, map: Map) {
        this.game = game;
        this.map = map;
    }

    /**
     * Set the player stats reference for rewarding kills
     */
    public setPlayerStats(playerStats: PlayerStats): void {
        this.playerStats = playerStats;
    }

    /**
     * Set the tower manager reference for tower destruction capabilities
     */
    public setTowerManager(towerManager: TowerManager): void {
        this.towerManager = towerManager;

        // Update any existing enemies
        for (const enemy of this.enemies) {
            enemy.setTowerManager(towerManager);
        }
    }

    /**
     * Set the composite path (spanning all segments) for new enemy spawning.
     */
    public setCompositePath(path: Vector3[]): void {
        this.compositePath = path;
    }

    /**
     * Extend paths of all currently in-flight enemies with bridge + new segment waypoints.
     */
    public extendAllEnemyPaths(additionalPoints: Vector3[]): void {
        for (const enemy of this.enemies) {
            if (enemy.isAlive()) {
                enemy.extendPath(additionalPoints);
            }
        }
    }

    /**
     * Update all enemies
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
                    this.playerStats.addKill();
                }

                // Remove from enemies list
                this.removeEnemy(enemy);
            }
        }
    }

    /**
     * Create a new enemy. Uses composite path if available, otherwise the single map path.
     */
    public createEnemy(type: string): Enemy {
        const path = this.compositePath || this.map.getPath();
        const startPosition = this.map.getStartPosition();

        let enemy: Enemy;

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
                enemy = new BasicEnemy(this.game, startPosition, path);
                break;
        }

        // Set tower manager reference if available
        if (this.towerManager) {
            enemy.setTowerManager(this.towerManager);
        }

        // Add to enemies list
        this.enemies.push(enemy);

        return enemy;
    }

    /**
     * Remove an enemy from the manager
     */
    private removeEnemy(enemy: Enemy): void {
        const index = this.enemies.indexOf(enemy);
        if (index !== -1) {
            this.enemies.splice(index, 1);
        }
    }

    /**
     * Get all enemies
     */
    public getEnemies(): Enemy[] {
        return this.enemies;
    }

    /**
     * Get the number of enemies currently active
     */
    public getEnemyCount(): number {
        return this.enemies.length;
    }

    /**
     * Get enemies within a certain range of a position
     */
    public getEnemiesInRange(position: Vector3, range: number): Enemy[] {
        return this.enemies.filter(enemy => {
            const distance = Vector3.Distance(position, enemy.getPosition());
            return distance <= range && enemy.isAlive();
        });
    }

    /**
     * Get the closest enemy to a position
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
