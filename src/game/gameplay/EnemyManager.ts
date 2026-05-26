import { Vector3, Scene, ShadowGenerator } from '@babylonjs/core';
import { Game } from '../Game';
import { Map } from './Map';
import { Enemy } from './enemies/Enemy';
import { BasicEnemy } from './enemies/BasicEnemy';
import { FastEnemy } from './enemies/FastEnemy';
import { TankEnemy } from './enemies/TankEnemy';
import { BossEnemy } from './enemies/BossEnemy';
import { MilestoneBoss } from './enemies/MilestoneBoss';
import { AssetContainer } from '@babylonjs/core';
import { SplittingEnemy } from './enemies/SplittingEnemy';
import type { WaveManager } from './WaveManager';
import { HealerEnemy } from './enemies/HealerEnemy';
import { ShieldEnemy } from './enemies/ShieldEnemy';
import { MiniEnemy } from './enemies/MiniEnemy';
import { PlayerStats } from './PlayerStats';
import { makeElite } from './EliteSpawner';

export class EnemyManager {
    private game: Game;
    private map: Map;
    private enemies: Enemy[] = [];
    private playerStats: PlayerStats | null = null;
    private compositePath: Vector3[] | null = null;
    private splitHandler: ((e: Event) => void) | null = null;
    private healHandler: ((e: Event) => void) | null = null;

    // Survivors mode fields
    private heroProvider: {
        getPosition: () => Vector3;
        takeDamage?: (amount: number, sourcePos?: Vector3) => void;
        isAlive?: () => boolean;
    } | null = null;
    private arenaRadius: number = 25;
    private onEliteDeathCallback: (position: Vector3, element: string) => void = () => {};
    private onMilestoneBossDeathCallback: (position: Vector3, waveTier: number) => void = () => {};
    private waveManager: WaveManager | null = null;
    /** Optional: when set, large enemies (bosses, elites) are registered as
     *  shadow casters at spawn so the directional key light projects them
     *  onto the arena floor. Basic enemies are excluded — 60 casters would
     *  blow the per-frame shadow render budget. */
    private shadowGenerator: ShadowGenerator | null = null;
    /** Preloaded GLB asset containers per enemy type. Passed in by SurvivorsGameplayState
     *  after load completes. spawnSurvivorsEnemy stages the asset on the matching enemy
     *  class's static pendingAsset slot before constructing the instance. */
    private enemyAssets: Record<string, AssetContainer> = {};

    constructor(game: Game, map: Map) {
        this.game = game;
        this.map = map;

        // Listen for enemy split events (from SplittingEnemy)
        this.splitHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const { position, path, count } = detail;
            for (let i = 0; i < count; i++) {
                const offset = new Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5);
                const spawnPos = position.add(offset);
                MiniEnemy.pendingAsset = this.enemyAssets['mini'] ?? null;
                const mini = new MiniEnemy(this.game, spawnPos, [...path]);
                        this.enemies.push(mini);
            }
        };
        document.addEventListener('enemySplit', this.splitHandler);

        // Listen for enemy heal events (from HealerEnemy)
        this.healHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const { position, radius, healAmount } = detail;
            for (const enemy of this.enemies) {
                if (!enemy.isAlive()) continue;
                const dist = Vector3.Distance(position, enemy.getPosition());
                if (dist <= radius) {
                    enemy.heal(healAmount);
                }
            }
        };
        document.addEventListener('enemyHeal', this.healHandler);
    }

    /**
     * Set the player stats reference for rewarding kills
     */
    public setPlayerStats(playerStats: PlayerStats): void {
        this.playerStats = playerStats;
    }

    /**
     * Configure survivors mode: enemies spawn at arena perimeter and seek the hero.
     */
    public configureSurvivorsMode(
        heroProvider: {
            getPosition: () => Vector3;
            takeDamage?: (amount: number, sourcePos?: Vector3) => void;
            isAlive?: () => boolean;
        },
        arenaRadius: number,
    ): void {
        this.heroProvider = heroProvider;
        this.arenaRadius = arenaRadius;

        // Also update the mini-enemy split handler so spawned minis seek the hero too
        if (this.splitHandler) {
            document.removeEventListener('enemySplit', this.splitHandler);
        }
        this.splitHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const { position, path, count } = detail;
            for (let i = 0; i < count; i++) {
                const offset = new Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5);
                const spawnPos = position.add(offset);
                MiniEnemy.pendingAsset = this.enemyAssets['mini'] ?? null;
                const mini = new MiniEnemy(this.game, spawnPos, this.heroProvider ? [] : [...path]);
                        if (this.heroProvider) {
                    mini.seekTarget = this.heroProvider;
                }
                this.enemies.push(mini);
            }
        };
        document.addEventListener('enemySplit', this.splitHandler);
    }

    /**
     * Register a callback triggered when an elite enemy dies.
     */
    public setOnEliteDeath(fn: (position: Vector3, element: string) => void): void {
        this.onEliteDeathCallback = fn;
    }

    /**
     * Provide the WaveManager so spawnSurvivorsEnemy can route milestone-wave bosses
     * to MilestoneBoss. Optional — without it, bosses fall back to the standard BossEnemy.
     */
    public setWaveManager(wm: WaveManager): void {
        this.waveManager = wm;
    }

    /**
     * Register a callback fired exactly once when a MilestoneBoss dies, before
     * the standard cleanup. `waveTier` = waveNumber / 5 (1 at wave 5, 2 at wave 10, …).
     */
    public setOnMilestoneBossDeath(fn: (position: Vector3, waveTier: number) => void): void {
        this.onMilestoneBossDeathCallback = fn;
    }

    /** Register a preloaded GLB asset for the given enemy type. spawnSurvivorsEnemy
     *  stages it on the matching enemy class's static pendingAsset slot. */
    public setEnemyAsset(type: string, container: AssetContainer): void {
        this.enemyAssets[type] = container;
    }

    /** Optional: route shadow caster registration through us — bosses + elites
     *  spawned via spawnSurvivorsEnemy will be added automatically. */
    public setShadowGenerator(generator: ShadowGenerator | null): void {
        this.shadowGenerator = generator;
    }

    /** Internal helper — registers the enemy's root mesh (and children) as
     *  shadow casters. No-op when no generator is wired. */
    private _registerAsShadowCaster(enemy: Enemy): void {
        if (!this.shadowGenerator) return;
        const mesh = (enemy as unknown as { mesh: { name: string } | null }).mesh;
        if (mesh) {
            this.shadowGenerator.addShadowCaster(mesh as never, true);
        }
    }

    /**
     * Pre-warm enemy meshes/materials/shaders by instantiating one of every type
     * at a far-off position and forcing a render. Eliminates the first-spawn
     * freeze that hits the moment a never-before-seen enemy type appears in a
     * wave (shader compilation + flat-shading vertex rebuild + GPU buffer upload
     * all happen on the first render frame of a given type).
     *
     * Safe to call once at survivors-mode start. The pre-warm enemies are NOT
     * added to the enemies[] array, so they don't participate in gameplay; they
     * are disposed immediately after the warmup render.
     */
    public async prewarmEnemyTypes(): Promise<void> {
        const t0 = performance.now();
        const farAway = new Vector3(1000, 0, 1000);
        const warmup: Enemy[] = [];

        // 1) Procedural fallback meshes (covers the no-GLB code path).
        warmup.push(new BasicEnemy(this.game, farAway, []));
        warmup.push(new FastEnemy(this.game, farAway, []));
        warmup.push(new TankEnemy(this.game, farAway, []));
        warmup.push(new BossEnemy(this.game, farAway, []));
        warmup.push(new SplittingEnemy(this.game, farAway, []));
        warmup.push(new HealerEnemy(this.game, farAway, []));
        warmup.push(new ShieldEnemy(this.game, farAway, []));
        warmup.push(new MiniEnemy(this.game, farAway, []));

        // 2) GLB variants — each unique GLB has its own materials/skeleton that
        // need shader compilation on first render. Without this loop the player
        // hits a 1–2s GPU stall the first time each variant (base + elite + each
        // boss tier) actually appears in a wave. We mirror the spawn-side staging
        // pattern: set pendingAsset on the class, then construct.
        type EnemyClass = { pendingAsset: AssetContainer | null };
        const glbVariants: Array<{ cls: EnemyClass; key: string; build: () => Enemy }> = [
            { cls: BasicEnemy,     key: 'basic',        build: () => new BasicEnemy(this.game, farAway, []) },
            { cls: BasicEnemy,     key: 'basic_elite',  build: () => new BasicEnemy(this.game, farAway, []) },
            { cls: FastEnemy,      key: 'fast',         build: () => new FastEnemy(this.game, farAway, []) },
            { cls: FastEnemy,      key: 'fast_elite',   build: () => new FastEnemy(this.game, farAway, []) },
            { cls: TankEnemy,      key: 'tank',         build: () => new TankEnemy(this.game, farAway, []) },
            { cls: HealerEnemy,    key: 'healer',       build: () => new HealerEnemy(this.game, farAway, []) },
            { cls: HealerEnemy,    key: 'healer_elite', build: () => new HealerEnemy(this.game, farAway, []) },
            { cls: SplittingEnemy, key: 'splitting',    build: () => new SplittingEnemy(this.game, farAway, []) },
            { cls: MiniEnemy,      key: 'mini',         build: () => new MiniEnemy(this.game, farAway, []) },
            { cls: ShieldEnemy,    key: 'shield',       build: () => new ShieldEnemy(this.game, farAway, []) },
        ];
        for (const { cls, key, build } of glbVariants) {
            const asset = this.enemyAssets[key];
            if (!asset) continue;
            cls.pendingAsset = asset;
            warmup.push(build());
        }
        // Per-tier MilestoneBoss GLBs (waves 5/10/15/20).
        for (let tier = 1; tier <= 4; tier++) {
            const asset = this.enemyAssets[`boss_tier${tier}`];
            if (!asset) continue;
            MilestoneBoss.pendingAsset = asset;
            warmup.push(new MilestoneBoss(this.game, farAway, [], tier));
        }

        // 3) Force frustum inclusion. Babylon culls anything outside the camera
        // before drawing — the far-away warmup meshes would normally be skipped,
        // so the shader compile (the whole point of the prewarm) never happens.
        for (const e of warmup) {
            const root = (e as unknown as { mesh: { alwaysSelectAsActiveMesh: boolean; getChildMeshes: (deep: boolean) => { alwaysSelectAsActiveMesh: boolean }[] } | null }).mesh;
            if (!root) continue;
            root.alwaysSelectAsActiveMesh = true;
            for (const child of root.getChildMeshes(false)) {
                child.alwaysSelectAsActiveMesh = true;
            }
        }

        this.game.getScene().render();

        // 4) Force shader compilation to COMPLETE before we dispose. The render()
        // above only kicks off compilation; under KHR_parallel_shader_compile the
        // actual GLSL→GPU compile runs on a driver worker thread. Without this
        // await, the first in-gameplay use of each shader stalls the main thread
        // waiting for the still-in-flight compile (the actual freeze cause).
        const compilePromises: Promise<void>[] = [];
        type MeshLike = {
            material: { forceCompilationAsync: (mesh: object) => Promise<void> } | null;
            getChildMeshes: (deep: boolean) => MeshLike[];
        };
        const seen = new Set<object>();
        for (const e of warmup) {
            const root = (e as unknown as { mesh: MeshLike | null }).mesh;
            if (!root) continue;
            const meshes: MeshLike[] = [root, ...root.getChildMeshes(false)];
            for (const m of meshes) {
                const mat = m.material;
                if (!mat || seen.has(mat)) continue;
                seen.add(mat);
                compilePromises.push(
                    mat.forceCompilationAsync(m as unknown as object).catch((err) => {
                        console.warn('[prewarm] material compile failed:', err);
                    }),
                );
            }
        }
        await Promise.all(compilePromises);

        for (const e of warmup) e.dispose();
        const variantCount = warmup.length;
        const glbKeysAvailable = Object.keys(this.enemyAssets);
        console.info(
            `[prewarm] ${variantCount} variants + ${compilePromises.length} shaders compiled in ` +
            `${Math.round(performance.now() - t0)}ms ` +
            `(GLB assets: ${glbKeysAvailable.length === 0 ? 'NONE — only procedural fallbacks' : glbKeysAvailable.join(', ')})`,
        );
    }

    /**
     * Spawn a single enemy in survivors mode at a random point on the arena perimeter.
     * Pass eliteElement to make it an elite. For type='boss', bossStrengthMultiplier
     * scales HP/damage in place of spawning multiple bosses (set by WaveManager when
     * the wave config asks for more than one boss).
     */
    public spawnSurvivorsEnemy(type: string, eliteElement?: string, bossStrengthMultiplier: number = 1): Enemy | null {
        if (!this.heroProvider) return null;

        // Diagnostic: any single spawn taking >50ms is suspicious. Logs the type
        // + elite tag + duration so we can correlate spawn cost with rAF freezes.
        const spawnStart = performance.now();

        const heroPos = this.heroProvider.getPosition();
        const theta = Math.random() * Math.PI * 2;
        const r = this.arenaRadius + 2;
        const spawnPos = new Vector3(
            heroPos.x + Math.cos(theta) * r,
            0,
            heroPos.z + Math.sin(theta) * r,
        );

        // Create enemy at spawn position with empty path. Before each construction, stage
        // any preloaded GLB asset on the per-class static pendingAsset slot so createMesh
        // can pick it up. Cleared inside the subclass after consumption. Elite variants
        // look up a separate `<type>_elite` asset (with fallback to the base asset).
        const assetFor = (baseType: string) => {
            if (eliteElement) {
                return this.enemyAssets[`${baseType}_elite`] ?? this.enemyAssets[baseType] ?? null;
            }
            return this.enemyAssets[baseType] ?? null;
        };
        let enemy: Enemy;
        switch (type) {
            case 'basic':    BasicEnemy.pendingAsset = assetFor('basic');
                             enemy = new BasicEnemy(this.game, spawnPos, []); break;
            case 'fast':     FastEnemy.pendingAsset = assetFor('fast');
                             enemy = new FastEnemy(this.game, spawnPos, []); break;
            case 'tank':     TankEnemy.pendingAsset = assetFor('tank');
                             enemy = new TankEnemy(this.game, spawnPos, []); break;
            case 'boss': {
                const currentWave = this.waveManager?.getCurrentWave() ?? 0;
                if (currentWave > 0 && currentWave % 5 === 0) {
                    const tier = currentWave / 5;
                    // Stage tier-specific GLB (cap at tier4 asset for tier 5+).
                    const assetTier = Math.min(4, Math.max(1, tier));
                    MilestoneBoss.pendingAsset = this.enemyAssets[`boss_tier${assetTier}`] ?? null;
                    enemy = new MilestoneBoss(this.game, spawnPos, [], tier, bossStrengthMultiplier);
                } else {
                    enemy = new BossEnemy(this.game, spawnPos, []);
                }
                break;
            }
            case 'splitting':SplittingEnemy.pendingAsset = assetFor('splitting');
                             enemy = new SplittingEnemy(this.game, spawnPos, []); break;
            case 'healer':   HealerEnemy.pendingAsset = assetFor('healer');
                             enemy = new HealerEnemy(this.game, spawnPos, []); break;
            case 'shield':   ShieldEnemy.pendingAsset = assetFor('shield');
                             enemy = new ShieldEnemy(this.game, spawnPos, []); break;
            default:         enemy = new BasicEnemy(this.game, spawnPos, []); break;
        }

        // Set seekTarget BEFORE first update so the seek branch runs immediately
        enemy.seekTarget = this.heroProvider;

        // Apply elite treatment if requested
        if (eliteElement) {
            makeElite(enemy, eliteElement, this.game.getScene());
        }

        // Register large/visually-important enemies as shadow casters. Cheap
        // when no generator is wired (early-out). Skip swarm enemies (basic,
        // fast, mini) — too many active at once to be worth the shadow-pass
        // draw calls.
        const castsShadow = type === 'boss'
            || type === 'tank'
            || type === 'shield'
            || type === 'splitting'
            || type === 'healer'
            || !!eliteElement;
        if (castsShadow) this._registerAsShadowCaster(enemy);

        this.enemies.push(enemy);
        const spawnMs = performance.now() - spawnStart;
        if (spawnMs > 50) {
            console.warn(`[spawn] ${type}${eliteElement ? `:${eliteElement}` : ''} took ${Math.round(spawnMs)}ms`);
        }
        return enemy;
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

        // Diagnostic: time each enemy.update() and log the slowest of this frame
        // if the total update spend exceeds 50ms. Helps pinpoint per-enemy cost.
        const tUpdateStart = performance.now();
        let slowestEnemyMs = 0;
        let slowestEnemyType = '';

        for (const enemy of enemiesToUpdate) {
            // If an earlier enemy's attack killed the hero this frame, the gameplay
            // state has already started tearing down. Stop iterating to avoid
            // running enemy.update against a half-disposed scene.
            if (this.heroProvider?.isAlive && !this.heroProvider.isAlive()) break;

            // Update enemy and check if it reached the end
            const tE = performance.now();
            const reachedEnd = enemy.update(deltaTime);
            const dE = performance.now() - tE;
            if (dE > slowestEnemyMs) {
                slowestEnemyMs = dE;
                slowestEnemyType = enemy.constructor.name;
            }

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

                // Survivors mode: fire elite-death callback so a PowerDrop can be spawned
                if (enemy.isElite && enemy.eliteDropElement) {
                    this.onEliteDeathCallback(enemy.getPosition().clone(), enemy.eliteDropElement);
                }

                // Survivors mode: fire milestone-boss death callback so an ItemDrop can be spawned
                if (enemy instanceof MilestoneBoss) {
                    this.onMilestoneBossDeathCallback(enemy.getPosition().clone(), enemy.waveTier);
                }

                // Remove from enemies list
                this.removeEnemy(enemy);
            }
        }

        const totalUpdateMs = performance.now() - tUpdateStart;
        if (totalUpdateMs > 50) {
            console.warn(
                `[slow-update] EnemyManager.update ${Math.round(totalUpdateMs)}ms ` +
                `· ${enemiesToUpdate.length} enemies · slowest=${slowestEnemyType} ${Math.round(slowestEnemyMs)}ms`,
            );
        }
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
     * Get the enemy furthest along the path within range (highest currentPathIndex)
     */
    public getFirstEnemy(position: Vector3, maxRange: number): Enemy | null {
        let firstEnemy: Enemy | null = null;
        let highestPathIndex = -1;

        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            const distance = Vector3.Distance(position, enemy.getPosition());
            if (distance > maxRange) continue;
            const pathIndex = enemy.getPathIndex();
            if (pathIndex > highestPathIndex) {
                highestPathIndex = pathIndex;
                firstEnemy = enemy;
            }
        }

        return firstEnemy;
    }

    /**
     * Get the enemy with highest current HP within range
     */
    public getStrongestEnemy(position: Vector3, maxRange: number): Enemy | null {
        let strongestEnemy: Enemy | null = null;
        let highestHP = -1;

        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            const distance = Vector3.Distance(position, enemy.getPosition());
            if (distance > maxRange) continue;
            const hp = enemy.getHealth();
            if (hp > highestHP) {
                highestHP = hp;
                strongestEnemy = enemy;
            }
        }

        return strongestEnemy;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        for (const enemy of this.enemies) {
            enemy.dispose();
        }
        this.enemies = [];

        // Remove event listeners
        if (this.splitHandler) {
            document.removeEventListener('enemySplit', this.splitHandler);
            this.splitHandler = null;
        }
        if (this.healHandler) {
            document.removeEventListener('enemyHeal', this.healHandler);
            this.healHandler = null;
        }
    }
}
