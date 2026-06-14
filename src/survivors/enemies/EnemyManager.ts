import { Vector3, Scene, ShadowGenerator } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy, resetDeathBurstBudget } from './Enemy';
import { type TargetProvider, pickNearestAlive } from './nearestTarget';
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
import { RedMeleeMinion } from './RedMeleeMinion';
import { RedArtilleryCarriage } from './RedArtilleryCarriage';
import { RedWizard } from './RedWizard';
import { RedSuperWizard } from './RedSuperWizard';
import { DragonTurtle } from './DragonTurtle';
import { FireBeetle } from './FireBeetle';
import { HornedLizard } from './HornedLizard';
import { redSwapType, TIER3_SWAP_WAVE } from './redSwap';
import { PlayerStats } from '../PlayerStats';
import { makeElite } from './EliteSpawner';
import { DifficultyTuning } from '../DifficultyTuning';
import { SPAWN_RING_RADIUS } from '../globe/constants';

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
    /** Array version of heroProvider — set by configureSurvivorsMode (Phase 3).
     *  In single-player this is a single-element array wrapping heroProvider.
     *  In co-op it contains both heroes' providers so enemies can seek the nearest. */
    private heroProviders: TargetProvider[] = [];
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

    /** Monotonically-increasing counter assigned to each new enemy as its stable
     *  per-run `Enemy.id`. Reset to 0 in configureSurvivorsMode (once per run).
     *  The host uses IDs in snapshots so the guest can match scene objects. */
    private nextEnemyId: number = 0;

    // ── M3 host hooks ──────────────────────────────────────────────────────────
    /** Optional callback: called immediately after each enemy is assigned its id
     *  and pushed into the live list (all 3 spawn sites: main, mini-split, boss-clone).
     *  No-op in single-player (never set). Host wires this to send a SpawnMsg. */
    private onEnemySpawnedCb: ((enemy: Enemy) => void) | null = null;
    /** Optional callback: called in update() at the moment an enemy transitions to
     *  dead (before it moves to the corpse list). No-op in single-player.
     *  Host wires this to send a DeathMsg. */
    private onEnemyDiedCb: ((enemy: Enemy) => void) | null = null;

    /** Co-op host only: per-player gold sink for a GUEST-attributed kill. When set
     *  AND the dead enemy's lastDamagerHeroId is non-zero (a remote hero), the host
     *  does NOT credit its OWN PlayerStats — instead it calls this with the RAW
     *  reward (no host goldGainMultiplier) so the guest can scale + bank it on its
     *  side. Null in single-player and on the guest. */
    private onGuestKillRewardCb: ((heroId: number, rawReward: number) => void) | null = null;

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
     * Configure survivors mode: enemies spawn at arena perimeter and seek the hero(es).
     *
     * `heroProviders` is an array of target providers — one in single-player, two in
     * co-op. Each provider must at minimum satisfy `TargetProvider` (getPosition + optional
     * isAlive) but may carry the wider hero-provider shape (takeDamage, applyPull, etc.)
     * which enemies use for contact damage and boss specials. Passing a single-element
     * array is behavior-identical to the old single-provider API.
     */
    public configureSurvivorsMode(
        heroProviders: (TargetProvider & {
            takeDamage?: (amount: number, sourcePos?: Vector3) => void;
            applyPull?: (towardX: number, towardZ: number, speed: number, durationS: number) => void;
            applySlow?: (multiplier: number, durationS: number) => void;
        })[],
        arenaRadius: number,
    ): void {
        this.heroProviders = heroProviders;
        // Keep heroProvider pointing at the first entry for spawn-position / isAlive
        // guards that still use the wider typed field (getPosition returns Vector3,
        // takeDamage, applyPull, applySlow). Cast is safe — in practice the providers
        // passed are always the full hero-provider objects.
        this.heroProvider = (heroProviders[0] ?? null) as typeof this.heroProvider;
        this.arenaRadius = arenaRadius;
        this.nextEnemyId = 0; // reset per run

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
                    mini.seekTargets = this.heroProviders;
                }
                this._applyOrbHpBonus(mini);
                this._registerAsShadowCaster(mini);
                mini.netType = 'mini';
                mini.id = this.nextEnemyId++;
                this.enemies.push(mini);
                // M3 host hook: notify after id is assigned.
                if (this.onEnemySpawnedCb) this.onEnemySpawnedCb(mini);
            }
        };
        document.addEventListener('enemySplit', this.splitHandler);

        // Listen for boss clone events (from a tier-3/4 MilestoneBoss). Spawns a
        // weaker twin on the OPPOSITE side of the NEAREST hero from the origin boss
        // so the two pincer the player. The clone is linked back to its origin; when
        // it dies (see update()), the origin enrages.
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

            // Use nearest-alive hero for the reflect geometry so the clone spawns
            // on the opposite side of the closest player from the boss. In single-
            // player this is always heroProviders[0] (identical to the old behavior).
            const op = origin.getPosition();
            const nearestProvider = pickNearestAlive(op.x, op.z, this.heroProviders) ?? this.heroProviders[0];
            const heroPos = nearestProvider?.getPosition() as Vector3;
            if (!heroPos) return;

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
            clone.seekTargets = this.heroProviders;
            clone.setEnrageOrigin(origin);
            // Mirror the origin's exact max HP so the twin shares the SAME health pool
            // (also captures any orb-HP / strength scaling the origin already received).
            const cloneMax = clone.getMaxHealth();
            if (cloneMax > 0) clone.applyHealthMultiplier(origin.getMaxHealth() / cloneMax);
            this._registerAsShadowCaster(clone);
            clone.netType = 'boss_milestone';
            clone.id = this.nextEnemyId++;
            this.enemies.push(clone);
            // M3 host hook: notify after id is assigned.
            if (this.onEnemySpawnedCb) this.onEnemySpawnedCb(clone);
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

    /** M3 host hook: register a callback fired immediately after each enemy spawn
     *  (all 3 sites: main spawnSurvivorsEnemy, mini-split, boss-clone). The enemy
     *  already has its stable `id` assigned. No-op when not set (single-player). */
    public setOnEnemySpawned(cb: (enemy: Enemy) => void): void {
        this.onEnemySpawnedCb = cb;
    }

    /** M3 host hook: register a callback fired in update() when an enemy's health
     *  drops to zero — before it is removed from the live list and moved to corpses.
     *  The enemy is still in the live enemies array when the callback fires.
     *  No-op when not set (single-player). */
    public setOnEnemyDied(cb: (enemy: Enemy) => void): void {
        this.onEnemyDiedCb = cb;
    }

    /** Co-op host hook (P5 per-player gold): register a sink that receives
     *  (heroId, rawReward) for a kill whose last damager is a REMOTE hero
     *  (lastDamagerHeroId !== 0). When set, such kills credit the remote hero via
     *  this sink instead of the host's local PlayerStats. No-op when not set. */
    public setOnGuestKillReward(cb: (heroId: number, rawReward: number) => void): void {
        this.onGuestKillRewardCb = cb;
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
            // Wave-10+ red-tier variants — distinct GLBs, so they need their own shader/depth prewarm.
            { cls: BasicEnemy,  key: 'basic_red',        build: () => new RedMeleeMinion(this.game, farAway, []) },
            { cls: BasicEnemy,  key: 'basic_red_elite',  build: () => new RedMeleeMinion(this.game, farAway, []) },
            { cls: FastEnemy,   key: 'fast_red',         build: () => new RedArtilleryCarriage(this.game, farAway, []) },
            { cls: HealerEnemy, key: 'healer_red',       build: () => new RedWizard(this.game, farAway, []) },
            { cls: HealerEnemy, key: 'healer_red_elite', build: () => new RedWizard(this.game, farAway, []) },
            { cls: TankEnemy,   key: 'tank_red',         build: () => new DragonTurtle(this.game, farAway, []) },
            // Wave-15+ tier — distinct GLBs, so they need their own shader/depth prewarm.
            { cls: FastEnemy,   key: 'fire_beetle',      build: () => new FireBeetle(this.game, farAway, []) },
            { cls: TankEnemy,   key: 'horned_lizard',    build: () => new HornedLizard(this.game, farAway, []) },
            { cls: HealerEnemy, key: 'healer_red_super', build: () => new RedSuperWizard(this.game, farAway, []) },
        ];
        for (const { cls, key, build } of glbVariants) {
            const asset = this.enemyAssets[key];
            if (!asset) continue;
            cls.pendingAsset = asset;
            warmup.push(build());
        }
        // Per-tier MilestoneBoss GLBs (waves 5/10/15/20/25).
        for (let tier = 1; tier <= 5; tier++) {
            const asset = this.enemyAssets[`boss_tier${tier}`];
            if (!asset) continue;
            MilestoneBoss.pendingAsset = asset;
            warmup.push(new MilestoneBoss(this.game, farAway, [], tier));
        }

        // Elite treatments: makeElite adds per-element aura/glow/spike meshes+materials
        // (cached by element) that otherwise compile on the FIRST elite spawn in combat
        // — the ~500ms freeze. Warm one elite per element here; the frustum + compile +
        // dispose steps below cover their (parented) child meshes automatically.
        const ELITE_PREWARM_ELEMENTS = ['fire', 'ice', 'arcane', 'physical', 'storm'];
        for (const el of ELITE_PREWARM_ELEMENTS) {
            BasicEnemy.pendingAsset = this.enemyAssets['basic_elite'] ?? this.enemyAssets['basic'] ?? null;
            const e = new BasicEnemy(this.game, farAway, []);
            makeElite(e, el, this.game.getScene());
            warmup.push(e);
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

        // Register every warmup mesh as a shadow caster so the generators' DEPTH
        // shader gets compiled below. A ShadowGenerator renders casters through its
        // OWN skinned depth effect — a SEPARATE program from the material's main
        // shader (compiled in step 4). Without this, the first shadow-map render of
        // each new shadow-casting type (tanks/bosses/healers/shields/splitters/minis
        // + every elite; basics skip shadows) compiles the bone-skinning depth shader
        // on the main thread — the freeze "when a new enemy type / elite appears".
        // Milestone bosses register into BOTH generators (directional + torch), so
        // they otherwise stall twice. _registerAsShadowCaster also records the
        // generators on each enemy, so the e.dispose() below removes the warmup mesh
        // from every renderList (no stale disposed-mesh refs left behind).
        for (const e of warmup) this._registerAsShadowCaster(e);

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

        // 5) Compile each shadow generator's DEPTH effect for every caster variant now.
        // forceCompilationAsync iterates the generator's renderList (populated above) and
        // compiles the skinned depth shader for each mesh — frustum-independent, so the
        // far-away warmup meshes are fine. Awaited like the material compiles so the
        // GLSL→GPU compile finishes behind the loading screen, not on first combat.
        //
        // CRITICAL: Babylon's forceCompilation (shadowGenerator.js) does an UNGUARDED
        // `subMeshes.push(...mesh.subMeshes)` over the whole renderList. addShadowCaster(_, true)
        // registers the GLB enemy ROOT nodes too, and those are geometry-less
        // (subMeshes === undefined), so the spread throws "subMeshes is not iterable" — which
        // aborts the depth-shader prewarm. The compile then happens COLD on the first in-combat
        // shadow render of a skinned enemy → a multi-second main-thread freeze (worst on a cold
        // GPU shader cache, e.g. a freshly deployed origin). The per-frame render path IS guarded,
        // so this only ever bit the prewarm. Drop the geometry-less entries (they cast no shadow)
        // so the spread is safe and the real skinned depth shaders actually compile here.
        let shadowCompiles = 0;
        for (const g of this.shadowGenerators) {
            const sm = g.getShadowMap();
            if (sm?.renderList) {
                sm.renderList = sm.renderList.filter(
                    (m) => Array.isArray(m.subMeshes) && m.subMeshes.length > 0,
                );
            }
            shadowCompiles++;
            await g.forceCompilationAsync().catch((err) => {
                console.warn('[prewarm] shadow depth compile failed:', err);
            });
        }

        for (const e of warmup) e.dispose();
        const variantCount = warmup.length;
        const glbKeysAvailable = Object.keys(this.enemyAssets);
        console.info(
            `[prewarm] ${variantCount} variants + ${compilePromises.length} material shaders + ` +
            `${shadowCompiles} shadow-depth passes compiled in ` +
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
        // Infinite map: spawn just past the visual horizon so enemies crest the
        // curve from a random direction (theta above is already angle-uniform).
        const r = SPAWN_RING_RADIUS;
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

        // Wave-10+ red-tier swap: tougher red variants replace the blue base enemies.
        // Rewrites the type string so both the asset lookup and the switch below use it.
        const waveNow = this.waveManager?.getCurrentWave() ?? 0;
        type = redSwapType(type, waveNow);

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
                    // Stage tier-specific GLB (tier 5 = Elemental Lord; cap at tier5 for 6+).
                    const assetTier = Math.min(5, Math.max(1, tier));
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
            case 'basic_red':  BasicEnemy.pendingAsset = assetFor('basic_red');
                               enemy = new RedMeleeMinion(this.game, spawnPos, []); break;
            case 'fast_red':   FastEnemy.pendingAsset = assetFor('fast_red');
                               enemy = new RedArtilleryCarriage(this.game, spawnPos, []); break;
            case 'healer_red': {
                // Wave 15+ elite wizards become the AOE "super" wizard; otherwise the
                // ranged RedWizard. assetFor('healer_red') already resolves the
                // red-super-wizard GLB when eliteElement is set (healer_red_elite).
                const superWizard = !!eliteElement && waveNow >= TIER3_SWAP_WAVE;
                HealerEnemy.pendingAsset = assetFor('healer_red');
                enemy = superWizard
                    ? new RedSuperWizard(this.game, spawnPos, [])
                    : new RedWizard(this.game, spawnPos, []);
                break;
            }
            case 'tank_red':   TankEnemy.pendingAsset = assetFor('tank_red');
                               enemy = new DragonTurtle(this.game, spawnPos, []); break;
            case 'fire_beetle':   FastEnemy.pendingAsset = assetFor('fire_beetle');
                                  enemy = new FireBeetle(this.game, spawnPos, []); break;
            case 'horned_lizard': TankEnemy.pendingAsset = assetFor('horned_lizard');
                                  enemy = new HornedLizard(this.game, spawnPos, []); break;
            case 'shield':   ShieldEnemy.pendingAsset = assetFor('shield');
                             enemy = new ShieldEnemy(this.game, spawnPos, []); break;
            default:         enemy = new BasicEnemy(this.game, spawnPos, []); break;
        }

        // Record the resolved type string on the enemy for the M3 host hook so
        // buildSpawnMsg can read it without a reverse-lookup. 'boss' resolves to
        // 'boss_milestone' when a MilestoneBoss was actually created (milestone waves);
        // that string matches the 'boss_milestone' case in createEnemyOfType.
        const isMilestoneBoss = enemy instanceof MilestoneBoss;
        enemy.netType = isMilestoneBoss ? 'boss_milestone' : type;
        // The wave-15 wizard elite is a distinct class but shares the 'healer_red' type
        // string; tag it so the guest constructs the AOE super wizard (not a plain RedWizard).
        if (enemy instanceof RedSuperWizard) enemy.netType = 'healer_red_super';

        // Set seekTarget (single-provider, for legacy contact-damage / grab / slow paths)
        // AND seekTargets (array, for the nearest-of-N resolver) BEFORE first update.
        enemy.seekTarget = this.heroProvider;
        enemy.seekTargets = this.heroProviders;

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

        // Shadow caster gating: basic swarm enemies never register as shadow casters
        // on any quality level — they're the bulk of spawns and their shadows are visual noise.
        //   low    → scene.shadowsEnabled is off, registration is a no-op anyway.
        //   medium/high → basics skipped; everything else casts.
        const skipShadow = type === 'basic' || type === 'basic_red';
        if (!skipShadow) this._registerAsShadowCaster(enemy);

        enemy.id = this.nextEnemyId++;
        this.enemies.push(enemy);
        // M3 host hook: notify after id is assigned and enemy is in the live list.
        if (this.onEnemySpawnedCb) this.onEnemySpawnedCb(enemy);
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
                // M3 host hook: fire before reward/removal so the host can send a
                // DeathMsg while the enemy is still in the live list (has valid id,
                // position, isElite, eliteDropElement, isClone, reward).
                if (this.onEnemyDiedCb) this.onEnemyDiedCb(enemy);
                // P5 per-player gold: a guest-attributed killing blow
                // (lastDamagerHeroId !== 0) credits the REMOTE hero via the sink
                // with the RAW reward (guest applies its own goldGainMultiplier);
                // the host neither banks gold nor counts the kill for it. Host- and
                // single-player-attributed kills (id 0) credit locally as before.
                const killerHeroId = enemy.lastDamagerHeroId;
                if (killerHeroId !== 0 && this.onGuestKillRewardCb) {
                    this.onGuestKillRewardCb(killerHeroId, enemy.getReward());
                } else if (this.playerStats) {
                    this.playerStats.addMoney(Math.round(enemy.getReward() * this.playerStats.goldGainMultiplier));
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
     * Look up a live enemy by its network id. Linear scan over live enemies —
     * acceptable for ≤100 enemies (the expected co-op cap).
     */
    public getEnemyById(id: number): Enemy | undefined {
        return this.enemies.find(e => e.id === id);
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
