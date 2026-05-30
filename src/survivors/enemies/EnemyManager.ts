import { Vector3, Scene, ShadowGenerator } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy, resetDeathBurstBudget } from './Enemy';
import { BasicEnemy } from './BasicEnemy';
import { FastEnemy } from './FastEnemy';
import { TankEnemy } from './TankEnemy';
import { BossEnemy } from './BossEnemy';
import { MilestoneBoss } from './MilestoneBoss';
import { AssetContainer } from '@babylonjs/core';
import { SplittingEnemy } from './SplittingEnemy';
import type { WaveManager } from '../WaveManager';
import { HealerEnemy } from './HealerEnemy';
import { ShieldEnemy } from './ShieldEnemy';
import { MiniEnemy } from './MiniEnemy';
import { PlayerStats } from '../PlayerStats';
import { makeElite } from './EliteSpawner';
import { DifficultyTuning } from '../DifficultyTuning';
import { GameSettings } from '../../shared/GameSettings';

export class EnemyManager {
    private game: Game;
    private enemies: Enemy[] = [];
    /** Enemies that have died and are playing their death animation + lingering
     *  before being cleared. Kept OUT of `enemies[]` so wave-clear (which keys off
     *  the live enemy count) fires immediately on the last kill. Capped at
     *  MAX_CORPSES so a mass AOE wipe can't pile up skinned meshes + death-clip
     *  animatables (the death-animation feature must not become a new freeze source). */
    private corpses: Enemy[] = [];
    private static readonly MAX_CORPSES = 16;
    private playerStats: PlayerStats | null = null;
    private compositePath: Vector3[] | null = null;
    private splitHandler: ((e: Event) => void) | null = null;
    private healHandler: ((e: Event) => void) | null = null;
    private cloneHandler: ((e: Event) => void) | null = null;

    // Survivors mode fields
    private heroProvider: {
        getPosition: () => Vector3;
        takeDamage?: (amount: number, sourcePos?: Vector3) => void;
        isAlive?: () => boolean;
        applyPull?: (towardX: number, towardZ: number, speed: number, durationS: number) => void;
        applySlow?: (multiplier: number, durationS: number) => void;
    } | null = null;
    private arenaRadius: number = 25;
    private onEliteDeathCallback: (position: Vector3, element: string) => void = () => {};
    private onMilestoneBossDeathCallback: (position: Vector3, waveTier: number) => void = () => {};
    private waveManager: WaveManager | null = null;
    /** Optional: when set, every spawned enemy is registered as a shadow
     *  caster at spawn so the directional key light projects them onto the
     *  arena floor. Master enable lives in scene.shadowsEnabled (toggled by
     *  the settings UI) — when false, Babylon skips the shadow render pass
     *  entirely, so registering casters here is cheap. Multiple generators
     *  are supported so an enemy can cast into both the directional AND the
     *  hero-torch shadow passes from a single registration call. */
    private shadowGenerators: ShadowGenerator[] = [];
    /** Preloaded GLB asset containers per enemy type. Passed in by SurvivorsGameplayState
     *  after load completes. spawnSurvivorsEnemy stages the asset on the matching enemy
     *  class's static pendingAsset slot before constructing the instance. */
    private enemyAssets: Record<string, AssetContainer> = {};

    /** Compounding HP multiplier applied to every NEW enemy spawn this run.
     *  Multiplied by (1 + 0.08) each time the hero picks up a magical orb
     *  (hidden mechanic — no UI). Geometric rather than additive so it can track
     *  the player's multiplicative per-orb damage growth (~+10%/orb from the
     *  global ×1.06 bump + the chosen card). Resets to 1 because the EnemyManager
     *  is freshly constructed at the start of each run. */
    private orbHpMultiplier: number = 1;

    /** Per-wave baseline HP/reward scaling. Each wave past the first adds this
     *  fraction (linear): wave N → ×(1 + WAVE_HP_SCALE_PER_WAVE × (N − 1)).
     *  Applied to every survivors spawn EXCEPT milestone bosses, whose tier HP
     *  already derives from the wave number. Stacks multiplicatively with the
     *  orb buff and elite scaling. */
    private static readonly WAVE_HP_SCALE_PER_WAVE = 0.06;

    constructor(game: Game) {
        this.game = game;

        // Listen for enemy split events (from SplittingEnemy)
        this.splitHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const { position, path, count } = detail;
            for (let i = 0; i < count; i++) {
                const offset = new Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5);
                const spawnPos = position.add(offset);
                MiniEnemy.pendingAsset = this.enemyAssets['mini'] ?? null;
                const mini = new MiniEnemy(this.game, spawnPos, [...path]);
                this._applyOrbHpBonus(mini);
                this._registerAsShadowCaster(mini);
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
            applyPull?: (towardX: number, towardZ: number, speed: number, durationS: number) => void;
            applySlow?: (multiplier: number, durationS: number) => void;
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
                this._applyOrbHpBonus(mini);
                this._registerAsShadowCaster(mini);
                this.enemies.push(mini);
            }
        };
        document.addEventListener('enemySplit', this.splitHandler);

        // Listen for boss clone events (from a tier-3/4 MilestoneBoss). Spawns a
        // weaker twin on the OPPOSITE side of the hero from the origin boss so the
        // two pincer the player. The clone is linked back to its origin; when it
        // dies (see update()), the origin enrages.
        if (this.cloneHandler) {
            document.removeEventListener('bossClone', this.cloneHandler);
        }
        this.cloneHandler = (e: Event) => {
          // Isolate the tier-3/4 twin spawn: it synchronously instantiates a boss
          // GLB mid-update, and any throw here would otherwise abort the whole
          // update frame. Catch + log so a clone failure can't blank the screen.
          try {
            const detail = (e as CustomEvent).detail as { origin: MilestoneBoss; tier: number };
            const origin = detail.origin;
            if (!this.heroProvider || !origin || !origin.isAlive()) return;

            const heroPos = this.heroProvider.getPosition();
            const op = origin.getPosition();
            // Direction hero→away-from-origin = reflect the origin across the hero.
            let dx = heroPos.x - op.x;
            let dz = heroPos.z - op.z;
            let len = Math.hypot(dx, dz);
            if (len < 0.001) { dx = 1; dz = 0; len = 1; }
            const spawnDist = Math.max(8, len);
            let cx = heroPos.x + (dx / len) * spawnDist;
            let cz = heroPos.z + (dz / len) * spawnDist;
            // Keep the clone inside the arena.
            const radial = Math.hypot(cx, cz);
            const limit = this.arenaRadius - 2;
            if (radial > limit) { const k = limit / radial; cx *= k; cz *= k; }

            const tier = detail.tier;
            const assetTier = Math.min(4, Math.max(1, tier));
            MilestoneBoss.pendingAsset = this.enemyAssets[`boss_tier${assetTier}`] ?? null;
            // Full-strength identical twin; isClone=true suppresses recursive cloning.
            const clone = new MilestoneBoss(this.game, new Vector3(cx, 0, cz), [], tier, 1, true);
            clone.seekTarget = this.heroProvider;
            clone.setEnrageOrigin(origin);
            // Mirror the origin's exact max HP so the twin shares the SAME health pool
            // (also captures any orb-HP / strength scaling the origin already received).
            const cloneMax = clone.getMaxHealth();
            if (cloneMax > 0) clone.applyHealthMultiplier(origin.getMaxHealth() / cloneMax);
            this._registerAsShadowCaster(clone);
            this.enemies.push(clone);
          } catch (err) {
            console.error('[clone] boss-clone spawn failed (skipped):', err);
          }
        };
        document.addEventListener('bossClone', this.cloneHandler);
    }

    /**
     * Register a callback triggered when an elite enemy dies.
     */
    public setOnEliteDeath(fn: (position: Vector3, element: string) => void): void {
        this.onEliteDeathCallback = fn;
    }

    /**
     * Compound the per-spawn HP buff applied to future enemy spawns. Called by
     * SurvivorsGameplayState on every orb pickup with `amount = 0.08`. Geometric,
     * so 10 orbs picked = ×(1.08^10) ≈ ×2.16 HP on subsequent spawns. Alive
     * enemies are not retroactively scaled.
     */
    public addOrbHpBonus(amount: number): void {
        this.orbHpMultiplier *= 1 + amount;
    }

    /** Apply the current orb HP buff to a freshly-constructed enemy. No-op when
     *  the multiplier is still 1 (e.g. warmup spawns before any orb pickup). */
    private _applyOrbHpBonus(enemy: Enemy): void {
        if (this.orbHpMultiplier > 1) {
            enemy.applyHealthMultiplier(this.orbHpMultiplier);
        }
    }

    /** Apply the per-wave baseline HP + reward scaling to a freshly-constructed
     *  enemy. Skips milestone bosses (their tier HP already encodes the wave).
     *  No-op on wave 1 (multiplier is exactly 1). */
    private _applyWaveScaling(enemy: Enemy): void {
        if (enemy instanceof MilestoneBoss) return;
        const wave = this.waveManager?.getCurrentWave() ?? 1;
        const waveMult = 1 + EnemyManager.WAVE_HP_SCALE_PER_WAVE * Math.max(0, wave - 1);
        if (waveMult > 1) {
            enemy.applyHealthMultiplier(waveMult);
            enemy.applyRewardMultiplier(waveMult);
        }
    }

    /** Apply the global difficulty multipliers (tankier + harder-hitting) to a
     *  freshly-constructed enemy. Skips milestone bosses — they derive HP from
     *  tier and take bossHpMult/bossDamageMult in their own constructor. Compounds
     *  on top of elite, orb, and wave-scaling multipliers (intentional). */
    private _applyGlobalDifficulty(enemy: Enemy): void {
        if (enemy instanceof MilestoneBoss) return;
        enemy.applyHealthMultiplier(DifficultyTuning.enemyHpMult);
        enemy.applyDamageMultiplier(DifficultyTuning.enemyDamageMult);
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
    /** Replace the shadow-generator set. Pass an empty array (or omit) to
     *  disable. Non-null entries register casters; nulls are filtered out so
     *  callers can pass `[directional, torch]` even before both are ready. */
    public setShadowGenerators(generators: (ShadowGenerator | null)[]): void {
        this.shadowGenerators = generators.filter((g): g is ShadowGenerator => g !== null);
    }

    /** Internal helper — registers the enemy's root mesh (and children) as
     *  shadow casters for every wired generator. No-op when none are wired. */
    private _registerAsShadowCaster(enemy: Enemy): void {
        if (this.shadowGenerators.length === 0) return;
        const mesh = (enemy as unknown as { mesh: { name: string } | null }).mesh;
        if (!mesh) return;
        for (const g of this.shadowGenerators) {
            g.addShadowCaster(mesh as never, true);
        }
        // Record the generators on the enemy so it removes its mesh from their
        // renderLists when it is disposed — otherwise disposed enemy meshes
        // accumulate forever in both per-frame shadow passes (the in-run freeze).
        enemy.setShadowGenerators(this.shadowGenerators);
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

        // Hidden orb-pickup HP buff: scales on top of elite multipliers so
        // late-run elites compound both effects.
        this._applyOrbHpBonus(enemy);

        // Per-wave baseline HP + reward scaling (skips milestone bosses, which
        // already derive tier HP from the wave number). Compounds on top of the
        // orb buff and elite scaling.
        this._applyWaveScaling(enemy);

        // Global difficulty rebalance (DifficultyTuning): tankier + harder-hitting
        // for all non-milestone-boss enemies. Compounds on the above multipliers.
        this._applyGlobalDifficulty(enemy);

        // Quality gating:
        //   low    → scene.shadowsEnabled is off, registration is a no-op anyway.
        //   medium → swarm basics (type='basic') skip registration; everything else casts.
        //   high   → everything casts.
        // The scene-level flag (set in SurvivorsGameplayState) handles low; this
        // gate only matters for medium.
        const quality = GameSettings.getGraphicsQuality();
        const skipShadow = quality === 'medium' && type === 'basic';
        if (!skipShadow) this._registerAsShadowCaster(enemy);

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
     * Update all enemies.
     *
     * Iterates backwards so swap-pop removal during iteration is safe without
     * allocating a snapshot of the array per frame (the previous `[...this.enemies]`
     * was a hot-path allocation at 60 Hz × 100+ enemies).
     */
    public update(deltaTime: number): void {
        const enemies = this.enemies;
        for (let i = enemies.length - 1; i >= 0; i--) {
            // If an earlier enemy's attack killed the hero this frame, the gameplay
            // state has already started tearing down. Stop iterating to avoid
            // running enemy.update against a half-disposed scene.
            if (this.heroProvider?.isAlive && !this.heroProvider.isAlive()) break;

            const enemy = enemies[i];
            const reachedEnd = enemy.update(deltaTime);

            if (reachedEnd) {
                if (this.playerStats) {
                    this.playerStats.takeDamage(enemy.getDamage());
                }
                this._removeAt(i);
            } else if (!enemy.isAlive()) {
                if (this.playerStats) {
                    this.playerStats.addMoney(enemy.getReward());
                    this.playerStats.addKill();
                }
                if (enemy.isElite && enemy.eliteDropElement) {
                    this.onEliteDeathCallback(enemy.getPosition().clone(), enemy.eliteDropElement);
                }
                if (enemy instanceof MilestoneBoss) {
                    if (enemy.isClone) {
                        // A twin died → enrage the origin boss (2× HP/speed/atk-speed).
                        const origin = enemy.getEnrageOrigin();
                        if (origin && origin.isAlive()) origin.enrageFromCloneDeath();
                    } else {
                        // Real milestone boss → milestone item drop. Clones never drop.
                        this.onMilestoneBossDeathCallback(enemy.getPosition().clone(), enemy.waveTier);
                    }
                }
                // Move the dead enemy out of the live list into the corpse list so it
                // can play its death animation + linger before being cleared. Removing
                // it from enemies[] keeps wave-clear (live-count based) immediate.
                this._removeAt(i);
                this._beginCorpse(enemy);
            }
        }

        // Advance lingering corpses (death animation + linger); release finished ones.
        for (let i = this.corpses.length - 1; i >= 0; i--) {
            const corpse = this.corpses[i];
            if (corpse.tickCorpse(deltaTime)) {
                corpse.disposeCorpse();
                const last = this.corpses.length - 1;
                if (i !== last) this.corpses[i] = this.corpses[last];
                this.corpses.pop();
            }
        }
    }

    /** Track a just-died enemy as a corpse (it already started its death sequence in
     *  die()). Caps the corpse count so a mass kill can't accumulate skinned meshes +
     *  death-clip animatables — past the cap the oldest corpse is released immediately. */
    private _beginCorpse(enemy: Enemy): void {
        if (!enemy.isCorpse()) {
            // Defensive: died without a corpse phase — release immediately.
            enemy.dispose();
            return;
        }
        this.corpses.push(enemy);
        while (this.corpses.length > EnemyManager.MAX_CORPSES) {
            const oldest = this.corpses.shift();
            oldest?.disposeCorpse();
        }
    }

    /** Swap-pop removal — O(1), order-preserving is not required for enemies. */
    private _removeAt(index: number): void {
        const last = this.enemies.length - 1;
        if (index !== last) this.enemies[index] = this.enemies[last];
        this.enemies.pop();
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
        // Squared-distance compare avoids a sqrt per enemy (this scans all enemies
        // and is called per-frame from Champion.blockNearbyEnemies + abilities).
        // Keeps the full 3D term so results are identical to the old Vector3.Distance.
        const rangeSq = range * range;
        return this.enemies.filter(enemy => {
            if (!enemy.isAlive()) return false;
            const ep = enemy.getPosition();
            const dx = ep.x - position.x;
            const dy = ep.y - position.y;
            const dz = ep.z - position.z;
            return dx * dx + dy * dy + dz * dz <= rangeSq;
        });
    }

    /**
     * Get the closest enemy to a position
     */
    public getClosestEnemy(position: Vector3, maxRange?: number): Enemy | null {
        let closestEnemy: Enemy | null = null;
        // Track squared distance to avoid a sqrt per enemy — ordering is identical.
        let closestDistanceSq = maxRange !== undefined ? maxRange * maxRange : Number.MAX_VALUE;

        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;

            const ep = enemy.getPosition();
            const dx = ep.x - position.x;
            const dy = ep.y - position.y;
            const dz = ep.z - position.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq < closestDistanceSq) {
                closestDistanceSq = distanceSq;
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
        const maxRangeSq = maxRange * maxRange;

        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            const ep = enemy.getPosition();
            const dx = ep.x - position.x;
            const dy = ep.y - position.y;
            const dz = ep.z - position.z;
            if (dx * dx + dy * dy + dz * dz > maxRangeSq) continue;
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
        const maxRangeSq = maxRange * maxRange;

        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            const ep = enemy.getPosition();
            const dx = ep.x - position.x;
            const dy = ep.y - position.y;
            const dz = ep.z - position.z;
            if (dx * dx + dy * dy + dz * dz > maxRangeSq) continue;
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

        // Release any lingering corpses (death animation still in progress at teardown).
        for (const corpse of this.corpses) {
            corpse.disposeCorpse();
        }
        this.corpses = [];

        // Reset the module-level death-burst budget so a death effect whose
        // release setTimeout is still pending at teardown can't carry a non-zero
        // count into the next run (which would suppress early poofs next time).
        resetDeathBurstBudget();

        // Remove event listeners
        if (this.splitHandler) {
            document.removeEventListener('enemySplit', this.splitHandler);
            this.splitHandler = null;
        }
        if (this.healHandler) {
            document.removeEventListener('enemyHeal', this.healHandler);
            this.healHandler = null;
        }
        if (this.cloneHandler) {
            document.removeEventListener('bossClone', this.cloneHandler);
            this.cloneHandler = null;
        }
    }
}
