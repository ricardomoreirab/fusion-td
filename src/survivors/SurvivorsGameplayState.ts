import { Scene, Vector3, Color3, Color4, DirectionalLight, AssetContainer, LoadAssetContainerAsync, CubeTexture, Texture, MeshBuilder, Mesh, BackgroundMaterial, ShadowGenerator, KeyboardEventTypes, Observer } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { AdvancedDynamicTexture } from '@babylonjs/gui';
import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { SurvivorsArena } from './SurvivorsArena';
import { Champion } from './champions/Champion';
import { HeroController } from './HeroController';
import { SurvivorsJoystick } from './ui/SurvivorsJoystick';
import { EnemyManager } from './enemies/EnemyManager';
import { WaveManager } from './WaveManager';
import { PlayerStats } from './PlayerStats';
import { LevelSystem } from './LevelSystem';
import { PowerDrop } from './powers/PowerDrop';
import { PowerSlotManager, PowerSlot } from './powers/PowerSlotManager';
import { POWER_DEFS, getPowerByElementAndClass, getPowerMapForClass, PowerElement, ChampionType, PowerDefinition } from './powers/PowerDefinitions';
import { getFusionFor, getFusionsForClass, getUltimateOfferForFusions } from './powers/FusionDefinitions';
import { aoeBurst, gatherVortex, persistentZone, omniVolley, setCameraShakeHook, resetPowerEffects } from './powers/PowerEffects';
import './powers/FusionArchetypes'; // registers fusion archetypes at load
import { Enemy, HEALTH_BAR_RENDER_GROUP } from './enemies/Enemy';
import { BasicAttackTarget } from './champions/HeroBasicAttack';
import { PowerChoiceOverlay, PowerCard } from '../ui/overlays/PowerChoice';
import { ReplaceSlotOverlay } from '../ui/overlays/ReplaceSlot';
import { Hud } from '../ui/hud/Hud';
import { GameUI } from '../ui/GameUI';
import { OffscreenEnemyIndicators } from './ui/OffscreenEnemyIndicators';
import { ChampionSelectOverlay, ChampionOption } from '../ui/overlays/ChampionSelect';
import { GameOverState, SurvivorsRunSummary } from '../game-over/GameOverState';
import { AbilityManager } from './abilities/AbilityManager';
import { DamageNumberManager } from './DamageNumberManager';
import { RunItems, ItemId } from './RunItems';
import { ItemDrop } from './ItemDrop';
import { DifficultyTuning } from './DifficultyTuning';
import { createProceduralGrass } from '../engine/rendering/ProceduralGrass';
import { GameSettings, bladeCountForQuality } from '../shared/GameSettings';
import { clearMaterialCache, getCachedMaterial, getMaterialCacheSize } from '../engine/rendering/MaterialCache';
import { clearProjectilePools } from '../engine/rendering/ProjectilePool';
import { formatBuckets } from '../engine/rendering/resourceBudget';
import { CoopSession } from './coop/CoopSession';
import { GuestEnemies } from './coop/GuestEnemies';
import { computeCameraFocus } from './coop/cameraFocus';
import { NetClient } from '../net/NetClient';
import { WebSocketTransport } from '../net/WebSocketTransport';
import { packEnemyFlags } from '../net/EnemyFlags';
import type { SpawnMsg, DeathMsg, SnapshotMsg } from '../net/Protocol';
import { validateDamageReport } from './coop/DamageRouter';
import { MilestoneBoss } from './enemies/MilestoneBoss';

/**
 * Module-level cache for champion GLBs. Loaded on demand inside enter() (not at
 * boot via AssetsManager — preloaded containers were getting wiped by cleanupScene
 * in ways I couldn't pin down). Cached across runs so re-entering survivors mode
 * doesn't re-fetch the asset.
 *
 * Keyed by champion type so we can support any subset of GLB-backed classes.
 */
const CHAMPION_GLB_PATHS: Partial<Record<string, { dir: string; file: string }>> = {
    ranger:    { dir: 'assets/miya-moonlight-archer-in-game/source/',     file: 'miya_moonlight_archer_in_game.glb' },
    barbarian: { dir: 'assets/aulus-warrior-of-ferocity-in-game/source/', file: 'aulus_warrior_of_ferocity_in_game.glb' },
    mage:      { dir: 'assets/framis-soul-binder-in-game/source/',        file: 'framis_soul_binder_in_game.glb' },
};

const ENEMY_GLB_PATHS: Partial<Record<string, { dir: string; file: string }>> = {
    basic:       { dir: 'assets/blue-melee-minion/source/',            file: 'blue_melee_minion.glb' },
    basic_elite: { dir: 'assets/blue-super-melee-minion/source/',      file: 'blue_super_melee_minion.glb' },
    fast:        { dir: 'assets/blue-gold-artillery-carriage/source/', file: 'blue_gold_artillery_carriage.glb' },
    fast_elite:  { dir: 'assets/blue-super-artillery-carriage/source/', file: 'blue_super_artillery_carriage.glb' },
    tank:        { dir: 'assets/lava-golem/source/',                   file: 'lava_golem.glb' },
    healer:      { dir: 'assets/blue-wizard/source/',                  file: 'blue_wizard.glb' },
    healer_elite:{ dir: 'assets/blue-super-wizard/source/',            file: 'blue_super_wizard.glb' },
    splitting:   { dir: 'assets/thunder-fenrir/source/',               file: 'thunder_fenrir.glb' },
    mini:        { dir: 'assets/thunder-fenrir-cab/source/',           file: 'thunder_fenrir_cab.glb' },
    shield:      { dir: 'assets/red-super-melee-minion/source/',       file: 'red_super_melee_minion.glb' },
    // Wave-10+ red-tier replacements (see redSwap.ts). No red-super-artillery-carriage
    // asset exists, so an elite red carriage falls back to fast_red automatically.
    basic_red:        { dir: 'assets/red-melee-minion/source/',            file: 'red_melee_minion.glb' },
    fast_red:         { dir: 'assets/red-gold-artillery-carriage/source/', file: 'red_gold_artillery_carriage.glb' },
    healer_red:       { dir: 'assets/red-wizard/source/',                  file: 'red_wizard.glb' },
    tank_red:         { dir: 'assets/dragon-turtle/source/',               file: 'dragon_turtle.glb' },
    basic_red_elite:  { dir: 'assets/red-super-melee-minion/source/',      file: 'red_super_melee_minion.glb' },
    healer_red_elite: { dir: 'assets/red-super-wizard/source/',            file: 'red_super_wizard.glb' },
    // Per-tier milestone-boss GLBs (waves 5/10/15/20). EnemyManager picks the right
    // one from MilestoneBoss.waveTier when staging on MilestoneBoss.pendingAsset.
    boss_tier1:  { dir: 'assets/thamuz-lord-lava-in-game/source/',         file: 'thamuz_lord_lava_in_game.glb' },
    boss_tier2:  { dir: 'assets/thamuz-lord-of-wraith-in-game/source/',    file: 'thamuz_lord_of_wraith_in_game.glb' },
    boss_tier3:  { dir: 'assets/helcurt-shadowbringer-in-game/source/',    file: 'helcurt_shadowbringer_in_game.glb' },
    boss_tier4:  { dir: 'assets/bane-lord-of-scalding-seas-in-game/source/', file: 'bane_lord_of_scalding_seas_in_game.glb' },
};
function loadChampionAsset(championType: string, scene: Scene): Promise<AssetContainer> | null {
    return loadAsset(CHAMPION_GLB_PATHS, championType, scene);
}

function loadEnemyAsset(enemyType: string, scene: Scene): Promise<AssetContainer> | null {
    return loadAsset(ENEMY_GLB_PATHS, enemyType, scene);
}

const _glbAssets: Record<string, AssetContainer> = {};
const _glbAssetPromises: Record<string, Promise<AssetContainer>> = {};

function loadAsset(
    registry: Partial<Record<string, { dir: string; file: string }>>,
    key: string,
    scene: Scene,
): Promise<AssetContainer> | null {
    const path = registry[key];
    if (!path) return null;
    const cacheKey = `${path.dir}${path.file}`;
    if (cacheKey in _glbAssets) return Promise.resolve(_glbAssets[cacheKey]);
    if (cacheKey in _glbAssetPromises) return _glbAssetPromises[cacheKey];
    // Babylon 9 module-level loader (replaces deprecated SceneLoader.LoadAssetContainerAsync).
    // Better tree-shaking and cleaner async signature. Pass the full URL as one string.
    const p = LoadAssetContainerAsync(`${path.dir}${path.file}`, scene)
        .then(container => {
            _glbAssets[cacheKey] = container;
            return container;
        })
        .catch(err => {
            delete _glbAssetPromises[cacheKey];
            throw err;
        });
    _glbAssetPromises[cacheKey] = p;
    return p;
}

/** Float-text labels and colors for item pickups (mirror the HUD slot colors). */
const ITEM_DISPLAY_NAMES: Record<ItemId, string> = {
    extraLife: 'Extra Life',
    multishotCleave: 'Multishot',
    knockback: 'Knockback',
    attackSpeed: 'Attack Speed',
};
const ITEM_FLOAT_COLOR: Record<ItemId, string> = {
    extraLife: '#46e05a',
    multishotCleave: '#ffd84a',
    knockback: '#4ea7ff',
    attackSpeed: '#fff080',
};

// Hero-torch parameters shared between Champion's in-mesh PointLight and the
// procedural-grass shader so the in-world point light and the shader-baked
// torch halo match each other.
// Torch color now read live from the heroTorch PointLight at update time.
const TORCH_INTENSITY = 1.8;   // tuned for the grass shader's (1-d/r)² falloff
const TORCH_RANGE     = 9;

/** Seconds shaved off every ability on cooldown for each monster killed. */
const KILL_COOLDOWN_REDUCTION = 0.5;

export class SurvivorsGameplayState implements GameState {
    private game: Game;
    private scene: Scene | null = null;
    private ui: AdvancedDynamicTexture | null = null;
    private map: SurvivorsArena | null = null;
    private hero: Champion | null = null;
    private heroController: HeroController | null = null;
    private coopSession: CoopSession | null = null;
    /** Ghost mesh for the remote teammate (M2: cosmetic, not simulated). */
    private coopGhost: Champion | null = null;
    private coopGhostPending = false;
    // M3 (Part A): host-authoritative HP tracking for the guest hero.
    // The host computes contact damage for both heroes; these fields hold the
    // guest's authoritative HP. Sent to the guest in every snapshot (heroes[1].hp).
    // Null/zero until the ghost appears and champHpFor resolves the guest's class.
    private guestHeroHp = 0;
    private guestHeroMaxHp = 0;
    private guestHeroAlive = true;
    // Mutable hero-provider array shared with EnemyManager so the ghost provider
    // can be pushed in lazily (after the ghost spawns) and existing enemies see it
    // via their seekTargets reference (EnemyManager assigns the same array object).
    private _heroProviders: Parameters<EnemyManager['configureSurvivorsMode']>[0] = [];
    // M3: guest-side render-only enemy registry (null in single-player and host).
    private guestEnemies: GuestEnemies | null = null;
    /** Last wave state received from the host snapshot; drives the guest HUD.
     *  Null until the first snapshot arrives. Reset to null in exit(). */
    private _guestWave: { wave: number; enemiesAlive: number; inProgress: boolean } | null = null;
    /** Accumulator (seconds) for the host snapshot cadence (~20 Hz). */
    private _snapshotAccumS = 0;
    /** Monotonically-increasing snapshot tick counter (debug + ack). */
    private _snapshotTick = 0;
    /** Scratch velocity for animating the ghost from interpolated pose deltas. */
    private _coopGhostVel = new Vector3();
    private joystick: SurvivorsJoystick | null = null;
    private grass: ReturnType<typeof createProceduralGrass> | null = null;
    private shadowSourceLight: DirectionalLight | null = null;
    private shadowGenerator: ShadowGenerator | null = null;
    private torchShadowGenerator: ShadowGenerator | null = null;
    // After this wave clears, enemies stop casting shadows: the hordes grow large
    // enough that the per-caster shadow-map cost outweighs the visual detail. The
    // hero keeps its directional shadow. Idempotent guard so we only flip once.
    private static readonly ENEMY_SHADOW_CUTOFF_WAVE = 5;
    private enemyShadowsDisabled = false;
    // Per-run env/sky GPU resources — tracked so exit() can dispose them.
    // cleanupScene() only frees meshes/particles/ADT textures, so these cube
    // textures + skybox material otherwise leak one set per run.
    private skyTexture: CubeTexture | null = null;
    private skyMaterial: BackgroundMaterial | null = null;

    // Gameplay systems
    private enemyManager: EnemyManager | null = null;
    private waveManager: WaveManager | null = null;
    private playerStats: PlayerStats | null = null;
    // XP / leveling — replaces the gold Armory shop. Gold income folds into XP;
    // each level-up pushes +1%/level onto every attribute except crit chance
    // (which stays +0.5%/level) — see applyLevelBonuses.
    private levelSystem: LevelSystem | null = null;
    /** Hero base max HP captured at run start — XP scales max HP off this. */
    private baseMaxHealth = 0;
    /** How much max-HP bonus has already been pushed to the hero (delta-applied). */
    private appliedMaxHpBonus = 0;
    /** Seconds remaining in the post-wave breather before auto-advancing (shop removed). */
    private waveBreatherRemaining = 0;
    private static readonly WAVE_BREATHER_SECONDS = 2;
    private powerSlots: PowerSlotManager | null = null;
    private abilityManager: AbilityManager | null = null;

    // Power drops
    private powerDrops: PowerDrop[] = [];

    // Item drops (from milestone bosses)
    private runItems: RunItems | null = null;
    private itemDrops: ItemDrop[] = [];

    // Extra Life revive shield — translucent bubble that follows the hero for the
    // post-revive invulnerability window. Tracked so it can be removed on shield
    // expiry and on exit().
    private reviveShieldMesh: Mesh | null = null;
    private reviveShieldObs: Observer<Scene> | null = null;

    // Contact damage radius (hero bounding circle)
    private readonly heroRadius: number = 0.6;

    // Time scale (0.2 during power-choice overlay, 1.0 otherwise)
    private timeScale: number = 1.0;

    // Run perks accumulated from orb-choice Card C
    private runPerks = {
        damageMultiplier: 1.0,
        moveSpeedMultiplier: 1.0,
        attackRangeMultiplier: 1.0,
    };

    // Scratch state reused inside update() to avoid per-frame allocations.
    // Influencers list and torch-opts object are passed straight to the grass
    // shader; HUD waveInfo is a mutable struct that the HUD reads each frame.
    private _scratchInfluencers: Vector3[] = [];
    private _scratchTorchOpts: { position: Vector3; color: Color3; intensity: number; range: number } = {
        position: new Vector3(),
        color: new Color3(),
        intensity: 0,
        range: 0,
    };
    private _scratchWaveInfo: { wave: number; enemiesAlive: number; inProgress: boolean } = {
        wave: 0,
        enemiesAlive: 0,
        inProgress: false,
    };
    /** Flip to true while diagnosing a slow-frame regression. Kept off by
     *  default so the per-frame instrumentation (per-subsystem performance.now,
     *  closure + object literal allocations) doesn't add background overhead. */
    private static readonly PROFILE_UPDATE: boolean = false;

    // Run tracking for game-over summary
    private runStartTime: number = 0;
    private currentChampionType: ChampionType = 'mage';

    // DEV ?test fusion cycler
    private testMode = false;
    private testFusions: PowerDefinition[] = [];
    private testFusionIndex = 0;
    private testLabelEl: HTMLDivElement | null = null;

    // Diagnostic: freeze detectors to localize random hitches. longtask catches
    // main-thread blocks; the rAF-delta watcher catches GPU stalls (e.g. shader
    // compile) because rAF won't tick until the rendering pipeline can present
    // a frame. Both removed once root cause is identified.
    private longTaskObserver: PerformanceObserver | null = null;
    private rafFreezeDetectorId: number | null = null;
    private lastRafTimestamp: number = 0;
    private _rafWasHiddenSinceTick: boolean = false;
    private _visibilityHandler: (() => void) | null = null;

    // PERMANENT resource-leak watchdog (NOT a diagnostic to be removed). Every past
    // freeze was the same class of bug: a transient-FX material/texture orphaned into
    // a per-frame-walked scene list, growing until a frame stalls for seconds. This
    // turns that silent monotonic growth into a loud, self-naming alarm at each wave
    // clear (when the arena is empty, so the only legit growth is the bounded FX
    // cache). See checkResourceBudget() / resourceBudget.ts.
    private resourceBaselineMaterials: number = 0;
    private resourceBaselineTextures: number = 0;
    private resourceWaveSamples: { wave: number; materials: number; textures: number }[] = [];
    // Generous slack over baseline for the BOUNDED set of cached FX material variants
    // (swing tints, ability rings, element decorations…) so the normal cache never
    // false-alarms — only a genuine per-action orphan does.
    private static readonly RESOURCE_CACHE_BUDGET: number = 80;
    // A per-wave climb above this (after an initial warmup) flags a slow leak before
    // it ever reaches the absolute ceiling. Set above the worst legit single-wave
    // bump (equipping two new elements ≈ +12 cached FX materials) so only a genuine
    // per-action orphan (which adds dozens/wave) trips it.
    private static readonly RESOURCE_PER_WAVE_TOLERANCE: number = 20;

    // Floating damage / reward text
    private damageNumbers: DamageNumberManager | null = null;

    // UI modules
    private hud: Hud | null = null;
    private gameUI: GameUI | null = null;
    private powerChoice: PowerChoiceOverlay | null = null;
    private replaceSlotOverlay: ReplaceSlotOverlay | null = null;
    private offscreenIndicators: OffscreenEnemyIndicators | null = null;
    private championSelect: ChampionSelectOverlay | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        this.game.cleanupScene();
        this.scene = this.game.getScene();
        this.scene.clearColor = new Color4(0.04, 0.03, 0.05, 1); // near-black warm

        // Clear the depth buffer before the health-bar rendering group so enemy
        // health bars always draw ON TOP of their model and stay visible no matter
        // how large the monster is (big bosses used to occlude their own bar).
        this.scene.setRenderingAutoClearDepthStencil(HEALTH_BAR_RENDER_GROUP, true, true, false);

        // No second hemispheric light here — Game.setupScene already added
        // 'light' (warm fill, intensity 0.55). Stacking another hemi was
        // washing the scene out, contributing to the "flat / full bright" look.
        //
        // Key light — warm directional from upper-left-front. Bumped to 0.9
        // (was 0.5) so it's the dominant directional source giving real form
        // and falloff after the SpotLight + ambient cuts below.
        const keyLight = new DirectionalLight('survivorsKey', new Vector3(-0.4, -1, -0.6), this.scene);
        keyLight.intensity = 0.9;
        keyLight.diffuse = new Color3(1.0, 0.78, 0.55);
        keyLight.specular = new Color3(0, 0, 0); // low-poly mats are spec-zero anyway
        // Save for the shadow pass attached later.
        this.shadowSourceLight = keyLight;

        // Build base scene resources first
        this.map = new SurvivorsArena(this.scene, 25);

        // Layer on the ancient-ruins ambience: skybox, warm spot, env IBL, stone ground texture
        this.applyRuinsAmbience();

        // Create UI layer
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('survivorsUI', true, this.scene);
        this.ui.idealWidth = 800; // cap GUI rasterization — matches MenuState and GameOverState
        this.gameUI = new GameUI();

        // Show champion select; actual run starts when player picks
        this.championSelect = new ChampionSelectOverlay(this.gameUI!.layer('overlay'));
        const championOptions: ChampionOption[] = [
            {
                type: 'barbarian',
                name: 'Barbarian',
                summary: 'HP: 140  Speed: 6  Attack: 18 melee\nElement orbs enchant your axe. Brutal frontliner.',
                color: '#A0413A',
            },
            {
                type: 'ranger',
                name: 'Ranger',
                summary: 'HP: 90  Speed: 9  Attack: 8 ranged\nElement orbs unlock arrow variants. Fast and nimble.',
                startingPower: 'Frost Arrow',
                color: '#60C080',
            },
            {
                type: 'mage',
                name: 'Mage',
                summary: 'HP: 80  Speed: 7  Attack: 10 ranged\nElement orbs unlock spells. Fragile but devastating.',
                startingPower: 'Frost Shards',
                color: '#6080C0',
            },
        ];
        // Preload every known champion + enemy GLB in parallel so whichever the user
        // picks is likely already loaded by the time startRun fires.
        for (const type of Object.keys(CHAMPION_GLB_PATHS)) {
            const p = loadChampionAsset(type, this.scene);
            if (p) p.catch(err => console.error(`Champion GLB preload failed (${type}):`, err));
        }
        for (const type of Object.keys(ENEMY_GLB_PATHS)) {
            const p = loadEnemyAsset(type, this.scene);
            if (p) p.catch(err => console.error(`Enemy GLB preload failed (${type}):`, err));
        }

        // DEV ?test: skip champion select and auto-start so an unattended stress
        // pass is fully deterministic (no canvas-coordinate clicking needed).
        // ?test&champ=<barbarian|ranger|mage> picks the class (defaults to barbarian).
        const testParams = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search) : null;
        if (testParams?.has('test')) {
            void this.startRun(testParams.get('champ') || 'barbarian');
            return;
        }

        this.championSelect.show(championOptions, (type) => { void this.startRun(type); });
    }

    /** Initialize all gameplay systems and begin the run. Called once champion is chosen. */
    private async startRun(championType: string): Promise<void> {
        if (!this.scene || !this.ui || !this.map) return;

        this.game.showLoadingScreen('Warming up the arena…');
        await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));

        // The pre-game flow (main menu + champion select) is all DOM, so the
        // canvas never received keyboard focus — WASD would be dead until the
        // player clicked the scene. Focus it now that the run is starting.
        // tabIndex -1 (set only if Babylon didn't already make it focusable)
        // keeps it programmatically focusable without entering the Tab order.
        const canvas = this.game.getCanvas();
        if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = -1;
        canvas.focus();

        // Await the picked champion's GLB if one exists. No-op for champion types without
        // a GLB; instant if the preload already finished. On failure we fall through with
        // null and Champion uses the procedural builder.
        let championAsset: AssetContainer | null = null;
        const assetPromise = loadChampionAsset(championType, this.scene);
        if (assetPromise) {
            try {
                championAsset = await assetPromise;
            } catch (err) {
                console.error(`Champion GLB failed to load (${championType}) — falling back to procedural mesh:`, err);
            }
        }

        this.runStartTime = performance.now();
        this.currentChampionType = (championType as ChampionType) ?? 'mage';

        this.startLongTaskObserver();

        // Stat variants by champion type
        const variants: Record<string, { hp: number; speed: number; startPower?: string }> = {
            barbarian: { hp: 140, speed: 6  },
            ranger:    { hp: 90,  speed: 9,  startPower: 'ranger_ice' },
            mage:      { hp: 80,  speed: 7,  startPower: 'mage_ice' },
        };
        const variant = variants[championType] ?? variants['barbarian'];

        // Difficulty rebalance: shave hero starting HP (~-8%) so the "more
        // incoming damage" axis bites. Multiplier (not flat) preserves the
        // per-champion HP spread (barb 140 / ranger 90 / mage 80).
        const heroHp = Math.round(variant.hp * DifficultyTuning.playerHpMult);

        // Spawn hero — Champion in player-controlled mode. Pass the preloaded champion
        // GLB (Miya for ranger, Aulus for barbarian, etc.) so Champion uses the GLB
        // pipeline instead of the procedural box-and-cylinder mesh.
        this.hero = new Champion(
            this.game,
            [],
            null,
            championType as 'barbarian' | 'ranger' | 'mage',
            championAsset ?? undefined,
        );
        this.hero.controlMode = 'player';
        // Torch left off — it's a strong warm point light that masks shadows
        // around the hero. The grass shader's torch glow auto-syncs with this,
        // so leaving torch.intensity at 0 keeps both quiet. Toggle on by
        // calling `this.hero.enableTorch()` for a moodier night-arena look.

        // Register the hero as a shadow caster.
        // GLB heroes are skinned, so all child meshes get added.
        const heroMesh = (this.hero as unknown as { mesh: Mesh | null }).mesh;
        if (heroMesh && this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(heroMesh, true);
        }
        // DEBUG: log shadow state once after a short delay to verify casters
        // are in the shadow map's render list and the map is being rendered.
        setTimeout(() => {
            if (!this.shadowGenerator) {
                console.log('[shadow-debug] no shadowGenerator');
                return;
            }
            const sm = this.shadowGenerator.getShadowMap();
            const rl = sm?.renderList ?? null;
            console.log('[shadow-debug]', {
                scene_shadowsEnabled: this.scene?.shadowsEnabled,
                light_intensity: this.shadowSourceLight?.intensity,
                shadowMap_renderListSize: rl?.length ?? 'null',
                shadowMap_renderListNames: rl?.map(m => m.name).slice(0, 10) ?? null,
                shadowMap_isReady: sm?.isReady() ?? false,
                ESM_depthScale: (this.shadowGenerator as unknown as { depthScale: number }).depthScale,
                useESM: (this.shadowGenerator as unknown as { useExponentialShadowMap: boolean }).useExponentialShadowMap,
            });
        }, 1500);

        this.heroController = new HeroController(
            this.scene,
            this.hero,
            this.map.getArenaRadius(),
            variant.speed,
            heroHp,
            championType,
        );

        this.heroController.setOnDeath(() => {
            this.buildAndSendRunSummary();
        });

        // Extra Life: a lethal hit revives the hero at full HP behind a 5s shield
        // instead of ending the run. Spawn the shield bubble + feedback and empty
        // the HUD item slot; remove the bubble when the shield expires.
        this.heroController.setOnRevive(
            () => {
                if (this.damageNumbers && this.hero) {
                    this.damageNumbers.showText(this.hero.getPosition(), 'EXTRA LIFE!', '#46e05a', 64);
                }
                this.runItems?.consumeExtraLife();
                this.spawnReviveShield();
            },
            () => this.removeReviveShield(),
        );

        // --- Co-op (M2 ghost teammate) ---
        // ?host  → create a room and host; ?join=CODE → join an existing room.
        // The ghost is cosmetic in M2: both clients still run their own sim.
        const coopParams = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search) : null;
        if (coopParams?.has('host') || coopParams?.has('join')) {
            const localChamp = championType;
            void (async () => {
                try {
                    let code = coopParams.get('join') ?? '';
                    if (coopParams.has('host')) {
                        const res = await fetch('/room', { method: 'POST' });
                        code = (await res.json()).code;
                        console.log(`[coop] hosting room ${code} — join with ?join=${code}`);
                    }
                    if (code.length !== 6) return;
                    const transport = await WebSocketTransport.connect(location.origin, code);
                    this.coopSession = new CoopSession(new NetClient(transport), localChamp);
                    console.log(`[coop] connected as ${this.coopSession.role}`);
                    // M3: wire guest enemy registry OR host spawn/death hooks.
                    if (this.coopSession.role === 'guest') {
                        this.guestEnemies = new GuestEnemies(this.game);
                        this.coopSession.onSpawn = (m) => this.guestEnemies?.spawn(m);
                        this.coopSession.onDeath = (m) => this.guestEnemies?.death(m.id);
                        // M3b: guest basic-attack aims at render-only GuestEnemies and
                        // reports hits to the host instead of mutating enemy HP locally.
                        // heroController was created synchronously before this block so
                        // it is always live here.
                        this.heroController?.setEnemyProvider(
                            () => this.guestEnemies?.getEnemies() ?? [],
                        );
                        this.heroController?.setTargetProvider(() => {
                            const ge = this.guestEnemies;
                            if (!ge || !this.hero) return null;
                            const heroPos = this.hero.getPosition();
                            let best: import('./enemies/Enemy').Enemy | null = null;
                            let bestDistSq = Infinity;
                            for (const e of ge.getEnemies()) {
                                if (!e.isAlive()) continue;
                                const dx = e.getPosition().x - heroPos.x;
                                const dz = e.getPosition().z - heroPos.z;
                                const dSq = dx * dx + dz * dz;
                                if (dSq < bestDistSq) { bestDistSq = dSq; best = e; }
                            }
                            if (!best) return null;
                            const captured = best;
                            return {
                                position:   captured.getPosition(),
                                takeDamage: (n, element) => captured.takeDamage(n, element),
                                isAlive:    () => captured.isAlive(),
                                enemy:      captured,
                            };
                        });
                        const ba = this.heroController?.getBasicAttack();
                        if (ba) {
                            ba.damageRouter = (enemy, amount, element) => {
                                this.coopSession?.sendDamageReport({
                                    t: 'damageReport',
                                    enemyId: enemy.id,
                                    amount,
                                    element,
                                    sourceHeroId: 1,
                                });
                            };
                        }
                        // Receive authoritative damage results from host and show damage numbers.
                        this.coopSession.onDamageResult = (m) => {
                            if (this.damageNumbers) {
                                this.damageNumbers.showDamage(
                                    new Vector3(m.x, 0, m.z),
                                    m.amount,
                                    m.element as PowerElement | undefined,
                                    m.isCrit,
                                );
                            }
                        };
                    } else {
                        // host: wire EnemyManager hooks. enemyManager is constructed
                        // below; store closures — they capture `this` so the actual
                        // manager reference is resolved at call time, not wiring time.
                        // We defer the actual setOnEnemySpawned/setOnEnemyDied calls
                        // until after enemyManager is created (see below).
                        //
                        // M3b: validate + apply guest damage reports authoritatively.
                        // Uses closures so enemyManager/coopGhost are resolved at call time.
                        this.coopSession.onDamageReport = (m) => {
                            const e = this.enemyManager?.getEnemyById(m.enemyId);
                            const ep = e ? { x: e.getPosition().x, z: e.getPosition().z } : null;
                            const ghost = this.coopGhost;
                            const srcPos = ghost
                                ? { x: ghost.getPosition().x, z: ghost.getPosition().z }
                                : undefined;
                            // maxRangeSq = 144 (12u) — generous for network lag
                            if (!validateDamageReport(m, ep, 144, srcPos)) return;
                            if (e) {
                                e.takeDamage(m.amount, m.element as PowerElement);
                                this.coopSession?.sendDamageResult({
                                    t: 'damageResult',
                                    enemyId: m.enemyId,
                                    amount: m.amount,
                                    isCrit: false,
                                    element: m.element,
                                    x: e.getPosition().x,
                                    z: e.getPosition().z,
                                });
                            }
                        };
                    }
                } catch (err) {
                    console.error('[coop] connection failed:', err);
                }
            })();
        }

        // ---------- Gameplay systems ----------

        this.playerStats = new PlayerStats(heroHp, 100);

        // XP / leveling replaces the gold shop. Gold income is folded into XP via the
        // sink; each level-up pushes +1%/level onto every attribute (crit chance
        // stays +0.5%/level). Establish the
        // level-1 baseline now (b=0 → neutral multipliers): heroController exists
        // (created just above) and runPerks is at defaults this early in the run.
        this.levelSystem = new LevelSystem();
        this.baseMaxHealth = heroHp;
        this.appliedMaxHpBonus = 0;
        this.playerStats.setXpSink((amount) => this.awardXp(amount));
        this.applyLevelBonuses();

        // Install the global crit provider — every Enemy.takeDamage() reads from it.
        // Cleared in exit() so the menu / non-survivors flows never crit.
        Enemy.critProvider = () => ({
            chance:     this.playerStats?.critChance          ?? 0,
            damageMult: this.playerStats?.critDamageMultiplier ?? 1.5,
        });

        this.enemyManager = new EnemyManager(this.game);
        this.enemyManager.setPlayerStats(this.playerStats);
        // M3: wire host-side spawn/death hooks now that enemyManager exists.
        if (this.coopSession?.role === 'host') {
            this.enemyManager.setOnEnemySpawned((e) => {
                this.coopSession?.sendSpawn(this.buildSpawnMsg(e));
            });
            this.enemyManager.setOnEnemyDied((e) => {
                this.coopSession?.sendDeath(this.buildDeathMsg(e));
            });
        }
        // Wire the shadow generator so bosses + elites auto-register as casters.
        // Reset per run: enemy shadows start on and get cut off after wave 5.
        this.enemyShadowsDisabled = false;
        this.enemyManager.setShadowGenerators([this.shadowGenerator, this.torchShadowGenerator]);
        // Cache the last known hero position so the provider stays null-safe even
        // when an enemy attack kills the hero mid-frame: HeroController.takeDamage
        // triggers state.exit() synchronously (nulling this.hero), and the rest of
        // EnemyManager.update would otherwise crash on this.hero!.getPosition().
        const heroPosFallback = new Vector3();
        // Build the mutable hero-providers array (stored on `this` so the ghost
        // provider can be pushed lazily when the co-op ghost spawns). EnemyManager
        // holds the same array reference via seekTargets, so mutations are visible
        // to all already-spawned enemies without a re-configure call.
        this._heroProviders = [
            {
                getPosition: () => {
                    const p = this.hero?.getPosition();
                    if (p) { heroPosFallback.copyFrom(p); return p; }
                    return heroPosFallback;
                },
                takeDamage: (amount: number, sourcePos?: Vector3) => {
                    if (!this.heroController) return;
                    const mult = this.playerStats?.damageReductionMultiplier ?? 1.0;
                    this.heroController.takeDamage(amount * mult, sourcePos);
                },
                isAlive: () => !!this.heroController,
                applyPull: (towardX: number, towardZ: number, speed: number, durationS: number) => {
                    this.heroController?.applyPull(towardX, towardZ, speed, durationS);
                },
                applySlow: (multiplier: number, durationS: number) => {
                    this.heroController?.applySlow(multiplier, durationS);
                },
            },
        ];
        this.enemyManager.configureSurvivorsMode(this._heroProviders, this.map.getArenaRadius());

        // Hand over enemy GLB assets so EnemyManager.spawnSurvivorsEnemy can stage them
        // on the per-class pendingAsset slots before construction. Loaded lazily (await
        // here) — the preload kick-off in enter() means this is usually a cache hit.
        for (const enemyType of Object.keys(ENEMY_GLB_PATHS)) {
            const p = loadEnemyAsset(enemyType, this.scene);
            if (!p) continue;
            try {
                const container = await p;
                this.enemyManager.setEnemyAsset(enemyType, container);
            } catch (err) {
                console.error(`Enemy GLB failed to load (${enemyType}):`, err);
            }
        }

        // Pre-warm all enemy types so the first spawn of each doesn't hitch
        // the frame with shader compilation and GPU buffer uploads. Awaited
        // because forceCompilationAsync resolves only once each shader has
        // actually finished compiling on the GPU driver thread.
        await this.enemyManager.prewarmEnemyTypes();

        // BossEnemy.createMesh creates 3 magenta "bossOrbit" wisp spheres at
        // world (0,0,0) (not parented to the boss mesh — positioned in
        // animateParts via world coords). They survive the prewarm dispose
        // cycle for reasons I haven't tracked down, and sit at origin looking
        // like a pink sphere. Sweep them after the prewarm completes.
        if (this.scene) {
            for (const m of [...this.scene.meshes]) {
                if (m.name.startsWith('bossOrbit') && !m.isDisposed()) {
                    m.dispose();
                }
            }
        }

        // Damage / reward floating text manager.
        // Wired via static callbacks (replaces the previous CustomEvent flow
        // through document.dispatchEvent) — same dispatch path, zero per-hit
        // allocations. Cleared in exit() so the menu / game-over states never
        // see calls from a stale run.
        this.damageNumbers = new DamageNumberManager(this.game);
        Enemy.onDamageCallback = (position, damage, isCrit, element) => {
            this.damageNumbers?.showDamage(position, damage, element, isCrit);
        };
        Enemy.onRewardCallback = (position, reward) => {
            this.damageNumbers?.showReward(position, reward);
        };
        // Each monster killed refunds a flat slice of every ability cooldown. Wired
        // to the kill hook (fires once per death from base die()) rather than the
        // reward float, which several enemy subclasses skip.
        Enemy.onKillCallback = () => {
            this.abilityManager?.reduceAllCooldowns(KILL_COOLDOWN_REDUCTION);
        };
        // Frozen/marked enemies erupt on death (Phase 1a primed the hook).
        Enemy.onShatterCallback = (position, damage, radius, element, status) => {
            const enemies = this.enemyManager?.getEnemies() ?? [];
            aoeBurst(this.scene!, enemies, position.x, position.z, { radius, damage, element, status });
        };
        // PowerEffects.cameraShake → the existing HeroController screen shake.
        setCameraShakeHook((durationS) => this.heroController?.triggerScreenShake(durationS));

        // Power slot manager — consults playerStats for damage/cooldown multipliers
        this.powerSlots = new PowerSlotManager(
            this.scene,
            () => this.hero!.getPosition(),
            () => this.enemyManager!.getEnemies(),
            () => (this.playerStats?.powerDamageMultiplier ?? 1.0) * this.runPerks.damageMultiplier,
            () => this.playerStats?.powerCooldownMultiplier ?? 1.0,
        );

        // Grant starting power based on champion type
        if (variant.startPower && POWER_DEFS[variant.startPower]) {
            this.powerSlots.addPower(variant.startPower);
        }

        // When a power-slot fires, trigger the ranger's special-attack animation.
        // No-op for non-ranger champs (triggerSpecial type-guards on championType).
        this.powerSlots.setOnCast(() => {
            const hero = this.hero as { triggerSpecial?: () => void } | null;
            if (hero && typeof hero.triggerSpecial === 'function') {
                hero.triggerSpecial();
            }
        });

        // Wire enemy provider and power slots into HeroController for melee AOE + enchantments
        this.heroController.setEnemyProvider(() => this.enemyManager!.getEnemies());
        this.heroController.setPowerSlots(this.powerSlots);
        // Route the global damage multiplier (shop powerDamageMultiplier × run perk)
        // into the basic attack — without this, weapon damage never scaled with
        // upgrades and power picks felt purely cosmetic for melee/projectile champs.
        this.heroController.setDamageMultiplierProvider(
            () => (this.playerStats?.powerDamageMultiplier ?? 1.0) * this.runPerks.damageMultiplier,
        );

        // Push playerStats into the controller-owned HeroBasicAttack so run-item
        // effects (lifesteal, knockback, multishot, multi-spin) can read them.
        this.heroController.setPlayerStats(this.playerStats);

        // Construct RunItems now that controller + playerStats + championType all exist.
        this.runItems = new RunItems(this.playerStats, this.currentChampionType, this.heroController);

        // Boss-death → item-drop pipeline.
        this.enemyManager.setOnMilestoneBossDeath((pos, tier) => this.spawnItemDrop(pos, tier));

        // Elite death → spawn a PowerDrop
        this.enemyManager.setOnEliteDeath((pos, element) => {
            const baseRadius = 4;
            const magnetRadius = baseRadius;
            const drop = new PowerDrop(
                this.scene!,
                pos,
                element,
                () => this.hero!.getPosition(),
                {
                    pickupRadius: 1.5,
                    magnetRadius,
                    magnetSpeed: 12,
                    onPickup: (el) => this.onOrbPickup(el),
                },
            );
            this.powerDrops.push(drop);
        });

        this.waveManager = new WaveManager(this.enemyManager, this.playerStats);

        // Hand the WaveManager to EnemyManager so boss spawns route to MilestoneBoss on 5th waves.
        this.enemyManager.setWaveManager(this.waveManager);

        // Survivors mode: crank up spawn cadence and per-wave enemy count
        // so the arena feels swarmed (Vampire Survivors-y) instead of TD-paced.
        this.waveManager.setSurvivorsRates(
            DifficultyTuning.spawnRateMult,
            DifficultyTuning.enemyCountMult,
        );

        // Survivors-mode: manual wave start after the shop
        this.waveManager.setOnWaveCleared(() => {
            // Resource-leak watchdog: at wave clear the arena is empty (live enemies
            // ≈ 0), so any scene.materials/textures growth above the bounded FX-cache
            // budget is orphaned resources — the exact class of bug behind every past
            // freeze. Checked here, before the shop opens, so a regression is caught
            // (and its culprit named) the very wave it starts leaking.
            const clearedWave = this.waveManager?.getCurrentWave() ?? 0;
            this.checkResourceBudget(clearedWave);
            this.maybeDisableEnemyShadows(clearedWave);
            // Calibration log: read in a ?test run to tune XP_CONFIG so level 100
            // lands near wave 30 (see the XP spec §6).
            if (this.levelSystem) {
                console.log(`[xp] wave=${clearedWave} level=${this.levelSystem.getLevel()} ` +
                    `progress=${Math.round(this.levelSystem.getProgress() * 100)}% ` +
                    `totalXp=${Math.round(this.levelSystem.getTotalXp())}`);
            }
            // No shop (XP replaced it): auto-advance after a short breather so the run
            // flows. The slow-mo orb power-choice still provides the only real pause.
            // ?test advances immediately for a fully unattended stress pass.
            if (this.testMode) { this.waveManager?.startNextWave(); return; }
            this.waveBreatherRemaining = SurvivorsGameplayState.WAVE_BREATHER_SECONDS;
        });

        // Override spawn fn: spawn enemies at arena perimeter
        this.waveManager.setSpawnFn((type, eliteElement, bossStrengthMultiplier) => {
            this.enemyManager!.spawnSurvivorsEnemy(type, eliteElement, bossStrengthMultiplier);
        });

        // Wire basic-attack target provider to nearest alive enemy
        this.heroController.setTargetProvider(() => this.getNearestEnemy());

        // Ability manager — configure for chosen champion class
        this.abilityManager = new AbilityManager(this.game, this.enemyManager);
        this.abilityManager.configureForClass(this.currentChampionType);
        this.abilityManager.setHeroProvider(() => this.hero!.getPosition());
        this.abilityManager.setHero(this.hero);
        // Multishot's magical-arrow layer force-casts each equipped autocast slot.
        this.abilityManager.setPowerSlots(this.powerSlots);
        // Space-bar dash: direction comes from current movement input (WASD/joystick),
        // class flavor from the chosen champion, and the position drive routes back
        // into HeroController so position + invulnerability live in one place.
        this.abilityManager.setDirectionProvider(() => this.heroController!.getMoveInput());
        this.abilityManager.setChampionTypeProvider(() => this.currentChampionType);
        this.abilityManager.setDashOverride((target, duration, mode, onComplete) => {
            this.heroController!.startDashOverride(target, duration, mode, onComplete);
        });
        // Whirlwind ticks reuse the basic attack's hit pipeline (crit / lifesteal /
        // knockback / enchantments) via the hero controller.
        this.abilityManager.setMeleeAoeHit((center, radius) => {
            this.heroController?.applyAttackHitsInRadius(center, radius);
        });
        this.abilityManager.prewarmAbilityEffects();
        this.prewarmPowerEffects();

        // Snapshot the post-setup scene resource counts as the watchdog baseline.
        // Everything that legitimately persists for the whole run (hero, arena,
        // grass, prewarmed cached FX materials) exists by now; later growth at
        // wave-clear time is measured against this floor.
        this.captureResourceBaseline();

        // Map class-specific ultimate IDs → GLB clip + duration so the hero plays
        // the right animation when the player presses an ultimate button. The clip
        // plays as a forced "special" channel — basic attacks suspend for the
        // whole duration. When `duration` exceeds the clip's natural length the
        // clip loops (Whirlwind ticks for 5s so the slash should keep going).
        // Whirlwind speed bumped 1.5 → 2.2 to read more like a tornado.
        const ABILITY_CLIPS: Partial<Record<string, { suffix: string; duration?: number; speed?: number }>> = {
            // Barbarian (Aulus)
            whirlwind: { suffix: 'aulus_warrior_of_ferocity_in_game_skill3',   duration: 5.0, speed: 2.2 },
            smash:     { suffix: 'aulus_warrior_of_ferocity_in_game_skill2_3' }, // one-shot, natural length
        };
        this.abilityManager.setOnActivate((abilityId) => {
            const clip = ABILITY_CLIPS[abilityId];
            if (!clip || !this.hero) return;
            const hero = this.hero as { playAbilityClip?: (s: string, d?: number, sp?: number) => void };
            if (typeof hero.playAbilityClip === 'function') {
                hero.playAbilityClip(clip.suffix, clip.duration, clip.speed ?? 1.0);
            }
        });

        // ---------- UI ----------

        // Mobile virtual joystick
        this.joystick = new SurvivorsJoystick(this.ui);
        this.joystick.onDirection((dx, dz) => {
            if (this.heroController) this.heroController.setExternalInput(dx, dz);
        });

        // HUD (HP bar, gold, power slots, ultimate buttons)
        // Built AFTER configureForClass so HUD reads the correct ability IDs.
        this.hud = new Hud(this.gameUI!, this.abilityManager, this.game);

        if (this.runItems) {
            this.hud.setRunItems(this.runItems);
        }

        // Q / E / Space → first / second / third ultimate. Mirrors a tap on the HUD
        // button exactly (Hud.triggerUltimateByIndex shares the same closure as
        // the press handler). The scene-wide onKeyboardObservable is cleared by
        // Game.cleanupScene() on state exit, so no manual disposal needed.
        // Space-bar = dash/jump/teleport (always index 2 — every class has it).
        this.game.getScene().onKeyboardObservable.add((kbInfo) => {
            if (kbInfo.type !== KeyboardEventTypes.KEYDOWN) return;
            const key = kbInfo.event.key.toLowerCase();
            if (key === 'q') this.hud?.triggerUltimateByIndex(0);
            else if (key === 'e') this.hud?.triggerUltimateByIndex(1);
            else if (key === ' ') {
                this.hud?.triggerUltimateByIndex(2);
                kbInfo.event.preventDefault?.(); // stop the browser from scrolling
            }
            else if (key === 'escape') this.hud?.togglePause();
            else if (this.testMode && key === ']') this.cycleTestFusion();
            else if (this.testMode && key === '\\') this.stressLoad();
        });

        // Overlays
        this.powerChoice     = new PowerChoiceOverlay(this.gameUI!.layer('overlay'));
        this.replaceSlotOverlay = new ReplaceSlotOverlay(this.gameUI!.layer('overlay'));

        // DEV: ?test → no powers equipped at start; add them on demand with \ (stress)
        //      or cycle archetypes with ]. testFusions stays primed for both.
        this.testMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test');
        if (this.testMode) {
            this.testFusions = getFusionsForClass(this.currentChampionType);
            this.testFusionIndex = 0;
            if (this.heroController) this.heroController.debugInvulnerable = true; // survive the stress horde
        }

        // Off-screen enemy indicators (all tiers)
        this.offscreenIndicators = new OffscreenEnemyIndicators(
            this.ui,
            this.scene,
            this.heroController.getCamera(),
            () => this.enemyManager?.getEnemies() ?? [],
        );

        this.game.hideLoadingScreen();
    }

    /** Prewarm the power-FX shaders (ring/vortex/zone/volley per element) so the
     *  first fusion/ultimate cast in combat doesn't cold-compile. Fires each
     *  no-target primitive once per element at the hero, renders, then tears them
     *  all down via resetPowerEffects(). */
    private prewarmPowerEffects(): void {
        if (!this.scene || !this.hero) return;
        const scene = this.scene;
        const p = this.hero.getPosition();
        const elems: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];
        for (const el of elems) {
            aoeBurst(scene, [], p.x, p.z, { radius: 1, damage: 0, element: el, ringLifeS: 0.05 });
            gatherVortex(scene, [], p.x, p.z, { radius: 1, durationS: 0.05, pull: 0, tickDamage: 0, element: el });
            persistentZone(scene, [], p.x, p.z, { radius: 1, durationS: 0.05, tickIntervalS: 0.05, tickDamage: 0, element: el });
            omniVolley(scene, [], p.x, p.z, { count: 2, speed: 4, damage: 0, element: el, lifeS: 0.05 });
        }
        scene.render(); // kick shader compilation for the spawned FX meshes
        resetPowerEffects(); // dispose all the just-spawned prewarm FX + observers
    }

    /** Ported from the BabylonJS playground ancient-ruins scene — drops in a warm
     *  dusk skybox, an env IBL cube map for PBR reflections, an overhead orange
     *  spot light, and a tileable stone texture over the arena's central ground.
     *  All assets fetched from raw.githubusercontent.com (same as the playground)
     *  so we don't need to bundle them. */
    private applyRuinsAmbience(): void {
        if (!this.scene) return;
        const scene = this.scene;
        const envBase = 'https://raw.githubusercontent.com/CedricGuillemet/dump/master/starryassets/env/';
        const envFiles = ['px.png', 'py.png', 'pz.png', 'nx.png', 'ny.png', 'nz.png'].map(f => envBase + f);

        // ── Env cube + skybox ─────────────────────────────────────────────────
        const envTexture = CubeTexture.CreateFromImages(envFiles, scene);
        // Use the env as scene IBL so the rigged GLB heroes pick up nice reflections.
        // intensity reduced 0.6 → 0.25 — IBL was adding a huge uniform ambient
        // term on every surface, which is the dominant cause of the "full bright"
        // / flat look. 0.25 still gives heroes some sky reflection.
        scene.environmentTexture = envTexture;
        scene.environmentIntensity = 0.25;

        const skydome = MeshBuilder.CreateBox('ruinsSky', { size: 1000, sideOrientation: Mesh.BACKSIDE }, scene);
        skydome.rotation.y = Math.PI;
        skydome.isPickable = false;
        const skyMat = new BackgroundMaterial('ruinsSkyMat', scene);
        const skyTex = envTexture.clone();
        skyTex.coordinatesMode = Texture.SKYBOX_MODE;
        skyMat.reflectionTexture = skyTex;
        skydome.material = skyMat;
        // Track the cloned sky texture + material for disposal in exit().
        this.skyTexture = skyTex;
        this.skyMaterial = skyMat;

        // (Removed ruinsSpot SpotLight — it didn't cast shadows and was
        // washing out the directional's shadows at world origin where the
        // hero spawns. The hemispheric + directional combo gives the arena
        // enough ambient by itself.)

        // ── Shadow generator ──────────────────────────────────────────────────
        // ESM (ExponentialShadowMap) so the procedural-grass custom shader
        // can sample the map as a plain sampler2D — Babylon's PCF maps use a
        // sampler2DShadow which can't be sampled this way. ESM also gives
        // softer edges for free.
        if (this.shadowSourceLight) {
            // Position the light high above the arena center so the orthographic
            // shadow frustum covers the whole disc symmetrically. Offset a bit
            // on +X/+Z so shadows have a visible angle (not straight-down).
            // Ortho extents tightened to ~arena radius (25) so the 1024² shadow
            // map gives ~0.05 world units per texel — sharper shadow edges.
            this.shadowSourceLight.position = new Vector3(8, 40, 8);
            this.shadowSourceLight.shadowMinZ = 1;
            this.shadowSourceLight.shadowMaxZ = 100;
            this.shadowSourceLight.orthoLeft   = -30;
            this.shadowSourceLight.orthoRight  =  30;
            this.shadowSourceLight.orthoTop    =  30;
            this.shadowSourceLight.orthoBottom = -30;
            this.shadowSourceLight.autoCalcShadowZBounds = false;

            // Re-enable scene-wide shadow rendering — Game.setupScene() sets
            // `scene.shadowsEnabled = false` as a perf default (no shadows in
            // the menu state). Survivors needs them on Medium/High; Low turns
            // shadow rendering off entirely (set from the main-menu graphics
            // preset).
            scene.shadowsEnabled = GameSettings.getGraphicsQuality() !== 'low';

            // Default PCF shadow map — Babylon's most tested path. Grass
            // can't sample this kind of texture from a custom shader, so the
            // grass shadow integration is disabled (shadowGenerator: undefined
            // below) — just trying to get the StandardMaterial ground to show
            // hero shadows first as a sanity check.
            const shadow = new ShadowGenerator(1024, this.shadowSourceLight);
            shadow.usePercentageCloserFiltering = true;
            shadow.filteringQuality = ShadowGenerator.QUALITY_LOW;
            shadow.bias = 0.0008;
            shadow.normalBias = 0.02;
            shadow.darkness = 0.4;
            shadow.transparencyShadow = false;
            // No frustum edge falloff — gives a hard outer edge but avoids
            // unintended "fading" mid-arena that some receivers can show.
            shadow.frustumEdgeFalloff = 0;
            const shadowMap = shadow.getShadowMap();
            // refreshRate 2: shadow map every other frame (top-down: imperceptible, ~halves shadow cost)
            if (shadowMap) shadowMap.refreshRate = 2;
            this.shadowGenerator = shadow;

            for (const m of scene.meshes) {
                if (m.name.startsWith('arenaGround')) {
                    m.receiveShadows = true;
                }
            }
        }

        // ── Grass blades ──────────────────────────────────────────────────────
        // Texture-free, sampler-free shader → identical pipeline state on
        // WebGL and WebGPU. 8000 hardware-instanced blades with vertex
        // lighting and a sin-based wind sway.
        this.grass = createProceduralGrass(scene, {
            arenaRadius: this.map?.getArenaRadius() ?? 20,
            bladeCount: bladeCountForQuality(GameSettings.getGraphicsQuality()),
            bladeWidth: 0.06,
            bladeHeight: 0.45,
            directionalLight: this.shadowSourceLight ?? undefined,
            // shadowGenerator: this.shadowGenerator ?? undefined, // disabled while debugging
            ambientColor: new Color3(0.42, 0.50, 0.32),
            colorRoot: new Color3(0.18, 0.26, 0.10),
            colorTip:  new Color3(0.55, 0.78, 0.30),
            colorDry:  new Color3(0.72, 0.65, 0.32),
            influencerRadius: 0.9,
            influencerStrength: 0.55,
        });



        // ── Torch (point-light) shadow generator ──────────────────────────────
        // Cube shadow map on the hero's torch so bosses + heavies cast a
        // shadow pool around the hero. 512 cube = 6 × 512² render targets per
        // frame — heavy, but the caster set is intentionally small (bosses,
        // tanks, etc). Hero itself is excluded so it doesn't block its own
        // light. Re-uses the pre-registered torch from Game.setupScene.
        const torch = this.game.getHeroTorch();
        torch.shadowMinZ = 0.5;
        torch.shadowMaxZ = 12;
        const torchShadow = new ShadowGenerator(512, torch);
        torchShadow.useExponentialShadowMap = true; // soft + fast on point lights
        torchShadow.bias = 0.001;
        torchShadow.darkness = 0.55; // a touch lighter than the directional
        torchShadow.transparencyShadow = false;
        this.torchShadowGenerator = torchShadow;

        // The torch is left dormant (intensity 0; enableTorch() is never called in
        // the current design — see startRun). A point-light ShadowGenerator renders
        // a 6-face cube depth map EVERY frame for every registered caster as long as
        // light.shadowEnabled is true — gated on shadowEnabled, NOT intensity — so
        // while the torch emits no light this is pure GPU waste (zero visible shadow),
        // roughly doubling boss-wave shadow cost. Disable shadow casting until the
        // torch is actually lit. NB: if Champion.enableTorch() is ever wired into a
        // run, it must set heroTorch.shadowEnabled = true to restore the shadow pool.
        torch.shadowEnabled = false;
    }

    /** Public so EnemyManager can register boss/elite casters. */
    public getShadowGenerator(): ShadowGenerator | null {
        return this.shadowGenerator;
    }

    /** Public so EnemyManager can register boss/elite casters for the torch. */
    public getTorchShadowGenerator(): ShadowGenerator | null {
        return this.torchShadowGenerator;
    }

    private spawnItemDrop(position: Vector3, waveTier: number): void {
        const itemId = RunItems.itemForTier(waveTier);
        if (!itemId) return;
        if (this.runItems?.hasItem(itemId)) return; // Already owned — no re-drop today.

        const heroProvider = () => this.hero!.getPosition();
        const drop = new ItemDrop(
            this.scene!,
            position,
            itemId,
            heroProvider,
            {
                pickupRadius: 1.2,
                magnetRadius: 4.0,
                magnetSpeed: 8.0,
                onPickup: (id: ItemId) => this.onItemPickup(id),
            },
        );
        this.itemDrops.push(drop);
    }

    private onItemPickup(id: ItemId): void {
        if (!this.runItems) return;
        this.runItems.grant(id);
        this.hud?.pulseItem(id);

        // Pickup float text at the hero's position (spec: "+ <Item Name>").
        if (this.damageNumbers && this.hero) {
            this.damageNumbers.showText(this.hero.getPosition(), `+ ${ITEM_DISPLAY_NAMES[id]}`, ITEM_FLOAT_COLOR[id]);
        }

        // 300ms slow-mo pickup punch.
        this.timeScale = 0.6;
        setTimeout(() => { this.timeScale = 1.0; }, 300);
    }

    /**
     * Spawn the Extra Life revive shield: a translucent green bubble that follows
     * the hero for the invulnerability window. Material is cached by a bounded key
     * and the mesh is freed (cached material untouched) in removeReviveShield().
     */
    private spawnReviveShield(): void {
        if (!this.scene || !this.hero) return;
        this.removeReviveShield(); // idempotent guard
        const scene = this.scene;
        const hero = this.hero;
        const bubble = MeshBuilder.CreateSphere('reviveShield', { diameter: 3.2, segments: 12 }, scene);
        bubble.isPickable = false;
        bubble.material = getCachedMaterial(scene, 'reviveShieldMat', m => {
            m.emissiveColor = new Color3(0.27, 0.88, 0.45);
            m.diffuseColor = new Color3(0, 0, 0);
            m.disableLighting = true;
            m.alpha = 0.26;
            m.backFaceCulling = false;
        });
        const p0 = hero.getPosition();
        bubble.position.set(p0.x, p0.y + 1.2, p0.z);
        this.reviveShieldObs = scene.onBeforeRenderObservable.add(() => {
            const p = hero.getPosition();
            bubble.position.set(p.x, p.y + 1.2, p.z);
            bubble.rotation.y += 0.03; // slow shimmer spin
        });
        this.reviveShieldMesh = bubble;
    }

    /** Remove the revive shield bubble + its follow observer (idempotent). */
    private removeReviveShield(): void {
        if (this.reviveShieldObs && this.scene) {
            this.scene.onBeforeRenderObservable.remove(this.reviveShieldObs);
        }
        this.reviveShieldObs = null;
        if (this.reviveShieldMesh) {
            this.reviveShieldMesh.dispose(); // cached material is shared — leave it
            this.reviveShieldMesh = null;
        }
    }

    // ── M3 co-op message builders ─────────────────────────────────────────────

    /** Build a SpawnMsg for an enemy that was just spawned by the host. */
    private buildSpawnMsg(e: Enemy): SpawnMsg {
        const pos = e.getPosition();
        const isClone = (e instanceof MilestoneBoss) ? e.isClone : false;
        const enrageOriginId = isClone
            ? ((e as MilestoneBoss).getEnrageOrigin()?.id ?? undefined)
            : undefined;
        return {
            t: 'spawn',
            id: e.id,
            type: e.netType,
            x: pos.x,
            z: pos.z,
            maxHealth: e.getMaxHealth(),
            eliteElement: (e.isElite && e.eliteDropElement) ? e.eliteDropElement : undefined,
            isClone: isClone || undefined,
            enrageOriginId,
        };
    }

    /** Build a DeathMsg for an enemy that just died. */
    private buildDeathMsg(e: Enemy): DeathMsg {
        const pos = e.getPosition();
        const isClone = (e instanceof MilestoneBoss) ? e.isClone : false;
        return {
            t: 'death',
            id: e.id,
            x: pos.x,
            z: pos.z,
            isElite: e.isElite,
            isClone,
            reward: e.getReward(),
            eliteElement: (e.isElite && e.eliteDropElement) ? e.eliteDropElement : undefined,
        };
    }

    /** Build a full world snapshot for broadcast to the guest. */
    private buildSnapshot(): SnapshotMsg {
        // Heroes: [local hero (id=0), ghost (id=1)]
        const heroes: SnapshotMsg['heroes'] = [];
        if (this.hero && this.heroController) {
            const p = this.hero.getPosition();
            const ry = (this.hero as unknown as { mesh: { rotation: { y: number } } | null }).mesh?.rotation.y ?? 0;
            heroes.push({
                id: 0,
                x: p.x,
                y: p.y,
                z: p.z,
                ry,
                hp: this.heroController.getHealth().current,
                anim: 0, // best-effort: 0=idle/walk; detailed anim encoding deferred
                dx: 0, dz: 0, // real values wired in scene task
                alive: this.heroController.getHealth().current > 0,
                level: 1, xp: 0, // real values wired in scene task
            });
        }
        if (this.coopGhost) {
            const gp = this.coopGhost.getPosition();
            const gry = (this.coopGhost as unknown as { mesh: { rotation: { y: number } } | null }).mesh?.rotation.y ?? 0;
            // Part C: carry the host-tracked guest HP in the snapshot so the guest
            // can apply it as snapshot-authoritative HP instead of computing locally.
            heroes.push({
                id: 1, x: gp.x, y: gp.y, z: gp.z, ry: gry, hp: this.guestHeroHp, anim: 0,
                dx: 0, dz: 0, // real values wired in scene task
                alive: this.guestHeroHp > 0,
                level: 1, xp: 0, // real values wired in scene task
            });
        }

        // Enemies: pack each live enemy
        const enemies: SnapshotMsg['enemies'] = [];
        if (this.enemyManager) {
            for (const e of this.enemyManager.getEnemies()) {
                if (!e.isAlive()) continue;
                const ep = e.getPosition();
                const eRy = (e as unknown as { mesh: { rotation: { y: number } } | null }).mesh?.rotation.y ?? 0;
                const md = e.getMeleeDisplay();
                const flags = packEnemyFlags({
                    frozen:   (e as unknown as { isFrozen: boolean }).isFrozen  ?? false,
                    stunned:  (e as unknown as { isStunned: boolean }).isStunned ?? false,
                    confused: (e as unknown as { isConfused: boolean }).isConfused ?? false,
                    flying:   e.isEnemyFlying(),
                    elite:    e.isElite,
                    meleePhase: md.phase,
                });
                enemies.push({
                    id: e.id,
                    x: ep.x,
                    z: ep.z,
                    ry: eRy,
                    hp: e.getHealth(),
                    flags,
                    anim: md.phase > 0 ? 2 : 1, // 0 idle, 1 walk, 2 attack (rough)
                });
            }
        }

        // Wave state
        const wave: SnapshotMsg['wave'] = {
            n: this.waveManager?.getCurrentWave() ?? 0,
            alive: this.waveManager?.getRemainingEnemiesInWave() ?? 0,
            inProgress: (this.waveManager?.isWaveInProgress() ? 1 : 0) as 0 | 1,
            breather: this.waveBreatherRemaining,
        };

        return {
            t: 'snapshot',
            tick: this._snapshotTick,
            ackSeq: 0, // hero-seq ack deferred to M3-combat
            timeScale: this.timeScale,
            heroes,
            enemies,
            wave,
        };
    }

    /** Gather end-of-run stats and transition to game-over. */
    private buildAndSendRunSummary(): void {
        const timeSurvivedSec = (performance.now() - this.runStartTime) / 1000;
        const waveReached = this.waveManager?.getCurrentWave() ?? 0;
        const kills = this.playerStats?.getTotalKills() ?? 0;
        const goldCollected = this.playerStats?.getTotalMoneyEarned() ?? 0; // == total XP earned now
        const levelReached = this.levelSystem?.getLevel() ?? 1;

        const finalLoadout = (this.powerSlots?.getSlots() ?? [])
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .map(s => ({ name: s.def.name, level: s.state.level, icon: s.def.icon, tier: s.def.tier }));

        const summary: SurvivorsRunSummary = {
            waveReached,
            timeSurvivedSec,
            kills,
            goldCollected,
            levelReached,
            finalLoadout,
            championType: this.currentChampionType,
        };

        const gos = this.game.getStateManager().getState('gameOver') as GameOverState;
        if (gos) gos.setSurvivorsSummary(summary);
        this.game.getStateManager().changeState('gameOver');
    }

    public exit(): void {
        for (const d of this.powerDrops) d.dispose();
        this.powerDrops = [];

        for (const d of this.itemDrops) d.dispose();
        this.itemDrops = [];
        this.runItems = null;

        this.removeReviveShield();

        this.championSelect?.close();
        this.championSelect = null;

        this.offscreenIndicators?.dispose();
        this.offscreenIndicators = null;

        this.powerSlots?.dispose();
        this.powerSlots = null;

        this.abilityManager = null;

        this.levelSystem = null;
        this.appliedMaxHpBonus = 0;
        this.waveBreatherRemaining = 0;

        this.replaceSlotOverlay?.close();
        this.replaceSlotOverlay = null;

        this.powerChoice?.close();
        this.powerChoice = null;

        Enemy.onDamageCallback = null;
        Enemy.onRewardCallback = null;
        Enemy.onKillCallback = null;
        Enemy.onShatterCallback = null;
        resetPowerEffects();
        if (this.testLabelEl) { this.testLabelEl.remove(); this.testLabelEl = null; }
        this.testMode = false;
        this.testFusions = [];
        this.testFusionIndex = 0;
        this.damageNumbers?.dispose();
        this.damageNumbers = null;

        this.hud?.dispose();
        this.hud = null;
        this.gameUI?.dispose();
        this.gameUI = null;

        this.waveManager?.dispose();
        this.waveManager = null;

        this.enemyManager?.dispose();
        this.enemyManager = null;

        this.stopLongTaskObserver();

        Enemy.critProvider = null;
        this.playerStats = null;

        this.joystick?.dispose();
        this.joystick = null;

        this.heroController?.dispose();
        this.heroController = null;

        this.coopSession?.dispose();
        this.coopSession = null;
        this.coopGhost?.dispose();
        this.coopGhost = null;
        this.coopGhostPending = false;
        // Part D: reset host-tracked guest-hero HP state and providers array.
        this.guestHeroHp = 0;
        this.guestHeroMaxHp = 0;
        this.guestHeroAlive = true;
        this._heroProviders = [];
        // M3: clear guest enemy registry and reset snapshot state.
        this.guestEnemies?.clear();
        this.guestEnemies = null;
        this._guestWave = null;
        this._snapshotAccumS = 0;
        this._snapshotTick = 0;

        this.hero?.dispose();
        this.hero = null;

        this.ui?.dispose();
        this.ui = null;

        this.map?.dispose();
        this.map = null;

        this.grass?.dispose();
        this.grass = null;

        // Dispose per-run lights, shadow generators, and env/sky textures. None of
        // these are meshes / particle systems / ADT textures, so Game.cleanupScene()
        // does NOT free them — without this they accumulate one set per run on the
        // persistent (never-disposed) scene. Each leaked ShadowGenerator keeps
        // rendering a full shadow map every frame (refreshRate=1), the dominant
        // "later runs freeze worse" cost. Dispose each generator BEFORE the light it
        // references; disposing the torch generator does NOT touch the shared
        // heroTorch light (only its per-run generator).
        this.shadowGenerator?.dispose();
        this.shadowGenerator = null;
        this.torchShadowGenerator?.dispose();
        this.torchShadowGenerator = null;
        this.shadowSourceLight?.dispose();
        this.shadowSourceLight = null;
        if (this.scene?.environmentTexture) {
            this.scene.environmentTexture.dispose();
            this.scene.environmentTexture = null;
        }
        this.skyTexture?.dispose();
        this.skyTexture = null;
        this.skyMaterial?.dispose();
        this.skyMaterial = null;

        // Free the cross-run GPU resource pools. By now every survivors mesh that
        // referenced these (hero, enemies, drops, projectiles) has been disposed
        // above, so disposing the shared materials + pooled meshes is safe — and it
        // bounds cross-run growth to a single run even if a future caller ever
        // introduces an unbounded cache key. Cached materials are recompiled (and
        // re-prewarmed) on the next run start. ProjectilePool reassigns materials on
        // acquire, so clearing the cache never leaves a pooled mesh on a dead material.
        clearMaterialCache();
        clearProjectilePools();

        this.scene = null;
        this.timeScale = 1.0;
        this.runPerks = { damageMultiplier: 1.0, moveSpeedMultiplier: 1.0, attackRangeMultiplier: 1.0 };
    }

    public update(deltaTime: number): void {
        // If game hasn't started yet (champion select showing), skip game updates
        if (!this.heroController) return;

        // True pause while any blocking overlay is open (power choice, replace-slot, shop)
        if (this.isPausedForOverlay()) return;

        const dt = deltaTime * this.timeScale;

        // Per-subsystem timing is gated behind a compile-time-style flag —
        // when off (production), no performance.now / object allocations run.
        const profile = SurvivorsGameplayState.PROFILE_UPDATE;
        const _t0 = profile ? performance.now() : 0;
        let _tMark = _t0;
        let _times: Record<string, number> | null = null;
        if (profile) _times = {};
        const _measure = (key: string) => {
            if (!profile || !_times) return;
            const now = performance.now();
            _times[key] = now - _tMark;
            _tMark = now;
        };

        this.heroController.update(dt);
        if (this.hero) this.hero.update(dt);

        // --- Co-op M2 sync: broadcast our pose, render the remote ghost ---
        if (this.coopSession && this.hero) {
            const hp = this.hero.getPosition();
            const ry = (this.hero as unknown as { mesh: Mesh | null }).mesh?.rotation.y ?? 0;
            // NOTE(M3): the per-frame object literal here is intentionally simple for
            // M2; binary encoding + scratch reuse arrive at M3 (spec §3/§6).
            this.coopSession.sendLocalPose({ x: hp.x, y: hp.y, z: hp.z, ry }, 1);

            // Render ~100ms in the past for smooth interpolation.
            const renderT = performance.now() - 100;
            const champ = this.coopSession.getRemoteChamp();
            const pose = champ ? this.coopSession.getRemotePose(renderT) : null;

            // Lazily spawn the ghost once we know the teammate's champion. The GLB
            // asset is REQUIRED: Champion only builds a mesh for barbarian when an
            // asset is passed, and passing it makes every ghost match the real
            // hero's GLB look. Loading is async (cached after enter()'s preload).
            if (champ && !this.coopGhost && !this.coopGhostPending) {
                this.coopGhostPending = true;
                const champType = champ as 'barbarian' | 'ranger' | 'mage';
                const assetP = loadChampionAsset(champType, this.scene!);
                const ready = assetP ? assetP.catch(() => null) : Promise.resolve(null);
                void ready.then((asset) => {
                    this.coopGhostPending = false;
                    // The run may have ended (exit nulls coopSession) while loading.
                    if (!this.coopSession || this.coopGhost) return;
                    this.coopGhost = new Champion(this.game, [], null, champType, asset ?? undefined);
                    this.coopGhost.controlMode = 'player'; // no AI; placed from network
                    // Shared/tethered camera: set once; reads both heroes' live
                    // positions each frame. Null-guarded (hero can be nulled on death).
                    this.heroController?.setCameraFocusProvider(() => {
                        const self = this.hero?.getPosition();
                        const mate = this.coopGhost?.getPosition();
                        if (!self || !mate) return { x: 0, z: 0, height: 20 };
                        return computeCameraFocus(
                            { x: self.x, z: self.z },
                            { x: mate.x, z: mate.z },
                            { baseHeight: 20, maxHeight: 30, zoomPerUnit: 0.4 },
                        );
                    });
                    // Part C (Task 9 ghost targeting provider): on the host, push the ghost
                    // into _heroProviders so enemies target the nearest of both heroes.
                    // isAlive() returns guestHeroAlive so a dead guest is no longer targeted.
                    // The _heroProviders array is shared with EnemyManager (same reference),
                    // so existing enemies pick up the new provider immediately via seekTargets.
                    if (this.coopSession.role === 'host') {
                        const ghost = this.coopGhost;
                        this._heroProviders.push({
                            getPosition: () => ghost.getPosition(),
                            isAlive: () => this.guestHeroAlive,
                        });
                    }
                });
            }
            if (this.coopGhost && pose) {
                const g = this.coopGhost as unknown as { position: Vector3; mesh: Mesh | null };
                // Estimate velocity from the pose delta (current g.position holds the
                // previous applied pose) to drive the walk animation, then snap to the
                // authoritative interpolated pose so position stays exact.
                if (dt > 1e-4) {
                    this._coopGhostVel.set((pose.x - g.position.x) / dt, 0, (pose.z - g.position.z) / dt);
                    this.coopGhost.setPlayerVelocity(this._coopGhostVel);
                }
                this.coopGhost.update(dt); // advances walk/idle animation
                g.position.set(pose.x, pose.y, pose.z); // authoritative position
                if (g.mesh) {
                    g.mesh.position.x = pose.x;
                    g.mesh.position.z = pose.z;
                    g.mesh.rotation.y = pose.ry; // network yaw, after update()
                }
            }
        }

        // M3: determine the co-op role for this frame. null = single-player (no
        // coopSession) or before the connection handshake completes. The branch is
        // checked once and reused below so a connection that completes mid-frame
        // doesn't mix host + guest paths within the same update() call.
        const coopRole = this.coopSession?.role ?? null;

        // Between-wave breather → auto-advance (shop removed). Uses raw wall-clock
        // deltaTime; only ticks here because update() returns early while any blocking
        // overlay is open (so it never advances mid power-choice).
        // Guest: the host drives wave progression — never tick the breather locally.
        if (coopRole !== 'guest' && this.waveBreatherRemaining > 0) {
            this.waveBreatherRemaining -= deltaTime;
            if (this.waveBreatherRemaining <= 0) {
                this.waveBreatherRemaining = 0;
                this.waveManager?.startNextWave();
            }
        }

        // Keep the procedural-grass shader's torch uniforms in sync with the
        // real heroTorch PointLight. When the torch is off (intensity 0), the
        // grass glow goes off too — previously it was always on regardless.
        if (this.grass && this.hero) {
            const torch = this.game.getHeroTorch();
            if (torch.intensity > 0) {
                // Mutate the pre-allocated torch-opts struct in place so we
                // don't churn a fresh object every frame.
                const opts = this._scratchTorchOpts;
                opts.position.copyFrom(this.hero.getPosition());
                opts.color.copyFrom(torch.diffuse);
                opts.intensity = TORCH_INTENSITY * (torch.intensity / 5.0);
                opts.range = TORCH_RANGE;
                this.grass.setTorch(opts);
            } else {
                this.grass.setTorch(null);
            }

            // Character grass displacement: hero + nearest 15 enemies push
            // surrounding blades outward as they move. Shader caps at 16,
            // so we trim if more are alive nearby. Reuse the scratch array —
            // setInfluencers reads the contents synchronously, so swapping the
            // contents in-place each frame is safe.
            const influencers = this._scratchInfluencers;
            influencers.length = 0;
            influencers.push(this.hero.getPosition());
            if (this.enemyManager) {
                const enemies = this.enemyManager.getEnemies();
                for (let i = 0; i < enemies.length && influencers.length < 16; i++) {
                    const ep = (enemies[i] as unknown as { position?: Vector3; getPosition?: () => Vector3 });
                    const pos = ep.getPosition?.() ?? ep.position;
                    if (pos) influencers.push(pos);
                }
            }
            this.grass.setInfluencers(influencers);
        }

        _measure('hero');

        // M3 role split: host/single-player run the full authoritative simulation;
        // guest skips it entirely and instead applies the latest host snapshot to
        // the render-only GuestEnemies + own hero HP. This is the keystone guard —
        // changing this 'if' is the only way enemy/wave simulation runs on a guest.
        if (coopRole !== 'guest') {
            // Host / single-player: authoritative simulation (unchanged behavior).
            if (this.waveManager) this.waveManager.update(dt);
            _measure('wave');
            if (this.enemyManager) this.enemyManager.update(dt);
            _measure('enemies');

            // Contact damage
            this.applyContactDamage(dt);
            _measure('contact');
        } else {
            // Guest: do NOT tick enemyManager / waveManager / breather.
            // Apply the latest host snapshot to drive the render-only enemies
            // and update the local wave HUD from the snapshot's wave state.
            const snap = this.coopSession!.getLatestSnapshot();
            if (snap) {
                // Drive render-only enemy positions / HP / flags.
                if (this.guestEnemies) {
                    this.guestEnemies.applySnapshot(snap.enemies);
                }
                // Mirror the host wave state so the guest HUD shows live info.
                this._guestWave = {
                    wave: snap.wave.n,
                    enemiesAlive: snap.wave.alive,
                    inProgress: snap.wave.inProgress === 1,
                };
                // Part C: apply this guest hero's authoritative HP from the snapshot.
                // The guest is hero id=1 in heroes[]. The host computed contact damage
                // for both heroes so the guest does NOT compute it locally.
                // heroController is non-null here (update() guards at the top).
                const guestEntry = snap.heroes.find(h => h.id === 1);
                if (guestEntry && this.heroController) {
                    this.heroController.setHealth(guestEntry.hp);
                }
            }
            _measure('guestApply');
        }

        // Power auto-fire
        if (this.powerSlots) this.powerSlots.update(dt);
        _measure('powers');

        // Element visual decorations on the hero's weapon
        if (this.hero && this.powerSlots) {
            this.hero.updateElementVisuals(this.powerSlots.getActiveElements());
        }
        _measure('elemVis');

        // Manual ultimates (Meteor Strike + Frost Nova)
        if (this.abilityManager) this.abilityManager.update(dt);
        _measure('abilities');

        // Power drops + item drops — tick + swap-pop dead entries in one
        // backwards pass (the previous .filter rebuilt both arrays every
        // frame, even when nothing was dying).
        for (let i = this.powerDrops.length - 1; i >= 0; i--) {
            const d = this.powerDrops[i];
            d.update(dt);
            if (!d.isAlive()) {
                const last = this.powerDrops.length - 1;
                if (i !== last) this.powerDrops[i] = this.powerDrops[last];
                this.powerDrops.pop();
            }
        }
        for (let i = this.itemDrops.length - 1; i >= 0; i--) {
            const d = this.itemDrops[i];
            d.update(dt);
            if (!d.isAlive()) {
                const last = this.itemDrops.length - 1;
                if (i !== last) this.itemDrops[i] = this.itemDrops[last];
                this.itemDrops.pop();
            }
        }
        _measure('drops');

        this.damageNumbers?.update(dt);
        _measure('damageNum');

        // HUD update — reuse the scratch waveInfo struct.
        if (this.hud && this.powerSlots && this.playerStats) {
            let waveInfo: { wave: number; enemiesAlive: number; inProgress: boolean } | undefined;
            if (coopRole === 'guest') {
                // Guest: read wave state from the latest host snapshot (_guestWave);
                // the local waveManager is idle and would show 0 permanently.
                waveInfo = this._guestWave ?? undefined;
            } else if (this.waveManager) {
                waveInfo = this._scratchWaveInfo;
                waveInfo.wave = this.waveManager.getCurrentWave();
                waveInfo.enemiesAlive = this.waveManager.getRemainingEnemiesInWave() ?? 0;
                waveInfo.inProgress = this.waveManager.isWaveInProgress();
            }
            this.hud.update(
                this.heroController.getHealth(),
                { level: this.levelSystem?.getLevel() ?? 1, progress: this.levelSystem?.getProgress() ?? 0 },
                this.powerSlots.getSlots(),
                dt,
                waveInfo,
            );
        }
        _measure('hud');

        // Off-screen enemy indicators (all tiers)
        if (this.offscreenIndicators) this.offscreenIndicators.update();
        _measure('offscreenInd');

        // B4 — Host snapshot authoring at ~20 Hz. Accumulate raw deltaTime (not dt)
        // so the cadence is wall-clock based and isn't slowed by slow-mo overlays.
        // Only runs when we are the host and have an active session.
        if (coopRole === 'host' && this.coopSession) {
            this._snapshotAccumS += deltaTime;
            if (this._snapshotAccumS >= 0.05) {
                this._snapshotAccumS = Math.max(0, this._snapshotAccumS - 0.05);
                const snap = this.buildSnapshot();
                this.coopSession.sendEnemySnapshot(snap);
                this._snapshotTick++;
            }
        }

        if (profile && _times) {
            const totalMs = performance.now() - _t0;
            if (totalMs > 50) {
                const breakdown = Object.entries(_times)
                    .filter(([, ms]) => ms > 1)
                    .sort(([, a], [, b]) => b - a)
                    .map(([k, ms]) => `${k}=${Math.round(ms)}ms`)
                    .join(' ');
                console.warn(`[slow-frame] ${Math.round(totalMs)}ms · ${breakdown}`);
            }
        }
    }

    private isPausedForOverlay(): boolean {
        return !!(
            this.powerChoice?.isOpen() ||
            this.replaceSlotOverlay?.isOpen()
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orb pickup → Power Choice overlay
    // ─────────────────────────────────────────────────────────────────────────

    private onOrbPickup(element: string): void {
        // Hidden mechanic: every orb collected makes future enemy spawns +8%
        // tougher (geometric/compounding, per-run) so the buff tracks the
        // player's multiplicative per-orb damage growth. Applied BEFORE the
        // overlay guards so the penalty triggers on physical collection even in
        // the rare case an overlay is already up and the choice flow is skipped.
        this.enemyManager?.addOrbHpBonus(0.08);

        // DEV ?test: never raise the "Choose a Power" overlay — it would block an
        // unattended stress pass. Powers are force-equipped via the \ stress key.
        if (this.testMode) return;

        if (!this.powerSlots || !this.powerChoice || !this.playerStats) return;
        if (this.powerChoice.isOpen() || this.replaceSlotOverlay?.isOpen()) return;

        // Fusion / ultimate offers take priority over the normal cards.
        const fusionCards = this.buildFusionOfferCards();
        if (fusionCards && fusionCards.length > 0) {
            const cards = fusionCards.slice(0, 3);
            // Tier-2 fusion offers leave room for one normal upgrade; ultimate
            // offers (3 choices) fill the row themselves.
            if (cards[0].kind === 'fusion' && cards.length < 3) {
                const fill = this.buildOrbUpgradeCard(element) ?? this.buildWildcardCard(element);
                if (fill) cards.push(fill);
            }
            // Backstop: never present a lone card — pad with perks (a perk is
            // always a valid pick) so the offer row stays usable.
            while (cards.length < 2) cards.push(this.buildPerkCard());
            this.showChoiceCards(cards);
            return;
        }

        // Normal flow: power upgrade + wildcard + perk. cardA/cardB may be null
        // in late-game corners (owned+maxed, all powers owned) — pad with perks
        // so the player always sees a full 3-card row, as the old flow did.
        const cards: PowerCard[] = [];
        const cardA = this.buildOrbUpgradeCard(element);
        if (cardA) cards.push(cardA);
        const cardB = this.buildWildcardCard(element);
        if (cardB) cards.push(cardB);
        cards.push(this.buildPerkCard());
        while (cards.length < 3) cards.push(this.buildPerkCard());
        this.showChoiceCards(cards);
    }

    /**
     * Tier-3 (two maxed fusions → choose 1 of 3 class ultimates) takes priority
     * over tier-2 (two maxed base powers → fuse). Returns null when no offer.
     */
    private buildFusionOfferCards(): PowerCard[] | null {
        if (!this.powerSlots) return null;
        const maxed = this.powerSlots.getMaxedSlots();

        const maxedFusions = maxed.filter(s => s.def.tier === 'fusion');
        if (maxedFusions.length >= 2) {
            const a = maxedFusions[0];
            const b = maxedFusions[1];
            const offer = getUltimateOfferForFusions(this.currentChampionType, a.def, b.def);
            const cards = offer.map((ult): PowerCard => ({
                kind: 'ultimate',
                title: ult.name,
                subtitle: `ULTIMATE · ${ult.element} · forge from ${a.def.name} + ${b.def.name}`,
                element: ult.element,
                onPick: () => {
                    this.powerSlots!.fuse(a.def.id, b.def.id, ult.id);
                    this.playForgeVfx(true);
                },
            }));
            return cards.length > 0 ? cards : null;
        }

        const maxedBase = maxed.filter(s => (s.def.tier ?? 'base') === 'base');
        if (maxedBase.length >= 2) {
            const cards: PowerCard[] = [];
            for (let i = 0; i < maxedBase.length && cards.length < 2; i++) {
                for (let j = i + 1; j < maxedBase.length && cards.length < 2; j++) {
                    const aSlot = maxedBase[i];
                    const bSlot = maxedBase[j];
                    const fdef = getFusionFor(aSlot.def.id, bSlot.def.id);
                    if (!fdef) continue;
                    cards.push({
                        kind: 'fusion',
                        title: fdef.name,
                        subtitle: `FUSE  ·  ${aSlot.def.name} + ${bSlot.def.name}`,
                        element: fdef.element,
                        onPick: () => {
                            this.powerSlots!.fuse(aSlot.def.id, bSlot.def.id, fdef.id);
                            this.playForgeVfx(false);
                        },
                    });
                }
            }
            return cards.length > 0 ? cards : null;
        }

        return null;
    }

    /**
     * Owned, non-maxed slot that contains `element` (a fusion/ultimate counts if
     * it lists the element). Prefers the lowest tier so a fresh fusion levels
     * before an any-element ultimate hogs every orb.
     */
    private getOwnedSlotForElement(element: string): PowerSlot | null {
        if (!this.powerSlots) return null;
        const rank = (t?: string) => (t === 'ultimate' ? 2 : t === 'fusion' ? 1 : 0);
        let best: PowerSlot | null = null;
        for (const s of this.powerSlots.getSlots()) {
            if (!s) continue;
            if (s.state.level >= s.def.maxLevel) continue;
            const elems = s.def.elements ?? [s.def.element];
            if (!elems.includes(element as PowerElement)) continue;
            if (!best || rank(s.def.tier) < rank(best.def.tier)) best = s;
        }
        return best;
    }

    /** Card A: level the owned power for this element, or add the base power. */
    private buildOrbUpgradeCard(element: string): PowerCard | null {
        if (!this.powerSlots) return null;
        const owned = this.getOwnedSlotForElement(element);
        if (owned) {
            const def = owned.def;
            const lvl = owned.state.level;
            return {
                kind: 'power',
                title: def.name,
                element: def.element,
                subtitle: this.upgradeSubtitle(def, lvl),
                onPick: () => this.powerSlots!.levelUp(def.id),
            };
        }
        const orbDef = getPowerByElementAndClass(element as PowerElement, this.currentChampionType)
            ?? Object.values(POWER_DEFS)[0];
        // Owned but maxed (and no fusion partner) → no useful upgrade card.
        if (this.powerSlots.hasPower(orbDef.id)) return null;
        const slotsFull = this.powerSlots.emptySlotIndex() < 0;
        return {
            kind: 'power',
            title: orbDef.name,
            element: orbDef.element,
            subtitle: slotsFull ? `${this.newPowerSubtitle(orbDef)} (replace slot)` : this.newPowerSubtitle(orbDef),
            onPick: () => {
                if (slotsFull) this.openReplacePrompt(orbDef.id);
                else this.powerSlots!.addPower(orbDef.id);
            },
        };
    }

    /** Card B: upgrade a random other owned power, or offer a new class power. */
    private buildWildcardCard(element: string): PowerCard | null {
        if (!this.powerSlots) return null;
        const orbDefId = (getPowerByElementAndClass(element as PowerElement, this.currentChampionType)
            ?? Object.values(POWER_DEFS)[0]).id;
        const ownedSlots = this.powerSlots.getSlots().filter(
            (s): s is PowerSlot => s !== null && s.def.id !== orbDefId && s.state.level < s.def.maxLevel,
        );
        if (ownedSlots.length > 0) {
            const target = ownedSlots[Math.floor(Math.random() * ownedSlots.length)];
            return {
                kind: 'wildcard',
                title: target.def.name,
                element: target.def.element,
                subtitle: this.upgradeSubtitle(target.def, target.state.level),
                onPick: () => this.powerSlots!.levelUp(target.def.id),
            };
        }
        const classMap = getPowerMapForClass(this.currentChampionType);
        const classPowerIds = Object.values(classMap).filter(id => id !== orbDefId && !this.powerSlots!.hasPower(id));
        if (classPowerIds.length === 0) return null;
        const altDef = POWER_DEFS[classPowerIds[Math.floor(Math.random() * classPowerIds.length)]];
        return {
            kind: 'wildcard',
            title: altDef.name,
            element: altDef.element,
            subtitle: this.newPowerSubtitle(altDef),
            onPick: () => {
                if (this.powerSlots!.emptySlotIndex() < 0) this.openReplacePrompt(altDef.id);
                else this.powerSlots!.addPower(altDef.id);
            },
        };
    }

    /** Card C: a random run perk. */
    private buildPerkCard(): PowerCard {
        // ~30% of the time the perk slot becomes a Heal card: selecting it
        // restores 10% of max HP (capped at full). Flat roll regardless of
        // current HP — simplest, and shows up across every orb-pickup path
        // since buildPerkCard also pads the fusion/late-game rows.
        if (this.heroController && Math.random() < 0.3) {
            const hero = this.heroController;
            return {
                kind: 'perk',
                title: '+10% Heal',
                subtitle: 'Restore 10% HP',
                onPick: () => hero.heal(hero.getMaxHealth() * 0.1),
            };
        }

        const perks = [
            { title: '+5% Damage', apply: () => { this.runPerks.damageMultiplier *= 1.05; } },
            {
                title: '+5% Move Speed',
                apply: () => {
                    this.runPerks.moveSpeedMultiplier *= 1.05;
                    if (this.heroController && this.playerStats) {
                        this.heroController.updateMoveSpeed(
                            this.playerStats.moveSpeedMultiplier * this.runPerks.moveSpeedMultiplier,
                        );
                    }
                },
            },
            {
                title: '+10% Attack Range',
                apply: () => {
                    this.runPerks.attackRangeMultiplier *= 1.1;
                    if (this.heroController && this.playerStats) {
                        this.heroController.updateBasicAttackRange(
                            this.playerStats.attackRangeMultiplier * this.runPerks.attackRangeMultiplier,
                        );
                    }
                },
            },
        ];
        const perk = perks[Math.floor(Math.random() * perks.length)];
        return { kind: 'perk', title: perk.title, subtitle: 'This run', onPick: perk.apply };
    }

    /** "Lv X→Y · Dmg A→B · CD a→b" (or per-level description for passives/fusions). */
    private upgradeSubtitle(def: PowerDefinition, fromLevel: number): string {
        const next = fromLevel + 1;
        if ((def.mode === 'passive' || def.tier === 'fusion') && def.description) {
            return `Lv ${fromLevel} → ${next}  ·  ${def.description(next)}`;
        }
        const curState = { level: fromLevel, cooldownRemaining: 0 };
        const nextState = { level: next, cooldownRemaining: 0 };
        const curDmg = Math.round(def.damageFor(curState));
        const nextDmg = Math.round(def.damageFor(nextState));
        const curCd = def.cooldownFor(curState).toFixed(1);
        const nextCd = def.cooldownFor(nextState).toFixed(1);
        return `Lv ${fromLevel} → ${next}  ·  Dmg ${curDmg}→${nextDmg}  ·  CD ${curCd}s→${nextCd}s`;
    }

    /** Subtitle for a freshly-added power. */
    private newPowerSubtitle(def: PowerDefinition): string {
        if (def.mode === 'passive' && def.description) {
            return `New  ·  ${def.description(1)}`;
        }
        const state = { level: 1, cooldownRemaining: 0 };
        const dmg = Math.round(def.damageFor(state));
        const cd = def.cooldownFor(state).toFixed(1);
        return `New  ·  Dmg ${dmg}  ·  CD ${cd}s`;
    }

    /** Apply the per-pickup global power bump to every card, then show. */
    private showChoiceCards(cards: PowerCard[]): void {
        if (!this.powerChoice || !this.playerStats) return;
        const GLOBAL_POWER_BUMP = 1.06;
        for (const card of cards) {
            const pick = card.onPick;
            card.onPick = () => {
                pick();
                this.runPerks.damageMultiplier *= GLOBAL_POWER_BUMP;
            };
        }
        this.powerChoice.show(
            cards,
            () => this.playerStats!.addGold(25),
            () => {},
        );
    }

    /** Brief expanding burst at the hero + camera shake when forging. */
    private playForgeVfx(isUltimate: boolean): void {
        this.heroController?.triggerScreenShake(isUltimate ? 0.5 : 0.25);
        if (!this.scene || !this.hero) return;
        const scene = this.scene;
        const pos = this.hero.getPosition().clone();
        pos.y = 1.2;
        const color = isUltimate ? new Color3(1, 0.9, 0.4) : new Color3(0.75, 0.45, 1);
        const burst = MeshBuilder.CreateSphere('forgeBurst', { diameter: 0.6, segments: 8 }, scene);
        burst.position.copyFrom(pos);
        // Cache by bounded key (ult vs fuse — two colours). Math.random() name
        // defeated the cache and forced a shader recompile per forge. Fade via
        // mesh.visibility, not the frozen mat's .alpha.
        const matKey = isUltimate ? 'forgeBurstMat_ult' : 'forgeBurstMat_fuse';
        burst.material = getCachedMaterial(scene, matKey, m => {
            m.emissiveColor = color;
            m.diffuseColor = new Color3(0, 0, 0);
            m.disableLighting = true;
            m.alpha = 0.9;
        });
        burst.visibility = 0.9;
        const lifeS = isUltimate ? 0.7 : 0.5;
        let elapsed = 0;
        const obs = scene.onBeforeRenderObservable.add(() => {
            const dt = scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            const t = Math.min(elapsed / lifeS, 1);
            burst.scaling.setAll(0.6 + t * (isUltimate ? 10 : 6));
            burst.visibility = 0.9 * (1 - t);
            if (t >= 1) {
                burst.dispose(); // keeps the cached/shared material
                scene.onBeforeRenderObservable.remove(obs);
            }
        });
    }

    private openReplacePrompt(newPowerId: string): void {
        if (!this.replaceSlotOverlay || !this.powerSlots || !this.playerStats) return;
        const def = POWER_DEFS[newPowerId];
        if (!def) return;
        this.replaceSlotOverlay.show(
            this.powerSlots.getSlots(),
            def.name,
            (slotIndex) => this.powerSlots!.replaceSlot(slotIndex, newPowerId),
            () => this.playerStats!.addGold(25),
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // XP / leveling
    // ─────────────────────────────────────────────────────────────────────────

    /** Feed XP and, on any level-up, push the new attribute bonuses + show feedback. */
    private awardXp(amount: number): void {
        if (!this.levelSystem) return;
        const ups = this.levelSystem.addXp(amount);
        if (ups > 0) {
            this.applyLevelBonuses();
            this.showLevelUpFeedback(this.levelSystem.getLevel());
        }
    }

    /**
     * Write the level bonus onto the same PlayerStats multiplier fields the shop
     * used to mutate. Idempotent (SETS, never accumulates) so it is correct after a
     * multi-level grant. Perks live on the separate runPerks layer and still stack
     * multiplicatively on top.
     */
    private applyLevelBonuses(): void {
        if (!this.playerStats || !this.levelSystem) return;
        const b = this.levelSystem.getBonusFraction(); // crit-chance rate: +0.5%/level
        const g = b * 2;                                // most attributes: doubled (+1%/level)
        // Power scaling with diminishing returns: each level's marginal gain shrinks
        // and saturates so it isn't overpowered at high levels. gp = 1 - e^(-4b);
        // halved here (0.5×) per balance pass. Attack speed is likewise halved.
        const gp = (1 - Math.exp(-4 * b)) * 0.5;
        const gAtk = g * 0.5;                          // attack speed scaling halved (+0.5%/level)
        const ps = this.playerStats;
        ps.moveSpeedMultiplier        = 1 + g;
        ps.attackRangeMultiplier      = 1 + g;
        ps.basicAttackSpeedMultiplier = 1 + gAtk; // halved per balance pass
        ps.powerDamageMultiplier      = 1 + gp;   // power damage (halved, diminishing)
        ps.powerCooldownMultiplier    = Math.max(0.05, 1 - gp); // power fire rate (halved, diminishing); floored so it never hits 0
        ps.damageReductionMultiplier  = Math.max(0.30, 1 - g); // lower = tankier; floored at 0.30 → 70% reduction cap
        ps.critChance                 = b;     // NOT doubled — kept at +0.5%/level
        ps.critDamageMultiplier       = 1.5 * (1 + g);

        // Max HP: scale off base, apply only the delta to the hero (and heal it).
        const targetBonus = Math.round(this.baseMaxHealth * g);
        const delta = targetBonus - this.appliedMaxHpBonus;
        if (delta !== 0 && this.heroController) {
            this.heroController.addMaxHealth(delta);
            if (delta > 0) this.heroController.heal(delta);
            this.appliedMaxHpBonus = targetBonus;
        }

        // Re-push the multipliers that are PUSHED (not pulled live), combined with runPerks.
        this.heroController?.updateMoveSpeed(ps.moveSpeedMultiplier * this.runPerks.moveSpeedMultiplier);
        this.heroController?.updateBasicAttackRange(ps.attackRangeMultiplier * this.runPerks.attackRangeMultiplier);
        this.heroController?.updateBasicAttackSpeed(ps.basicAttackSpeedMultiplier);
    }

    /** Lightweight, allocation-free level-up feedback (flash the level pill + log
     *  + float an in-world 'LEVEL UP!' at the hero, mirroring item-pickup text). */
    private showLevelUpFeedback(level: number): void {
        console.log(`[xp] LEVEL UP → Lv ${level}`);
        this.hud?.flashXpBar();
        if (this.damageNumbers && this.hero) {
            this.damageNumbers.showText(this.hero.getPosition(), 'LEVEL UP!', '#ffd84a', 64);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    private getNearestEnemy(): BasicAttackTarget | null {
        if (!this.enemyManager || !this.hero) return null;
        const heroPos = this.hero.getPosition();
        let best: Enemy | null = null;
        let bestDistSq = Infinity;
        for (const e of this.enemyManager.getEnemies()) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            const dSq = dx * dx + dz * dz;
            if (dSq < bestDistSq) {
                bestDistSq = dSq;
                best = e;
            }
        }
        if (!best) return null;
        const captured = best;
        return {
            position:   captured.getPosition(),
            takeDamage: (n, element) => captured.takeDamage(n, element),
            isAlive:    () => captured.isAlive(),
            enemy:      captured,
        };
    }

    /**
     * Diagnostic only. Two complementary detectors:
     *   - longtask: catches main-thread blocks (Chrome/Edge only).
     *   - rAF-delta: catches GPU stalls + main-thread blocks in any browser, by
     *     measuring the wall-clock gap between consecutive rAF callbacks.
     * Either fires console.error with wave/enemy-count context so the most
     * recent game event before the freeze identifies the culprit.
     */
    private startLongTaskObserver(): void {
        // 1. longtask observer — only fires in Chromium browsers.
        if (typeof PerformanceObserver !== 'undefined') {
            try {
                this.longTaskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.duration < 100) continue;
                        this.logFreeze('longtask', Math.round(entry.duration));
                    }
                });
                this.longTaskObserver.observe({ entryTypes: ['longtask'] });
                console.info('[freeze-detector] longtask observer active');
            } catch (err) {
                console.warn('[freeze-detector] longtask not supported in this browser:', err);
                this.longTaskObserver = null;
            }
        }

        // 2. rAF-delta watcher — works everywhere. Logs when more than ~3
        //    expected frames pass between rAF ticks (200ms gap @ 60fps ≈ 12 dropped frames).
        const FREEZE_THRESHOLD_MS = 200;
        this.lastRafTimestamp = performance.now();
        // Track when the tab goes hidden so we don't misreport a backgrounded-tab
        // rAF pause as a "freeze" (the browser pauses rAF when the tab is hidden).
        this._visibilityHandler = () => { if (typeof document !== 'undefined' && document.hidden) this._rafWasHiddenSinceTick = true; };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._visibilityHandler);
        const tick = (now: number): void => {
            const delta = now - this.lastRafTimestamp;
            if (delta > FREEZE_THRESHOLD_MS) {
                if (this._rafWasHiddenSinceTick || (typeof document !== 'undefined' && document.hidden)) {
                    // rAF was paused because the tab was hidden/backgrounded — NOT a real
                    // main-thread stall. Don't log it as a freeze.
                } else {
                    this.logFreeze('rAF-gap', Math.round(delta));
                }
            }
            this._rafWasHiddenSinceTick = false;
            this.lastRafTimestamp = now;
            // Stop scheduling if the detector was cancelled.
            if (this.rafFreezeDetectorId === null) return;
            this.rafFreezeDetectorId = requestAnimationFrame(tick);
        };
        this.rafFreezeDetectorId = requestAnimationFrame(tick);
        console.info('[freeze-detector] rAF-delta watcher active');
    }

    private cycleTestFusion(): void {
        if (this.testFusions.length === 0) return;
        this.testFusionIndex = (this.testFusionIndex + 1) % this.testFusions.length;
        this.applyTestFusion();
    }

    /** DEV ?test STRESS button (\\ key): equip 4 DIFFERENT fusion archetypes (all
     *  effect types firing) and spawn a 30-enemy horde (some elite → orbs drop).
     *  Repeat to ramp load. Watch [freeze:frame] (real per-frame compute) + the
     *  per-spawn cost logs to find the bottleneck. */
    private stressLoad(): void {
        if (!this.powerSlots) return;
        if (this.testFusions.length > 0) {
            this.powerSlots.debugEquipManyMaxed(this.testFusions.slice(0, 4));
        }
        const types = ['basic', 'fast', 'tank', 'healer', 'splitting', 'shield'];
        const elems = ['fire', 'ice', 'arcane', 'physical', 'storm'];
        let n = 0;
        for (let i = 0; i < 30; i++) {
            const t = types[i % types.length];
            const elite = (i % 4 === 0) ? elems[Math.floor(i / 4) % elems.length] : undefined;
            if (this.enemyManager?.spawnSurvivorsEnemy(t, elite)) n++;
        }
        const total = this.enemyManager?.getEnemies().length ?? 0;
        console.info(`[stress] +${n} enemies (total ${total}); 4 diverse fusions equipped. Watch [freeze:frame].`);
        this.showTestLabel(`[STRESS] +${n} enemies (total ${total}) · 4 diverse fusions · press \\ for more`);
    }

    private applyTestFusion(): void {
        if (!this.powerSlots || this.testFusions.length === 0) return;
        const def = this.testFusions[this.testFusionIndex];
        this.powerSlots.debugEquipAllMaxed(def);
        this.showTestLabel(`[TEST ${this.testFusionIndex + 1}/${this.testFusions.length}] ${def.name} — press ] for next`);
    }

    private showTestLabel(text: string): void {
        if (typeof document === 'undefined') return;
        if (!this.testLabelEl) {
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(0,0,0,0.72);color:#ffd24d;font:bold 14px monospace;padding:6px 12px;border-radius:6px;pointer-events:none;';
            document.body.appendChild(el);
            this.testLabelEl = el;
        }
        this.testLabelEl.textContent = text;
    }

    private logFreeze(kind: string, durationMs: number): void {
        const tRun = ((performance.now() - this.runStartTime) / 1000).toFixed(1);
        const wave = this.waveManager?.getCurrentWave() ?? 0;
        const enemies = this.enemyManager?.getEnemies().length ?? 0;
        const overlays: string[] = [];
        if (this.powerChoice?.isOpen()) overlays.push('powerChoice');
        if (this.replaceSlotOverlay?.isOpen()) overlays.push('replaceSlot');
        const overlayStr = overlays.length ? ` · overlay=[${overlays.join(',')}]` : '';

        // Snapshot Babylon scene state — these are the lists the scene walks
        // every frame. If they grow across waves, we have a leak (the most
        // likely cause given the rAF gap is outside our update tick).
        const scene = this.scene;
        // shadowRL = directional/torch shadow-map renderList sizes. These must track
        // the LIVE enemy count (+ a few lingering corpses), NOT climb monotonically —
        // a steady climb means dead-enemy meshes are leaking into the shadow passes.
        // lights must stay flat (3) across menu→play→gameOver→play; a climb means a
        // per-run light leak. Both are the confirmed freeze sources.
        const shadowRL = (g: ShadowGenerator | null): number | string =>
            g?.getShadowMap()?.renderList?.length ?? '?';
        const sceneInfo = scene
            ? ` · ps=${scene.particleSystems.length}` +
              ` anim=${(scene as unknown as { _activeAnimatables?: unknown[] })._activeAnimatables?.length ?? '?'}` +
              ` meshes=${scene.meshes.length}` +
              ` materials=${scene.materials.length}` +
              ` textures=${scene.textures.length}` +
              ` lights=${scene.lights.length}` +
              ` shadowRL=${shadowRL(this.shadowGenerator)}/${shadowRL(this.torchShadowGenerator)}`
            : '';
        // hidden/focus classify an rAF-gap: hidden=true → tab backgrounded;
        // hidden=false focus=false → window unfocused (rAF throttled, NOT a hang);
        // hidden=false focus=true → genuinely foreground (cross-check [freeze:frame]).
        const vis = (typeof document !== 'undefined')
            ? ` · hidden=${document.hidden} focus=${typeof document.hasFocus === 'function' ? document.hasFocus() : '?'}`
            : '';
        console.error(`[freeze:${kind}] ${durationMs}ms at t=${tRun}s · wave ${wave} · ${enemies} enemies${overlayStr}${vis}${sceneInfo}`);
    }

    /** Snapshot the post-setup scene resource counts as the leak-watchdog floor. */
    private captureResourceBaseline(): void {
        const s = this.scene;
        if (!s) return;
        this.resourceBaselineMaterials = s.materials.length;
        this.resourceBaselineTextures = s.textures.length;
        this.resourceWaveSamples = [];
        console.info(
            `[resource-watchdog] baseline materials=${this.resourceBaselineMaterials} ` +
            `textures=${this.resourceBaselineTextures} (ceiling ` +
            `${this.resourceBaselineMaterials + SurvivorsGameplayState.RESOURCE_CACHE_BUDGET})`,
        );
    }

    /**
     * Standing leak guard, run at every wave clear (arena empty → live enemies ≈ 0).
     * Materials/textures above the baseline+cache budget, or a sustained per-wave
     * climb, means a transient FX is orphaning resources into a scene list. On a
     * breach it buckets that list by name-prefix and logs the largest buckets, so the
     * offending allocation site NAMES ITSELF (e.g. "swingRingMatElem×42") — the next
     * regression is attributed instantly instead of being a silent multi-second freeze.
     */
    /**
     * After ENEMY_SHADOW_CUTOFF_WAVE clears, stop enemies from casting shadows.
     * Later waves spawn ever-larger hordes, and each shadow caster adds shadow-map
     * render cost the small low-poly silhouettes don't justify. Clearing the
     * EnemyManager's generator list makes every future spawn skip shadow-caster
     * registration; the hero keeps its directional shadow. Called from the
     * wave-cleared callback, where the arena is empty so no live caster needs
     * removing — all dead enemies have already been pruned from the renderLists.
     */
    private maybeDisableEnemyShadows(clearedWave: number): void {
        if (this.enemyShadowsDisabled) return;
        if (clearedWave < SurvivorsGameplayState.ENEMY_SHADOW_CUTOFF_WAVE) return;
        this.enemyShadowsDisabled = true;
        this.enemyManager?.setShadowGenerators([]);
        console.log(`[shadows] enemy shadow-casting disabled after wave ${clearedWave} (horde-scale perf trade-off)`);
    }

    private checkResourceBudget(wave: number): void {
        const s = this.scene;
        if (!s) return;
        const materials = s.materials.length;
        const textures = s.textures.length;
        const prev = this.resourceWaveSamples[this.resourceWaveSamples.length - 1];
        this.resourceWaveSamples.push({ wave, materials, textures });

        const ceiling = this.resourceBaselineMaterials + SurvivorsGameplayState.RESOURCE_CACHE_BUDGET;
        const grewVsPrev = prev ? materials - prev.materials : 0;
        const overCeiling = materials > ceiling;
        const slowClimb = wave >= 3 && grewVsPrev > SurvivorsGameplayState.RESOURCE_PER_WAVE_TOLERANCE;
        if (!overCeiling && !slowClimb) return;

        const matBuckets = formatBuckets(s.materials.map(m => m.name));
        const texBuckets = formatBuckets(s.textures.map(t => t.name));
        console.error(
            `[resource-watchdog] LEAK SUSPECTED at wave ${wave} cleared: ` +
            `materials=${materials} (baseline ${this.resourceBaselineMaterials}, ceiling ${ceiling}, ` +
            `Δprev ${grewVsPrev >= 0 ? '+' : ''}${grewVsPrev}) · textures=${textures} · ` +
            `cacheKeys=${getMaterialCacheSize()}\n` +
            `  top material prefixes: ${matBuckets}\n` +
            `  top texture prefixes:  ${texBuckets}\n` +
            `  (arena is empty at wave clear, so growth above the cache budget = orphaned ` +
            `resources; the largest bucket names the leaking allocation site.)`,
        );
    }

    private stopLongTaskObserver(): void {
        this.longTaskObserver?.disconnect();
        this.longTaskObserver = null;
        if (this.rafFreezeDetectorId !== null) {
            cancelAnimationFrame(this.rafFreezeDetectorId);
            this.rafFreezeDetectorId = null;
        }
        if (this._visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
    }

    /**
     * Return the starting (max) HP for a given champion type, matching the same
     * calculation `startRun` uses for the local hero. Used by the host to
     * initialise guestHeroMaxHp / guestHeroHp when the ghost's class is known.
     */
    private champHpFor(type: string): number {
        const variants: Record<string, number> = {
            barbarian: 140,
            ranger:    90,
            mage:      80,
        };
        const base = variants[type] ?? variants['barbarian'];
        return Math.round(base * DifficultyTuning.playerHpMult);
    }

    private applyContactDamage(deltaTime: number): void {
        if (!this.hero || !this.enemyManager || !this.heroController) return;
        const heroPos = this.hero.getPosition();
        const reductionMult = this.playerStats?.damageReductionMultiplier ?? 1.0;

        // Host co-op: also track ghost position for guest-hero contact checks below.
        // Single-player: coopRole is null — the guest block is never entered.
        const coopRole = this.coopSession?.role ?? null;
        const ghostPos = (coopRole === 'host' && this.coopGhost && this.guestHeroAlive)
            ? this.coopGhost.getPosition()
            : null;

        // Lazily initialise guestHeroMaxHp the first time the ghost exists and
        // guestHeroMaxHp hasn't been set yet. The ghost's champion type is
        // available from the remote champ string stored in CoopSession.
        if (coopRole === 'host' && this.coopGhost && this.guestHeroMaxHp === 0) {
            const remoteChamp = this.coopSession?.getRemoteChamp() ?? 'barbarian';
            this.guestHeroMaxHp = this.champHpFor(remoteChamp);
            this.guestHeroHp    = this.guestHeroMaxHp;
            this.guestHeroAlive = true;
        }

        const sumR = this.heroRadius + 0.6;
        const sumRSq = sumR * sumR;

        for (const e of this.enemyManager.getEnemies()) {
            // Hero death inside takeDamage triggers state.exit() synchronously,
            // which nulls heroController. Re-check each iteration.
            if (!this.heroController) return;
            if (!e.isAlive()) continue;
            const ePos = e.getPosition();

            // ── Local hero contact (unchanged behaviour for SP + host) ──────────
            const ldx = ePos.x - heroPos.x;
            const ldz = ePos.z - heroPos.z;
            if (ldx * ldx + ldz * ldz < sumRSq) {
                this.heroController.takeDamage(e.contactDamagePerSecond * deltaTime * reductionMult, ePos);
            }

            // ── Guest hero contact (host only) ───────────────────────────────────
            // Apply contact damage against the ghost position; track HP here;
            // the authoritative value ships to the guest in every snapshot.
            if (ghostPos && this.guestHeroAlive) {
                const gdx = ePos.x - ghostPos.x;
                const gdz = ePos.z - ghostPos.z;
                if (gdx * gdx + gdz * gdz < sumRSq) {
                    const dmg = e.contactDamagePerSecond * deltaTime * reductionMult;
                    this.guestHeroHp = Math.max(0, this.guestHeroHp - dmg);
                    if (this.guestHeroHp <= 0) {
                        this.guestHeroAlive = false;
                    }
                }
            }
        }
    }
}
