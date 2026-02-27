import { EnemyManager } from './EnemyManager';
import { PlayerStats } from './PlayerStats';
import { Enemy } from './enemies/Enemy';
import { WaveStatus } from './WaveStatus';

// Define a wave of enemies
interface Wave {
    enemies: {
        type: string;
        count: number;
        delay: number; // Delay between spawns in seconds
    }[];
    reward: number; // Bonus money for completing the wave
    name: string; // Display name for the wave
    description: string; // Flavor text / strategic hint
}

// Wave metadata for UI display
export interface WaveInfo {
    name: string;
    description: string;
    waveNumber: number;
    isBoss: boolean;
    isMilestone: boolean;
}

// Class to manage a single parallel wave
class ParallelWave {
    private enemyManager: EnemyManager;
    private enemiesLeftToSpawn: { type: string, delay: number }[] = [];
    private timeSinceLastSpawn: number = 0;
    private completed: boolean = false;
    private waveNumber: number;
    private reward: number;
    private difficultyMultiplier: number;

    constructor(enemyManager: EnemyManager, enemies: { type: string, delay: number }[], waveNumber: number, reward: number, difficultyMultiplier: number) {
        this.enemyManager = enemyManager;
        this.enemiesLeftToSpawn = [...enemies]; // Clone the array
        this.waveNumber = waveNumber;
        this.reward = reward;
        this.difficultyMultiplier = difficultyMultiplier;
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
            const enemy = this.enemyManager.createEnemy(enemyType);
            
            // Apply difficulty multiplier with special handling for boss type
            if (enemyType === 'boss') {
                const bossMultiplier = 3.0; // Reduced from 4.0 for fairer boss encounters
                enemy.applyDifficultyMultiplier(this.difficultyMultiplier * bossMultiplier);
                console.log(`Boss enemy created in parallel wave with ${(this.difficultyMultiplier * bossMultiplier).toFixed(2)}x difficulty`);
            } else {
                enemy.applyDifficultyMultiplier(this.difficultyMultiplier);
            }

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
    private difficultyMultiplier: number = 1.0;
    private autoWaveTimer: number = 0;
    private autoWaveDelay: number = 5;
    private parallelWaves: ParallelWave[] = [];
    private wavesPerLevel: number = 10;
    private levelIndex: number = 0;

    // Infinite mode tracking
    private absoluteWave: number = 0; // Total waves across all segments
    private segmentWave: number = 0; // 1-10 within current segment
    private segmentIndex: number = 0; // Which segment we're on
    private onSegmentComplete: (() => void) | null = null;

    // Speed-based difficulty system
    private waveStartTime: number = 0;
    private baseClearTime: number = 60;
    private minClearTime: number = 20;
    private speedMultiplierMax: number = 2.0;
    private speedMultiplier: number = 1.0;
    private lastWaveClearTime: number = 0;

    // Parallel wave difficulty system
    private parallelWaveMultiplier: number = 1.0;
    private maxParallelMultiplier: number = 1.3;

    // Perfect wave bonus tracking
    private healthAtWaveStart: number = 0;
    private consecutivePerfectWaves: number = 0;

    constructor(enemyManager: EnemyManager, playerStats: PlayerStats) {
        this.enemyManager = enemyManager;
        this.playerStats = playerStats;

        // Set player stats in enemy manager for rewards
        this.enemyManager.setPlayerStats(playerStats);

        // Generate Level 1 hand-crafted waves (first 10 waves)
        this.generateLevel1Waves();
        this.totalWaves = this.wavesPerLevel;
    }

    /**
     * Set the callback for when a segment's 10 waves are completed.
     */
    public setOnSegmentComplete(callback: () => void): void {
        this.onSegmentComplete = callback;
    }

    /**
     * Get the current segment index.
     */
    public getSegmentIndex(): number {
        return this.segmentIndex;
    }

    /**
     * Get the wave number within the current segment (1-10).
     */
    public getSegmentWave(): number {
        return this.segmentWave;
    }

    /**
     * Get the absolute wave number (total across all segments).
     */
    public getAbsoluteWave(): number {
        return this.absoluteWave;
    }

    // =================================================================
    // Level 1: "The Enchanted Forest" (tutorial → first boss)
    // =================================================================
    private generateLevel1Waves(): void {
        // Wave 1: First Contact
        this.waves.push({
            enemies: [{ type: 'basic', count: 5, delay: 2.5 }],
            reward: 50,
            name: 'First Contact',
            description: 'A small scouting party approaches. Place your first defenses.'
        });
        // Wave 2: The Trickle
        this.waves.push({
            enemies: [{ type: 'basic', count: 8, delay: 1.8 }],
            reward: 55,
            name: 'The Trickle',
            description: 'They keep coming. Make sure your towers cover the path.'
        });
        // Wave 3: Swift Shadows
        this.waves.push({
            enemies: [{ type: 'fast', count: 6, delay: 1.5 }],
            reward: 60,
            name: 'Swift Shadows',
            description: 'These ones are fast! You may need towers that can keep up.'
        });
        // Wave 4: First Mix
        this.waves.push({
            enemies: [
                { type: 'basic', count: 8, delay: 1.5 },
                { type: 'fast', count: 5, delay: 1.2 }
            ],
            reward: 70,
            name: 'First Mix',
            description: 'Different enemy types working together. Diversify your defenses.'
        });
        // Wave 5: The Wall
        this.waves.push({
            enemies: [
                { type: 'basic', count: 6, delay: 1.4 },
                { type: 'tank', count: 2, delay: 4.0 }
            ],
            reward: 100,
            name: 'The Wall',
            description: 'Armored enemies! They are slow but very tough. Focus fire on them.'
        });
        // Wave 6: Speed Demons
        this.waves.push({
            enemies: [
                { type: 'fast', count: 10, delay: 0.9 },
                { type: 'basic', count: 4, delay: 1.5 }
            ],
            reward: 80,
            name: 'Speed Demons',
            description: 'A swarm of fast enemies! Slow towers and area damage shine here.'
        });
        // Wave 7: Combined Arms
        this.waves.push({
            enemies: [
                { type: 'basic', count: 10, delay: 1.2 },
                { type: 'fast', count: 6, delay: 1.0 },
                { type: 'tank', count: 3, delay: 3.0 }
            ],
            reward: 100,
            name: 'Combined Arms',
            description: 'All enemy types at once. A balanced defense is your best weapon.'
        });
        // Wave 8: The Swarm
        this.waves.push({
            enemies: [
                { type: 'basic', count: 16, delay: 0.7 },
                { type: 'fast', count: 8, delay: 0.6 }
            ],
            reward: 90,
            name: 'The Swarm',
            description: 'Overwhelming numbers! Area damage towers earn their keep here.'
        });
        // Wave 9: Iron March
        this.waves.push({
            enemies: [
                { type: 'basic', count: 8, delay: 1.0 },
                { type: 'tank', count: 6, delay: 2.0 },
                { type: 'fast', count: 4, delay: 1.0 }
            ],
            reward: 110,
            name: 'Iron March',
            description: 'Heavy armor incoming. Build up your strongest towers - a boss approaches.'
        });
        // Wave 10: THE WARLORD (boss)
        this.waves.push({
            enemies: [
                { type: 'basic', count: 6, delay: 0.9 },
                { type: 'fast', count: 4, delay: 0.8 },
                { type: 'tank', count: 2, delay: 2.5 },
                { type: 'boss', count: 1, delay: 0 }
            ],
            reward: 200,
            name: 'THE WARLORD',
            description: 'A massive boss enemy appears! Defeat it to advance to the next realm!'
        });
    }

    // =================================================================
    // Level 2: "The Scorched Highlands" (tank-heavy, harder)
    // =================================================================
    private generateLevel2Waves(): void {
        // Wave 1: Highland Scouts
        this.waves.push({
            enemies: [
                { type: 'basic', count: 10, delay: 1.5 },
                { type: 'fast', count: 4, delay: 1.2 }
            ],
            reward: 70,
            name: 'Highland Scouts',
            description: 'Enemies probe the scorched highlands. Set up your new defenses.'
        });
        // Wave 2: Armored Vanguard
        this.waves.push({
            enemies: [
                { type: 'tank', count: 4, delay: 2.5 },
                { type: 'basic', count: 6, delay: 1.0 }
            ],
            reward: 80,
            name: 'Armored Vanguard',
            description: 'Tanks lead the advance through the rocky terrain.'
        });
        // Wave 3: Blitz Runners
        this.waves.push({
            enemies: [
                { type: 'fast', count: 14, delay: 0.6 },
                { type: 'basic', count: 4, delay: 1.0 }
            ],
            reward: 75,
            name: 'Blitz Runners',
            description: 'Fast enemies exploit the new paths. Cover every angle!'
        });
        // Wave 4: Steel Tide
        this.waves.push({
            enemies: [
                { type: 'tank', count: 6, delay: 1.8 },
                { type: 'fast', count: 8, delay: 0.7 },
                { type: 'basic', count: 6, delay: 1.0 }
            ],
            reward: 100,
            name: 'Steel Tide',
            description: 'A combined force pushes hard through the highlands.'
        });
        // Wave 5: Scorched Earth
        this.waves.push({
            enemies: [
                { type: 'basic', count: 18, delay: 0.5 },
                { type: 'fast', count: 10, delay: 0.4 }
            ],
            reward: 110,
            name: 'Scorched Earth',
            description: 'Masses of enemies pour in. Area damage is critical!'
        });
        // Wave 6: Iron Fortress
        this.waves.push({
            enemies: [
                { type: 'tank', count: 10, delay: 1.5 },
                { type: 'basic', count: 8, delay: 0.8 }
            ],
            reward: 120,
            name: 'Iron Fortress',
            description: 'A wall of armored enemies. You need heavy firepower.'
        });
        // Wave 7: Lightning Assault
        this.waves.push({
            enemies: [
                { type: 'fast', count: 18, delay: 0.35 },
                { type: 'tank', count: 4, delay: 2.0 }
            ],
            reward: 130,
            name: 'Lightning Assault',
            description: 'Speed and armor in deadly combination.'
        });
        // Wave 8: Full Assault
        this.waves.push({
            enemies: [
                { type: 'basic', count: 14, delay: 0.6 },
                { type: 'fast', count: 12, delay: 0.4 },
                { type: 'tank', count: 8, delay: 1.2 }
            ],
            reward: 150,
            name: 'Full Assault',
            description: 'Everything at once. Only the strongest defenses will hold.'
        });
        // Wave 9: Siege Preparations
        this.waves.push({
            enemies: [
                { type: 'tank', count: 12, delay: 1.0 },
                { type: 'fast', count: 10, delay: 0.5 },
                { type: 'basic', count: 10, delay: 0.7 }
            ],
            reward: 160,
            name: 'Siege Preparations',
            description: 'The enemy amasses its forces. The siege engine approaches...'
        });
        // Wave 10: THE SIEGE ENGINE (boss)
        this.waves.push({
            enemies: [
                { type: 'tank', count: 6, delay: 1.5 },
                { type: 'basic', count: 10, delay: 0.6 },
                { type: 'fast', count: 8, delay: 0.5 },
                { type: 'boss', count: 1, delay: 0 }
            ],
            reward: 300,
            name: 'THE SIEGE ENGINE',
            description: 'A massive siege engine leads the assault! Destroy it to descend deeper!'
        });
    }

    // =================================================================
    // Level 3: "The Crystal Abyss" (maximum intensity, double boss)
    // =================================================================
    private generateLevel3Waves(): void {
        // Wave 1: Abyssal Scouts
        this.waves.push({
            enemies: [
                { type: 'basic', count: 14, delay: 1.0 },
                { type: 'fast', count: 8, delay: 0.8 },
                { type: 'tank', count: 3, delay: 2.5 }
            ],
            reward: 100,
            name: 'Abyssal Scouts',
            description: 'Enemies emerge from the crystal depths. The final battle begins.'
        });
        // Wave 2: Crystal Swarm
        this.waves.push({
            enemies: [
                { type: 'fast', count: 20, delay: 0.35 },
                { type: 'basic', count: 8, delay: 0.7 }
            ],
            reward: 110,
            name: 'Crystal Swarm',
            description: 'A crystalline swarm of speed. Cover every path!'
        });
        // Wave 3: Abyssal Tanks
        this.waves.push({
            enemies: [
                { type: 'tank', count: 10, delay: 1.5 },
                { type: 'basic', count: 10, delay: 0.8 }
            ],
            reward: 120,
            name: 'Abyssal Tanks',
            description: 'Heavily armored crystal beasts push through the abyss.'
        });
        // Wave 4: Dual Threat
        this.waves.push({
            enemies: [
                { type: 'fast', count: 16, delay: 0.3 },
                { type: 'tank', count: 8, delay: 1.2 },
                { type: 'basic', count: 10, delay: 0.6 }
            ],
            reward: 140,
            name: 'Dual Threat',
            description: 'Speed and armor attack simultaneously from the crystal corridors.'
        });
        // Wave 5: The Flood
        this.waves.push({
            enemies: [
                { type: 'basic', count: 24, delay: 0.35 },
                { type: 'fast', count: 16, delay: 0.25 },
                { type: 'tank', count: 4, delay: 2.0 }
            ],
            reward: 160,
            name: 'The Flood',
            description: 'A tidal wave of enemies. If your defenses have gaps, they will find them.'
        });
        // Wave 6: Crystal Guard
        this.waves.push({
            enemies: [
                { type: 'tank', count: 14, delay: 1.0 },
                { type: 'fast', count: 10, delay: 0.5 },
                { type: 'basic', count: 8, delay: 0.7 }
            ],
            reward: 170,
            name: 'Crystal Guard',
            description: 'The abyss sends its elite guard. Maximum firepower required.'
        });
        // Wave 7: Abyssal Blitz
        this.waves.push({
            enemies: [
                { type: 'fast', count: 24, delay: 0.2 },
                { type: 'basic', count: 12, delay: 0.5 }
            ],
            reward: 150,
            name: 'Abyssal Blitz',
            description: 'Unstoppable speed. Every tower must be perfectly placed.'
        });
        // Wave 8: Annihilation
        this.waves.push({
            enemies: [
                { type: 'basic', count: 20, delay: 0.4 },
                { type: 'fast', count: 16, delay: 0.3 },
                { type: 'tank', count: 12, delay: 1.0 }
            ],
            reward: 200,
            name: 'Annihilation',
            description: 'The full might of the abyss. Everything comes at once.'
        });
        // Wave 9: Last Stand
        this.waves.push({
            enemies: [
                { type: 'basic', count: 18, delay: 0.4 },
                { type: 'fast', count: 14, delay: 0.25 },
                { type: 'tank', count: 14, delay: 0.9 }
            ],
            reward: 225,
            name: 'Last Stand',
            description: 'One final test before the end. Hold the line at all costs.'
        });
        // Wave 10: THE FINAL SIEGE (double boss)
        this.waves.push({
            enemies: [
                { type: 'basic', count: 14, delay: 0.5 },
                { type: 'fast', count: 12, delay: 0.3 },
                { type: 'tank', count: 8, delay: 1.2 },
                { type: 'boss', count: 2, delay: 8.0 }
            ],
            reward: 500,
            name: 'THE FINAL SIEGE',
            description: 'Two bosses lead the ultimate assault. This is it - give everything you have!'
        });
    }

    /**
     * Generate a procedural wave for endless mode (wave 21+).
     * Uses rotating themes so endless mode stays varied and interesting.
     *
     * Theme rotation (cycles every 5 waves):
     *   +1: Swarm (many weak enemies, fast spawns)
     *   +2: Armored (tank-heavy with escorts)
     *   +3: Blitz (fast-heavy, tight timing)
     *   +4: Mixed Assault (balanced high-count)
     *   +5: Boss Wave (boss + escort, milestone reward)
     *
     * Scaling uses diminishing returns so it stays challenging but not impossible:
     *   Enemy count grows logarithmically after wave 30
     *   Spawn delays have a floor to prevent impossible overlap
     *   Rewards scale to keep economy viable
     *
     * @returns The generated wave
     */
    private generateNextWave(): Wave {
        const waveNum = this.absoluteWave;
        // How far past the hand-crafted waves we are (1, 2, 3, ...)
        const endlessIndex = Math.max(1, waveNum - 10);
        // Theme cycles every 5 waves
        const themeIndex = ((endlessIndex - 1) % 5) + 1;
        // Scaling factor: grows but with diminishing returns
        const scaleFactor = 1.0 + Math.log2(1 + endlessIndex * 0.5);

        // Base counts scaled by the factor
        let basicCount: number, fastCount: number, tankCount: number, bossCount: number;
        let basicDelay: number, fastDelay: number, tankDelay: number;
        let reward: number;
        let name: string, description: string;

        switch (themeIndex) {
            case 1: // Swarm
                basicCount = Math.floor(18 * scaleFactor);
                fastCount = Math.floor(12 * scaleFactor);
                tankCount = Math.floor(2 * scaleFactor);
                bossCount = 0;
                basicDelay = Math.max(0.25, 0.5 / scaleFactor);
                fastDelay = Math.max(0.2, 0.4 / scaleFactor);
                tankDelay = 2.0;
                reward = Math.floor(120 * scaleFactor);
                name = `Endless Swarm ${endlessIndex}`;
                description = 'They just keep coming. Hold the line!';
                break;

            case 2: // Armored
                basicCount = Math.floor(8 * scaleFactor);
                fastCount = Math.floor(6 * scaleFactor);
                tankCount = Math.floor(10 * scaleFactor);
                bossCount = 0;
                basicDelay = 0.8;
                fastDelay = 0.7;
                tankDelay = Math.max(0.8, 1.5 / scaleFactor);
                reward = Math.floor(140 * scaleFactor);
                name = `Iron Tide ${endlessIndex}`;
                description = 'Wave after wave of armored foes. Raw firepower is key.';
                break;

            case 3: // Blitz
                basicCount = Math.floor(6 * scaleFactor);
                fastCount = Math.floor(20 * scaleFactor);
                tankCount = Math.floor(3 * scaleFactor);
                bossCount = 0;
                basicDelay = 0.8;
                fastDelay = Math.max(0.15, 0.35 / scaleFactor);
                tankDelay = 1.5;
                reward = Math.floor(130 * scaleFactor);
                name = `Lightning Raid ${endlessIndex}`;
                description = 'Blink and they are past your defenses. Speed kills.';
                break;

            case 4: // Mixed Assault
                basicCount = Math.floor(14 * scaleFactor);
                fastCount = Math.floor(12 * scaleFactor);
                tankCount = Math.floor(8 * scaleFactor);
                bossCount = 0;
                basicDelay = Math.max(0.3, 0.6 / scaleFactor);
                fastDelay = Math.max(0.2, 0.4 / scaleFactor);
                tankDelay = Math.max(0.8, 1.3 / scaleFactor);
                reward = Math.floor(160 * scaleFactor);
                name = `Total War ${endlessIndex}`;
                description = 'The full might of the enemy, all at once.';
                break;

            case 5: // Boss Wave
                basicCount = Math.floor(10 * scaleFactor);
                fastCount = Math.floor(8 * scaleFactor);
                tankCount = Math.floor(5 * scaleFactor);
                // Boss count scales slowly: 1 at first, then +1 every 10 endless waves
                bossCount = 1 + Math.floor(endlessIndex / 10);
                basicDelay = 0.6;
                fastDelay = 0.5;
                tankDelay = 1.5;
                reward = Math.floor(250 * scaleFactor);
                name = `BOSS - Endless ${endlessIndex}`;
                description = 'A titanic foe emerges from the endless horde!';
                break;

            default:
                basicCount = Math.floor(12 * scaleFactor);
                fastCount = Math.floor(8 * scaleFactor);
                tankCount = Math.floor(4 * scaleFactor);
                bossCount = 0;
                basicDelay = 0.6;
                fastDelay = 0.5;
                tankDelay = 1.5;
                reward = Math.floor(100 * scaleFactor);
                name = `Wave ${waveNum}`;
                description = 'The battle continues.';
                break;
        }

        // Create the wave with filtered enemy types
        return {
            enemies: [
                { type: 'basic', count: basicCount, delay: basicDelay },
                { type: 'fast', count: fastCount, delay: fastDelay },
                { type: 'tank', count: tankCount, delay: tankDelay },
                { type: 'boss', count: bossCount, delay: 8.0 }
            ].filter(e => e.count > 0),
            reward: reward,
            name: name,
            description: description
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
            const enemy = this.createEnemyWithDifficulty(enemyType);
            
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
        
        // Calculate parallel wave multiplier based on number of active waves
        // More parallel waves = higher multiplier
        const activeWaveCount = this.parallelWaves.length;
        if (activeWaveCount > 1) {
            // Each additional wave adds 20% to the multiplier (1.0, 1.2, 1.4, 1.6, 1.8, 2.0)
            this.parallelWaveMultiplier = Math.min(1.0 + (activeWaveCount - 1) * 0.2, this.maxParallelMultiplier);
            console.log(`Parallel wave multiplier: ${this.parallelWaveMultiplier.toFixed(2)}x (${activeWaveCount} active waves)`);
        } else {
            this.parallelWaveMultiplier = 1.0;
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
     * Create a parallel wave with the specified enemies
     * This is a public method that can be called from outside to create additional parallel waves
     * @param enemies The enemies to spawn in this wave
     * @param reward The reward for completing this wave
     * @returns True if the wave was created successfully
     */
    public createParallelWave(enemies: { type: string, count: number, delay: number }[], reward: number): boolean {
        // If no wave is in progress, start a regular wave instead
        if (!this.waveInProgress) {
            console.log("No wave in progress. Start a regular wave first.");
            return false;
        }
        
        // Convert the wave format to a flat list of enemies with delays
        const enemiesFlat: { type: string, delay: number }[] = [];
        for (const enemyGroup of enemies) {
            for (let i = 0; i < enemyGroup.count; i++) {
                enemiesFlat.push({
                    type: enemyGroup.type,
                    delay: enemyGroup.delay
                });
            }
        }
        
        // Create a new parallel wave using the private helper method
        this._createParallelWave(
            enemiesFlat,
            this.currentWave,
            reward
        );
        
        console.log(`Created additional parallel wave with ${enemiesFlat.length} enemies`);
        
        // Recalculate the parallel wave multiplier
        const activeWaveCount = this.parallelWaves.length;
        this.parallelWaveMultiplier = Math.min(1.0 + (activeWaveCount - 1) * 0.2, this.maxParallelMultiplier);
        console.log(`Parallel wave multiplier increased to ${this.parallelWaveMultiplier.toFixed(2)}x (${activeWaveCount} active waves)`);
        
        return true;
    }

    /**
     * Create a parallel wave (private implementation)
     * @param enemies The enemies to spawn in this wave
     * @param waveNumber The wave number
     * @param reward The reward for completing this wave
     * @returns The created parallel wave
     */
    private _createParallelWave(enemies: { type: string, delay: number }[], waveNumber: number, reward: number): ParallelWave {
        // Update the parallel wave multiplier based on how many waves will be active
        const activeWaveCount = this.parallelWaves.length + 1; // +1 for the wave we're about to create
        if (activeWaveCount > 1) {
            this.parallelWaveMultiplier = Math.min(1.0 + (activeWaveCount - 1) * 0.2, this.maxParallelMultiplier);
        } else {
            this.parallelWaveMultiplier = 1.0;
        }
        
        // Calculate the effective difficulty with all multipliers
        const effectiveDifficulty = Math.min(
            this.difficultyMultiplier * this.speedMultiplier * this.parallelWaveMultiplier,
            20.0
        );
        
        // Create a new parallel wave with the effective difficulty multiplier
        const parallelWave = new ParallelWave(
            this.enemyManager,
            enemies,
            waveNumber,
            reward,
            effectiveDifficulty // Use the combined difficulty
        );
        
        // Add to parallel waves array
        this.parallelWaves.push(parallelWave);
        
        console.log(`Created parallel wave with difficulty ${effectiveDifficulty.toFixed(2)}x (base: ${this.difficultyMultiplier.toFixed(2)}x, speed: ${this.speedMultiplier.toFixed(2)}x, parallel: ${this.parallelWaveMultiplier.toFixed(2)}x)`);
        
        return parallelWave;
    }

    /**
     * Start the next wave
     * @returns True if a new wave was started
     */
    public startNextWave(): boolean {
        // Reset auto-wave timer
        this.autoWaveTimer = 0;

        // If a wave is already in progress, return false
        if (this.waveInProgress) {
            return false;
        }

        // Increment wave counters
        this.currentWave++;
        this.absoluteWave++;
        this.segmentWave++;

        // Store the wave start time for speed-based difficulty
        this.waveStartTime = performance.now() / 1000;

        // Record health at wave start for perfect wave detection
        this.healthAtWaveStart = this.playerStats.getHealth();

        // Difficulty scales continuously using absolute wave number
        const w = this.absoluteWave - 1;
        this.difficultyMultiplier = 1.0 + 0.12 * w + 0.004 * w * w;

        // Milestone waves (every 5): apply a small bump (+15% on top of the formula)
        // This creates noticeable-but-fair difficulty spikes at milestone waves
        const isMilestone = this.currentWave % 5 === 0;
        if (isMilestone) {
            this.difficultyMultiplier *= 1.15;
            console.log(`%c MILESTONE WAVE ${this.currentWave}! Difficulty: ${this.difficultyMultiplier.toFixed(2)}x %c`,
                'background: #ff5500; color: #fff; font-size: 18px; font-weight: bold; padding: 4px 8px;',
                'background: none; color: inherit;');
        }

        // Cap effective difficulty to prevent impossible scaling
        // With the new formula: Wave 20 base ~5.5x, with speed/parallel max ~14x
        const effectiveDifficulty = Math.min(this.difficultyMultiplier * this.speedMultiplier * this.parallelWaveMultiplier, 20.0);
        console.log(`Wave ${this.currentWave}: Difficulty set to ${effectiveDifficulty.toFixed(2)}x (base: ${this.difficultyMultiplier.toFixed(2)}x, speed: ${this.speedMultiplier.toFixed(2)}x, parallel: ${this.parallelWaveMultiplier.toFixed(2)}x)`);
        
        // Get the current wave: use hand-crafted waves for first 10, then procedural
        let wave: Wave;
        if (this.absoluteWave <= this.waves.length) {
            wave = this.waves[this.absoluteWave - 1];
        } else {
            // Generate a procedural wave
            wave = this.generateNextWave();
            this.waves.push(wave);
        }
        
        // Check if this is a boss wave
        const isBossWave = wave.enemies.some(enemy => enemy.type === 'boss' && enemy.count > 0);
        if (isBossWave) {
            console.log(`%c BOSS WAVE ${this.currentWave}! Boss enemies are 10x stronger! %c`, 
                'background: #f00; color: #fff; font-size: 16px; font-weight: bold; padding: 4px 8px;',
                'background: none; color: inherit;');
        }
        
        // Set up the enemies to spawn
        this.enemiesLeftToSpawn = [];
        
        // Convert the wave format to a flat list of enemies with delays
        for (const enemyGroup of wave.enemies) {
            for (let i = 0; i < enemyGroup.count; i++) {
                this.enemiesLeftToSpawn.push({
                    type: enemyGroup.type,
                    delay: enemyGroup.delay
                });
            }
        }
        
        // Set wave in progress
        this.waveInProgress = true;
        
        // Reset spawn timer
        this.timeSinceLastSpawn = 0;
        
        // Clear any existing parallel waves
        this.parallelWaves = [];
        
        // Create a new parallel wave using the helper method
        this._createParallelWave(
            this.enemiesLeftToSpawn,
            this.currentWave,
            wave.reward
        );
        
        console.log(`Starting wave ${this.currentWave} with ${this.enemiesLeftToSpawn.length} enemies`);
        
        return true;
    }
    
    /**
     * Complete the current wave.
     * Handles:
     * - Speed multiplier update
     * - Perfect wave bonus (no health lost)
     * - Consecutive perfect wave streak bonus
     * - Economy scaling for later waves
     */
    private completeWave(): void {
        if (!this.waveInProgress) {
            return;
        }

        // Mark wave as complete
        this.waveInProgress = false;

        // Calculate time taken to clear the wave
        const currentTime = performance.now() / 1000; // Convert to seconds
        this.lastWaveClearTime = currentTime - this.waveStartTime;

        // Update speed multiplier based on clear time
        this.updateSpeedMultiplier(this.lastWaveClearTime);

        // Reset parallel wave multiplier as all waves are now complete
        this.parallelWaveMultiplier = 1.0;

        // === PERFECT WAVE BONUS ===
        // If the player took no damage during this wave, reward them.
        // This encourages clean play without punishing mistakes too harshly.
        const currentHealth = this.playerStats.getHealth();
        const isPerfect = currentHealth >= this.healthAtWaveStart;

        if (isPerfect) {
            this.consecutivePerfectWaves++;
            this.playerStats.addPerfectWave();

            // Perfect wave bonus: 25 base + 10 per consecutive perfect wave (capped at +50)
            const perfectBonus = 25 + Math.min(this.consecutivePerfectWaves * 10, 50);
            this.playerStats.addMoney(perfectBonus);

            // Heal 5 HP for a perfect wave (small sustain reward)
            this.playerStats.heal(5);

            console.log(`%c PERFECT WAVE! +$${perfectBonus} bonus (${this.consecutivePerfectWaves} streak). +5 HP healed. %c`,
                'background: #4CAF50; color: #fff; font-size: 14px; font-weight: bold; padding: 2px 6px;',
                'background: none; color: inherit;');
        } else {
            // Reset the streak
            this.consecutivePerfectWaves = 0;
        }

        // Reset auto-wave timer to start counting for next auto-wave
        this.autoWaveTimer = 0;

        // Notify player stats of wave completion
        this.playerStats.addWaveCompleted();

        // Debug log to confirm wave completion
        console.log(`Wave ${this.absoluteWave} (segment ${this.segmentIndex + 1}, wave ${this.segmentWave}/10) completed in ${this.lastWaveClearTime.toFixed(2)} seconds. Speed multiplier: ${this.speedMultiplier.toFixed(2)}x.`);

        // Check if we've completed waves in this segment (1 wave per segment for testing)
        if (this.segmentWave >= 1 && this.onSegmentComplete) {
            this.segmentWave = 0;
            this.segmentIndex++;
            this.onSegmentComplete();
        }
    }
    
    /**
     * Update the speed multiplier based on clear time.
     *
     * Design: The speed multiplier rewards skilled play without punishing it.
     * - Clearing faster than expected gives a modest boost (up to 2.0x max)
     * - Clearing slower than expected brings the multiplier back toward 1.0
     * - The transition is heavily smoothed (80% old, 20% new) to prevent jarring swings
     * - The multiplier can also DECREASE if the player is struggling (clears slowly)
     *
     * This means skilled players face slightly harder enemies but also get better
     * rewards (since reward scales with difficulty multiplier in Enemy.applyDifficultyMultiplier).
     *
     * @param clearTime Time taken to clear the wave in seconds
     */
    private updateSpeedMultiplier(clearTime: number): void {
        // Adjusted base clear time accounts for wave length increasing
        const adjustedBaseClearTime = this.baseClearTime * (1 + (this.currentWave - 1) * 0.08);
        const clearSpeed = adjustedBaseClearTime / Math.max(clearTime, this.minClearTime);

        // Map clear speed to a multiplier:
        //   clearSpeed < 1.0 (slow clear): multiplier trends toward 1.0 (easier)
        //   clearSpeed = 1.0 (normal): multiplier stays around 1.0
        //   clearSpeed > 1.0 (fast clear): multiplier trends toward max
        // Use sqrt to dampen the effect of very fast clears
        const targetMultiplier = Math.min(1.0 + Math.sqrt(Math.max(0, clearSpeed - 0.5)) * 0.5, this.speedMultiplierMax);

        // Heavy smoothing: 80% old value, 20% new value
        // This prevents a single fast or slow wave from dramatically changing difficulty
        this.speedMultiplier = this.speedMultiplier * 0.8 + targetMultiplier * 0.2;

        // Clamp to valid range (allow it to go below 1.0 down to 0.85 as a "mercy" mechanic)
        this.speedMultiplier = Math.max(0.85, Math.min(this.speedMultiplier, this.speedMultiplierMax));

        console.log(`Wave clear speed: ${clearSpeed.toFixed(2)}x baseline. Target multiplier: ${targetMultiplier.toFixed(2)}x. New speed multiplier: ${this.speedMultiplier.toFixed(2)}x`);
    }
    
    /**
     * Get the current speed multiplier
     * @returns The current speed multiplier
     */
    public getSpeedMultiplier(): number {
        return this.speedMultiplier;
    }
    
    /**
     * Get the effective difficulty multiplier (base * speed * parallel, capped at 20x)
     * @returns The effective difficulty multiplier
     */
    public getEffectiveDifficultyMultiplier(): number {
        return Math.min(this.difficultyMultiplier * this.speedMultiplier * this.parallelWaveMultiplier, 20.0);
    }

    /**
     * Check if all waves have been completed
     * @returns True if all waves are complete
     */
    public isAllWavesCompleted(): boolean {
        // Infinite mode: never "all completed"
        return false;
    }

    /**
     * Get the current wave number (1-based)
     * @returns The current wave number
     */
    public getCurrentWave(): number {
        return this.absoluteWave;
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
        this.absoluteWave = 0;
        this.segmentWave = 0;
        this.segmentIndex = 0;
        this.autoWaveTimer = 0;
        this.difficultyMultiplier = 1.0;
        this.speedMultiplier = 1.0;
        this.parallelWaveMultiplier = 1.0;
        this.lastWaveClearTime = 0;
        this.waveStartTime = 0;
        this.healthAtWaveStart = 0;
        this.consecutivePerfectWaves = 0;
        this.onSegmentComplete = null;

        console.log('WaveManager disposed and reset');
    }

    /**
     * Get the time remaining until auto-wave starts
     * @returns Time in seconds until next auto-wave, or 0 if no auto-wave is pending
     */
    public getAutoWaveTimeRemaining(): number {
        if (this.waveInProgress || this.enemyManager.getEnemyCount() > 0 || this.absoluteWave === 0) {
            return 0;
        }
        return Math.max(0, this.autoWaveDelay - this.autoWaveTimer);
    }

    /**
     * Create enemy with current difficulty applied.
     *
     * Boss multiplier rationale:
     * - Boss base stats are already 500 HP / 50 dmg / 150 reward (vs basic's 30/10/10)
     * - The boss class also applies its own 1.1x internal multiplier
     * - So a 3.0x boss multiplier at wave 10 (base ~2.5x) gives:
     *   Effective = 2.5 * 3.0 * 1.1 = ~8.25x on top of 500 HP = ~4125 HP
     * - This feels tough but killable with a well-built defense
     *
     * @param type The type of enemy to create
     * @returns The created enemy
     */
    private createEnemyWithDifficulty(type: string): Enemy {
        // Create the enemy
        const enemy = this.enemyManager.createEnemy(type);

        // Calculate the effective difficulty multiplier (capped at 20x)
        const effectiveDifficulty = Math.min(
            this.difficultyMultiplier * this.speedMultiplier * this.parallelWaveMultiplier,
            20.0
        );

        // Bosses get a 3.0x multiplier on top of effective difficulty (reduced from 4.0x)
        // Boss class also has its own 1.1x internal scaling, so total is ~3.3x effective
        if (type === 'boss') {
            const bossMultiplier = 3.0;
            enemy.applyDifficultyMultiplier(effectiveDifficulty * bossMultiplier);
            console.log(`Boss enemy created with ${(effectiveDifficulty * bossMultiplier).toFixed(2)}x difficulty`);
        } else {
            enemy.applyDifficultyMultiplier(effectiveDifficulty);
        }

        return enemy;
    }

    /**
     * Get the time when the current wave started in seconds
     * @returns The wave start time in seconds
     */
    public getWaveStartTime(): number {
        return this.waveStartTime;
    }
    
    /**
     * Get the base time expected to clear a wave
     * @returns The base clear time in seconds
     */
    public getBaseClearTime(): number {
        // Adjust base clear time based on wave number
        return this.baseClearTime * (1 + (this.currentWave - 1) * 0.1);
    }
    
    /**
     * Get the time taken to clear the last wave
     * @returns The last wave clear time in seconds
     */
    public getLastWaveClearTime(): number {
        return this.lastWaveClearTime;
    }

    /**
     * Get the parallel wave multiplier
     * @returns The current parallel wave multiplier
     */
    public getParallelWaveMultiplier(): number {
        return this.parallelWaveMultiplier;
    }

    /**
     * Get the number of active parallel waves
     * @returns The number of active parallel waves
     */
    public getActiveParallelWaveCount(): number {
        return this.parallelWaves.length;
    }

    /**
     * Check if the current wave is a boss wave
     * @returns True if the current wave contains a boss enemy
     */
    public isBossWave(): boolean {
        // Check if we have a predefined wave
        if (this.absoluteWave > 0 && this.absoluteWave <= this.waves.length) {
            const wave = this.waves[this.absoluteWave - 1];
            return wave.enemies.some(enemy => enemy.type === 'boss' && enemy.count > 0);
        }

        // For generated waves (11+), boss appears every 5th wave in the endless cycle
        if (this.absoluteWave > 10) {
            const endlessIndex = this.absoluteWave - 10;
            return ((endlessIndex - 1) % 5) + 1 === 5;
        }

        return false;
    }

    /**
     * Check if the current wave is a milestone wave (every 5 waves)
     * @returns True if the current wave is a milestone wave
     */
    public isMilestoneWave(): boolean {
        return this.absoluteWave > 0 && this.absoluteWave % 5 === 0;
    }

    /**
     * Check if the next wave will be a milestone wave (every 5 waves)
     * @returns True if the next wave will be a milestone wave
     */
    public isNextWaveMilestone(): boolean {
        return (this.absoluteWave + 1) % 5 === 0;
    }

    /**
     * Get the current wave status
     * @returns The current wave status
     */
    public getWaveStatus(): WaveStatus {
        if (this.waveInProgress) {
            return WaveStatus.InProgress;
        } else if (this.getAutoWaveTimeRemaining() > 0) {
            return WaveStatus.Countdown;
        } else {
            return WaveStatus.Ready;
        }
    }

    /**
     * Get the time remaining until next enemy spawn
     * @returns Time in seconds until next enemy spawn, or 0 if no enemies left to spawn
     */
    public getTimeToNextSpawn(): number {
        if (!this.waveInProgress || this.enemiesLeftToSpawn.length === 0) {
            return 0;
        }
        
        const nextDelay = this.enemiesLeftToSpawn[0].delay;
        return Math.max(0, nextDelay - this.timeSinceLastSpawn);
    }

    /**
     * Get the number of remaining enemies in the current wave
     * @returns The number of enemies left to spawn + active enemies on the map
     */
    public getRemainingEnemiesInWave(): number {
        if (!this.waveInProgress) {
            return 0;
        }
        
        const toSpawn = this.enemiesLeftToSpawn.length;
        const active = this.enemyManager.getEnemyCount();
        return toSpawn + active;
    }

    /**
     * Get the time remaining until next wave starts
     * @returns Time in seconds until next wave, or 0 if no wave is pending
     */
    public getTimeToNextWave(): number {
        return this.getAutoWaveTimeRemaining();
    }

    /**
     * Increment the wave counter and apply difficulty changes.
     * This is used when creating parallel waves to count them as new waves.
     * Uses the same formula-based scaling as startNextWave() for consistency.
     */
    public incrementWaveCounter(): void {
        // Increment wave counters
        this.currentWave++;
        this.absoluteWave++;
        this.segmentWave++;

        // Apply the same formula-based difficulty scaling using absolute wave
        const w = this.absoluteWave - 1;
        this.difficultyMultiplier = 1.0 + 0.12 * w + 0.004 * w * w;

        // Milestone waves: +15% bump
        if (this.currentWave % 5 === 0) {
            this.difficultyMultiplier *= 1.15;
            console.log(`%c MILESTONE WAVE ${this.currentWave}! Difficulty: ${this.difficultyMultiplier.toFixed(2)}x %c`,
                'background: #ff5500; color: #fff; font-size: 18px; font-weight: bold; padding: 4px 8px;',
                'background: none; color: inherit;');
        } else {
            console.log(`Wave ${this.currentWave}: Difficulty at ${this.difficultyMultiplier.toFixed(2)}x`);
        }
    }

    // =====================================================================
    // === WAVE INFO API (for UI display) ===
    // =====================================================================

    /**
     * Get information about the current wave for UI display.
     * @returns WaveInfo object with name, description, and metadata
     */
    public getCurrentWaveInfo(): WaveInfo | null {
        if (this.absoluteWave <= 0) return null;

        const waveIndex = this.absoluteWave - 1;
        if (waveIndex < this.waves.length) {
            const wave = this.waves[waveIndex];
            return {
                name: wave.name,
                description: wave.description,
                waveNumber: this.absoluteWave,
                isBoss: wave.enemies.some(e => e.type === 'boss' && e.count > 0),
                isMilestone: this.absoluteWave % 5 === 0
            };
        }

        return {
            name: `Wave ${this.absoluteWave}`,
            description: 'The endless horde continues.',
            waveNumber: this.absoluteWave,
            isBoss: this.isBossWave(),
            isMilestone: this.absoluteWave % 5 === 0
        };
    }

    /**
     * Get the consecutive perfect wave streak count.
     * @returns Number of consecutive perfect waves
     */
    public getPerfectWaveStreak(): number {
        return this.consecutivePerfectWaves;
    }
} 