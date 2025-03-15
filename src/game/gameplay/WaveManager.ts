import { EnemyManager } from './EnemyManager';
import { PlayerStats } from './PlayerStats';

// Define a wave of enemies
interface Wave {
    enemies: {
        type: string;
        count: number;
        delay: number; // Delay between spawns in seconds
    }[];
    reward: number; // Bonus money for completing the wave
}

// Class to manage a single parallel wave
class ParallelWave {
    private enemyManager: EnemyManager;
    private enemiesLeftToSpawn: { type: string, delay: number }[] = [];
    private timeSinceLastSpawn: number = 0;
    private completed: boolean = false;
    private waveNumber: number;
    private reward: number;

    constructor(enemyManager: EnemyManager, enemies: { type: string, delay: number }[], waveNumber: number, reward: number) {
        this.enemyManager = enemyManager;
        this.enemiesLeftToSpawn = [...enemies]; // Clone the array
        this.waveNumber = waveNumber;
        this.reward = reward;
        this.timeSinceLastSpawn = Number.MAX_VALUE; // Force immediate spawn
    }

    /**
     * Update this parallel wave
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the wave is completed, false otherwise
     */
    public update(deltaTime: number): boolean {
        // If already completed, just return
        if (this.completed) {
            return true;
        }

        // If there are no enemies left to spawn, check if all enemies are defeated
        if (this.enemiesLeftToSpawn.length === 0) {
            // Wave is completed when all enemies are spawned and defeated
            // But we don't track individual enemies per wave, so we can't know for sure
            // Instead, we'll just mark it as completed
            this.completed = true;
            return true;
        }

        // Update spawn timer
        this.timeSinceLastSpawn += deltaTime;

        // Check if it's time to spawn the next enemy
        if (this.timeSinceLastSpawn >= this.enemiesLeftToSpawn[0].delay) {
            // Spawn the enemy
            const enemyType = this.enemiesLeftToSpawn[0].type;
            this.enemyManager.createEnemy(enemyType);

            // Remove from queue
            this.enemiesLeftToSpawn.shift();

            // Reset timer
            this.timeSinceLastSpawn = 0;
        }

        return false;
    }

    /**
     * Get the wave number
     * @returns The wave number
     */
    public getWaveNumber(): number {
        return this.waveNumber;
    }

    /**
     * Get the reward for completing this wave
     * @returns The reward amount
     */
    public getReward(): number {
        return this.reward;
    }

    /**
     * Check if this wave is completed
     * @returns True if completed, false otherwise
     */
    public isCompleted(): boolean {
        return this.completed;
    }
}

export class WaveManager {
    private enemyManager: EnemyManager;
    private playerStats: PlayerStats;
    private waves: Wave[] = [];
    private currentWave: number = 0;
    private waveInProgress: boolean = false;
    private enemiesLeftToSpawn: { type: string, delay: number }[] = [];
    private timeSinceLastSpawn: number = 0;
    private totalWaves: number = 10;
    private difficultyMultiplier: number = 1.0; // Multiplier for enemy stats
    private autoWaveTimer: number = 0; // Timer for auto-starting waves
    private autoWaveDelay: number = 5; // Delay in seconds before auto-starting next wave
    private parallelWaves: ParallelWave[] = []; // Array of parallel waves

    constructor(enemyManager: EnemyManager, playerStats: PlayerStats) {
        this.enemyManager = enemyManager;
        this.playerStats = playerStats;
        
        // Set player stats in enemy manager for rewards
        this.enemyManager.setPlayerStats(playerStats);
        
        // Generate initial waves
        this.generateWaves();
    }

    /**
     * Generate all waves for the game
     */
    private generateWaves(): void {
        // Generate 10 predefined waves
        this.waves = [];
        
        // Wave 1: Basic enemies only
        this.waves.push({
            enemies: [
                { type: 'basic', count: 10, delay: 1.5 }
            ],
            reward: 50
        });
        
        // Wave 2: More basic enemies
        this.waves.push({
            enemies: [
                { type: 'basic', count: 15, delay: 1.2 }
            ],
            reward: 75
        });
        
        // Wave 3: Basic and fast enemies
        this.waves.push({
            enemies: [
                { type: 'basic', count: 10, delay: 1.2 },
                { type: 'fast', count: 5, delay: 1.0 }
            ],
            reward: 100
        });
        
        // Wave 4: More fast enemies
        this.waves.push({
            enemies: [
                { type: 'basic', count: 8, delay: 1.2 },
                { type: 'fast', count: 10, delay: 0.8 }
            ],
            reward: 125
        });
        
        // Wave 5: Introduce tank enemies
        this.waves.push({
            enemies: [
                { type: 'basic', count: 10, delay: 1.0 },
                { type: 'fast', count: 8, delay: 0.8 },
                { type: 'tank', count: 3, delay: 3.0 }
            ],
            reward: 150
        });
        
        // Wave 6: More of everything
        this.waves.push({
            enemies: [
                { type: 'basic', count: 15, delay: 0.8 },
                { type: 'fast', count: 10, delay: 0.7 },
                { type: 'tank', count: 5, delay: 2.5 }
            ],
            reward: 175
        });
        
        // Wave 7: Harder mix
        this.waves.push({
            enemies: [
                { type: 'basic', count: 20, delay: 0.7 },
                { type: 'fast', count: 15, delay: 0.6 },
                { type: 'tank', count: 8, delay: 2.0 }
            ],
            reward: 200
        });
        
        // Wave 8: Even harder
        this.waves.push({
            enemies: [
                { type: 'basic', count: 15, delay: 0.6 },
                { type: 'fast', count: 20, delay: 0.5 },
                { type: 'tank', count: 10, delay: 1.8 }
            ],
            reward: 225
        });
        
        // Wave 9: Pre-boss wave
        this.waves.push({
            enemies: [
                { type: 'basic', count: 20, delay: 0.5 },
                { type: 'fast', count: 20, delay: 0.4 },
                { type: 'tank', count: 15, delay: 1.5 }
            ],
            reward: 250
        });
        
        // Wave 10: Boss wave
        this.waves.push({
            enemies: [
                { type: 'basic', count: 10, delay: 0.4 },
                { type: 'fast', count: 10, delay: 0.3 },
                { type: 'tank', count: 5, delay: 1.0 },
                { type: 'boss', count: 1, delay: 0 }
            ],
            reward: 500
        });
        
        // Set total waves to infinity (we'll generate more as needed)
        this.totalWaves = Infinity;
    }

    /**
     * Generate a new wave based on the current wave number
     * @returns The generated wave
     */
    private generateNextWave(): Wave {
        // Every 5 waves, increase difficulty
        if (this.currentWave % 5 === 0 && this.currentWave > 0) {
            this.difficultyMultiplier += 0.5;
            console.log(`Difficulty increased to ${this.difficultyMultiplier}x at wave ${this.currentWave + 1}`);
        }
        
        // Base counts that increase with wave number
        const basicCount = Math.floor(10 + this.currentWave * 2);
        const fastCount = Math.floor(Math.max(0, 5 + (this.currentWave - 2) * 3));
        const tankCount = Math.floor(Math.max(0, 3 + (this.currentWave - 4) * 2));
        const bossCount = Math.floor(Math.max(0, Math.floor((this.currentWave - 9) / 5)));
        
        // Base reward that increases with wave number
        const reward = 50 + this.currentWave * 25;
        
        // Create the wave
        return {
            enemies: [
                { type: 'basic', count: basicCount, delay: Math.max(0.3, 1.5 - this.currentWave * 0.05) },
                { type: 'fast', count: fastCount, delay: Math.max(0.2, 1.0 - this.currentWave * 0.04) },
                { type: 'tank', count: tankCount, delay: Math.max(0.5, 3.0 - this.currentWave * 0.1) },
                { type: 'boss', count: bossCount, delay: 0 }
            ].filter(e => e.count > 0), // Only include enemy types with count > 0
            reward: reward
        };
    }

    /**
     * Update the wave manager
     * @param deltaTime Time elapsed since last update in seconds
     */
    public update(deltaTime: number): void {
        // Update all parallel waves
        this.updateParallelWaves(deltaTime);

        // If no wave is in progress, check if we should start one
        if (!this.waveInProgress) {
            // If all enemies are defeated, increment auto-wave timer
            if (this.enemyManager.getEnemyCount() === 0 && this.currentWave > 0) {
                this.autoWaveTimer += deltaTime;
                
                // Start next wave automatically after delay
                if (this.autoWaveTimer >= this.autoWaveDelay) {
                    console.log(`Auto-starting next wave after ${this.autoWaveDelay} seconds`);
                    this.startNextWave();
                    this.autoWaveTimer = 0;
                    return;
                }
            }
            
            return;
        }
        
        // Reset auto-wave timer when a wave is in progress
        this.autoWaveTimer = 0;
        
        // If there are no enemies left to spawn and no enemies on the map, complete the wave
        if (this.enemiesLeftToSpawn.length === 0 && this.enemyManager.getEnemyCount() === 0) {
            this.completeWave();
            return;
        }
        
        // If there are no enemies left to spawn, just return and wait for existing enemies to be defeated
        if (this.enemiesLeftToSpawn.length === 0) {
            return;
        }
        
        // Update spawn timer
        this.timeSinceLastSpawn += deltaTime;
        
        // Check if it's time to spawn the next enemy
        if (this.timeSinceLastSpawn >= this.enemiesLeftToSpawn[0].delay) {
            // Spawn the enemy
            const enemyType = this.enemiesLeftToSpawn[0].type;
            const enemy = this.enemyManager.createEnemy(enemyType);
            
            // Apply difficulty multiplier to enemy stats
            if (this.difficultyMultiplier > 1.0) {
                enemy.applyDifficultyMultiplier(this.difficultyMultiplier);
            }
            
            // Remove from queue
            this.enemiesLeftToSpawn.shift();
            
            // Reset timer
            this.timeSinceLastSpawn = 0;
            
            // If we still have enemies to spawn and the next one has zero delay, spawn it immediately
            if (this.enemiesLeftToSpawn.length > 0 && this.enemiesLeftToSpawn[0].delay === 0) {
                this.timeSinceLastSpawn = Number.MAX_VALUE; // Force immediate spawn on next update
            }
        }
    }

    /**
     * Update all parallel waves
     * @param deltaTime Time elapsed since last update in seconds
     */
    private updateParallelWaves(deltaTime: number): void {
        // Update each parallel wave and filter out completed ones
        const completedWaves: ParallelWave[] = [];
        
        for (const wave of this.parallelWaves) {
            const completed = wave.update(deltaTime);
            if (completed) {
                completedWaves.push(wave);
            }
        }
        
        // Remove completed waves and give rewards
        for (const wave of completedWaves) {
            // Give reward for completing the wave
            this.playerStats.addMoney(wave.getReward());
            console.log(`Completed parallel wave ${wave.getWaveNumber()}, reward: ${wave.getReward()}`);
            
            // Remove from array
            const index = this.parallelWaves.indexOf(wave);
            if (index !== -1) {
                this.parallelWaves.splice(index, 1);
            }
        }
    }

    /**
     * Start the next wave
     * @returns True if wave was started, false if all waves are complete
     */
    public startNextWave(): boolean {
        // Reset auto-wave timer
        this.autoWaveTimer = 0;
        
        // Get the next wave to spawn
        let wave: Wave;
        if (this.currentWave < this.waves.length) {
            wave = this.waves[this.currentWave];
        } else {
            wave = this.generateNextWave();
        }
        
        // Prepare enemies to spawn
        const newEnemies: { type: string, delay: number }[] = [];
        for (const enemyGroup of wave.enemies) {
            for (let i = 0; i < enemyGroup.count; i++) {
                newEnemies.push({
                    type: enemyGroup.type,
                    delay: enemyGroup.delay
                });
            }
        }
        
        // Create a new parallel wave
        const parallelWave = new ParallelWave(
            this.enemyManager,
            newEnemies,
            this.currentWave + 1,
            wave.reward
        );
        
        // Add to parallel waves array
        this.parallelWaves.push(parallelWave);
        
        console.log(`Starting parallel wave ${this.currentWave + 1} with ${newEnemies.length} enemies`);
        
        // Set wave in progress flag if this is the first wave
        if (!this.waveInProgress) {
            this.waveInProgress = true;
        }
        
        // Increment the current wave counter
        this.currentWave++;
        
        return true;
    }

    /**
     * Complete the current wave
     */
    private completeWave(): void {
        if (!this.waveInProgress) {
            return;
        }
        
        // Mark wave as complete
        this.waveInProgress = false;
        
        // Reset auto-wave timer to start counting for next auto-wave
        this.autoWaveTimer = 0;
        
        // Debug log to confirm wave completion
        console.log(`Main wave completed. Ready for wave ${this.currentWave + 1}. Auto-wave in ${this.autoWaveDelay} seconds.`);
    }

    /**
     * Check if all waves have been completed
     * @returns True if all waves are complete
     */
    public isAllWavesCompleted(): boolean {
        // We now have infinite waves, so this will always return false
        return false;
    }

    /**
     * Get the current wave number (1-based)
     * @returns The current wave number
     */
    public getCurrentWave(): number {
        return this.currentWave + 1;
    }

    /**
     * Get the total number of waves
     * @returns The total number of waves
     */
    public getTotalWaves(): number {
        return this.totalWaves;
    }

    /**
     * Check if a wave is currently in progress
     * @returns True if a wave is in progress
     */
    public isWaveInProgress(): boolean {
        return this.waveInProgress;
    }

    /**
     * Get the current difficulty multiplier
     * @returns The difficulty multiplier
     */
    public getDifficultyMultiplier(): number {
        return this.difficultyMultiplier;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        // Clear all parallel waves
        this.parallelWaves = [];
        
        // Reset all state variables
        this.waveInProgress = false;
        this.enemiesLeftToSpawn = [];
        this.timeSinceLastSpawn = 0;
        this.currentWave = 0;
        this.autoWaveTimer = 0;
        this.difficultyMultiplier = 1.0;
        
        console.log('WaveManager disposed and reset');
    }

    /**
     * Get the time remaining until auto-wave starts
     * @returns Time in seconds until next auto-wave, or 0 if no auto-wave is pending
     */
    public getAutoWaveTimeRemaining(): number {
        if (this.waveInProgress || this.enemyManager.getEnemyCount() > 0 || this.currentWave === 0) {
            return 0;
        }
        return Math.max(0, this.autoWaveDelay - this.autoWaveTimer);
    }
} 