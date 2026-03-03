import { Vector3 } from '@babylonjs/core';
import { Game } from '../Game';
import { Champion } from './Champion';
import { EnemyManager } from './EnemyManager';
import { WaveManager } from './WaveManager';

/**
 * Manages the Champion summon lifecycle and wave-based cooldown.
 * The champion can be summoned once every 10 waves.
 */
export class ChampionManager {
    private game: Game;
    private enemyManager: EnemyManager;
    private waveManager: WaveManager;
    private champion: Champion | null = null;
    private lastUsedWave: number = -10; // allows first use immediately

    constructor(game: Game, enemyManager: EnemyManager, waveManager: WaveManager) {
        this.game = game;
        this.enemyManager = enemyManager;
        this.waveManager = waveManager;
    }

    /**
     * Check if the champion can be summoned right now
     */
    public canSummon(): boolean {
        return this.champion === null && this.getWavesUntilReady() === 0;
    }

    /**
     * Get number of waves remaining before the champion can be summoned again
     */
    public getWavesUntilReady(): number {
        const currentWave = this.waveManager.getCurrentWave();
        return Math.max(0, 10 - (currentWave - this.lastUsedWave));
    }

    /**
     * Summon the champion at the end of the path, walking in reverse toward the start
     */
    public summon(path: Vector3[]): void {
        if (!this.canSummon()) return;

        // Reverse the path so champion walks from end to start
        const reversedPath = [...path].reverse();

        this.champion = new Champion(this.game, reversedPath, this.enemyManager);
        this.lastUsedWave = this.waveManager.getCurrentWave();
    }

    /**
     * Update the active champion. Dispose it if it reached the start or died.
     */
    public update(deltaTime: number): void {
        if (!this.champion) return;

        if (!this.champion.isAlive()) {
            // Champion died in combat
            this.champion.dispose();
            this.champion = null;
            return;
        }

        const reachedEnd = this.champion.update(deltaTime);
        if (reachedEnd) {
            // Champion reached the start (end of reversed path) — despawn
            this.champion.dispose();
            this.champion = null;
        }
    }

    /**
     * Check if a champion is currently active on the field
     */
    public isChampionActive(): boolean {
        return this.champion !== null;
    }

    /**
     * Clean up the active champion
     */
    public dispose(): void {
        if (this.champion) {
            this.champion.dispose();
            this.champion = null;
        }
    }
}
