import { Scene, Vector3, Color3, Color4, DirectionalLight, AssetContainer, LoadAssetContainerAsync, CubeTexture, MeshBuilder, Mesh, ShadowGenerator, KeyboardEventTypes, Observer } from '@babylonjs/core';
// WebGPU cube-texture upload support is a SIDE-EFFECT module in Babylon's ES
// build. It used to ride in transitively via the BackgroundMaterial import
// (removed with the old env-cube skybox); without it, CreateFromImages on a
// WebGPU engine falls back to the WebGL path and crashes in the image loader
// (reading gl.TEXTURE_CUBE_MAP_POSITIVE_X of undefined).
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.cubeTexture';
import '@babylonjs/loaders/glTF';
import { AdvancedDynamicTexture } from '@babylonjs/gui';
import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { GlobeGround } from './globe/GlobeGround';
import { PropField } from './globe/PropField';
import { GlobeSky } from './globe/GlobeSky';
import { setCurveOrigin, clearCurveOrigin, curveDropAt } from './globe/curvature';
import { GLOBE_RADIUS, GRASS_TILE_SIZE, GRASS_FAR_TILE_SIZE, GRASS_FAR_FADE_START, GRASS_FAR_FADE_END, FOG_START, FOG_END, FOG_COLOR_RGB } from './globe/constants';
import { StatusEffect } from './GameTypes';
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
import { aoeBurst, gatherVortex, persistentZone, omniVolley, spawnBolt, arrowStrike, setCameraShakeHook, resetPowerEffects } from './powers/PowerEffects';
import { getAutocastArchetype, archetypeKey } from './powers/FusionArchetypeRegistry';
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
import { RunItems, ItemId, ATTACK_SPEED_FACTOR } from './RunItems';
import { ItemDrop } from './ItemDrop';
import { Equipment, priceFor, sellValueOf } from './items/Equipment';
import { foldEquipmentStats, newEquipFoldTracker, EquipFoldTracker } from './items/foldEquipmentStats';
import { ITEM_CATALOG, ITEM_SETS, setById } from './items/ItemCatalog';
import { ItemDef, EQUIP_SLOTS } from './items/ItemTypes';
import { ItemEffectRuntime, EffectContext, EffectEnemy } from './items/ItemEffectRuntime';
import { RageGlow, spawnExpandingRing, spawnTrail } from './items/ItemFx';
import { describeMods, EFFECT_TEXT } from './items/describeMods';
import { rollStock, rerollCost } from './shop/ShopStock';
import { getGoblinPortrait, GoblinPortrait } from './shop/GoblinPortrait';
import { ShopOverlay, ShopVM, ShopCardVM } from '../ui/overlays/ShopOverlay';
import { CharacterProfile, CharacterVM, GearSlotVM, CharStatVM, CharSetVM } from '../ui/overlays/CharacterProfile';
import { pickBark } from './shop/GribbleBarks';
import { DifficultyTuning } from './DifficultyTuning';
import { createProceduralGrass } from '../engine/rendering/ProceduralGrass';
import { GameSettings, bladeCountForQuality } from '../shared/GameSettings';
import { clearMaterialCache, getCachedMaterial, getMaterialCacheSize } from '../engine/rendering/MaterialCache';
import { clearProjectilePools } from '../engine/rendering/ProjectilePool';
import { formatBuckets } from '../engine/rendering/resourceBudget';
import { CoopSession } from './coop/CoopSession';
import { GuestEnemies } from './coop/GuestEnemies';
import { computeCameraFocus } from './coop/cameraFocus';
import { setCoopFxEmit, spawnCosmeticProjectile, spawnCosmeticSwingRing, spawnCosmeticEnemyProjectile, spawnCosmeticTelegraph, startCosmeticUltChannel, emitCoopFx, isCoopFxActive, withFxReplay } from './coop/CoopFx';
import {
    scheduleMeteorBarrage, createMeteorVisual, createFrostNovaVisual,
    spawnSmashShockwave, spawnExplosiveArrowFlight, spawnExplosionVisual,
} from './abilities/AbilityVisuals';
import { reconcilePosition, replayInputs } from './coop/reconcile';
import { capInputLen, arenaClampScale } from './integrateMove';
import { NetClient } from '../net/NetClient';
import type { NetTransport } from '../net/NetTransport';
import { RoomService, PrivateRoomService } from '../net/RoomService';
import { takePendingCoop, clearPendingCoop } from './coop/PendingCoop';
import { ConnectionMachine } from '../net/ConnectionMachine';
import { diffSnapshot } from '../net/SnapshotDelta';
import { packEnemyFlags } from '../net/EnemyFlags';
import type { NetRole, SpawnMsg, DeathMsg, SnapshotMsg, CoopHeroSummary, RunOverMsg, FxMsg } from '../net/Protocol';
import { validateDamageReport } from './coop/DamageRouter';
import { MilestoneBoss } from './enemies/MilestoneBoss';

/**
 * Map class-specific ultimate IDs → GLB clip + duration so the hero plays the
 * right animation when the player presses an ultimate button. The clip plays as
 * a forced "special" channel — basic attacks suspend for the whole duration.
 * When `duration` exceeds the clip's natural length the clip loops (Whirlwind
 * ticks for 5s so the slash should keep going). Whirlwind speed bumped
 * 1.5 → 2.2 to read more like a tornado.
 *
 * Module-level (M6 C2) so the co-op 'abilityClip' replay can allowlist incoming
 * clip suffixes against exactly the set we ourselves can send.
 */
const ABILITY_CLIPS: Partial<Record<string, { suffix: string; duration?: number; speed?: number }>> = {
    // Barbarian (Aulus)
    whirlwind: { suffix: 'aulus_warrior_of_ferocity_in_game_skill3',   duration: 5.0, speed: 2.2 },
    smash:     { suffix: 'aulus_warrior_of_ferocity_in_game_skill2_3' }, // one-shot, natural length
};
const COOP_ABILITY_CLIP_SUFFIXES = new Set(
    Object.values(ABILITY_CLIPS).map(c => c!.suffix),
);

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

/** Synchronously fetch a preloaded enemy GLB from the module cache (populated by
 *  enter()'s preload), or null if not cached / no GLB for this type. Lets the
 *  guest stage the same model the host renders instead of the procedural mesh. */
function getCachedEnemyAsset(enemyType: string): AssetContainer | null {
    const path = ENEMY_GLB_PATHS[enemyType];
    if (!path) return null;
    return _glbAssets[`${path.dir}${path.file}`] ?? null;
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

/** Base move speed per champion (mirrors startRun's `variants[].speed`). The host
 *  integrates the guest's InputMsg at the guest champion's base speed to simulate
 *  its hero authoritatively (M4-8). Per-run move-speed multipliers aren't known to
 *  the host yet — the small divergence is corrected by guest-side reconciliation. */
const CHAMP_BASE_SPEED: Record<string, number> = { barbarian: 6, ranger: 9, mage: 7 };

/** Guest reconciliation tuning (M4-8). The guest predicts its own hero locally and
 *  only corrects toward the host-authoritative position when the gap is real —
 *  within DEAD_ZONE it trusts prediction entirely (host + guest integrate the same
 *  input, so they drift only by ~speed×latency + the snapshot interval). Beyond it,
 *  lerp gently; HARD_SNAP teleports (respawn / big desync). Reconcile runs ONCE per
 *  new snapshot — correcting every render frame toward a stale target compounds the
 *  pull-back and fights prediction (the "jitter"). */
const RECONCILE_DEAD_ZONE = 1.0;
const RECONCILE_HARD_SNAP = 5.0;
const RECONCILE_LERP = 0.25;

/**
 * Per-player aggregate (co-op M4, spec §3). The local player is always
 * `players[localId]`; single-player and the M3 host both run with exactly
 * `players = [slot0]`. The host gains a `players[1]` (the guest hero, simulated
 * from InputMsg) when input-authority lands in a later M4 task.
 *
 * Only per-player BUILDS live here. Shared systems (enemyManager, waveManager,
 * arena, camera, drops, damageNumbers) stay flat on the state. The state's
 * playerStats/levelSystem/heroController/powerSlots/abilityManager/runItems are
 * get/set accessors over `local().*`, so every existing call-site is untouched
 * and single-player stays byte-identical.
 */
interface PlayerSlot {
    id: number;
    isLocal: boolean;
    stats: PlayerStats | null;
    level: LevelSystem | null;
    hero: HeroController | null;
    powers: PowerSlotManager | null;
    abilities: AbilityManager | null;
    items: RunItems | null;
}

/** Build an empty per-player slot. Its six systems are populated in-place during
 *  startRun (host/SP) or — once players[1] lands — when the host constructs the
 *  guest's build. Kept allocation-light: no Babylon objects created here. */
function makePlayerSlot(id: number, isLocal: boolean): PlayerSlot {
    return { id, isLocal, stats: null, level: null, hero: null, powers: null, abilities: null, items: null };
}

export class SurvivorsGameplayState implements GameState {
    private game: Game;
    private scene: Scene | null = null;
    private ui: AdvancedDynamicTexture | null = null;
    private map: GlobeGround | null = null;
    private propField: PropField | null = null;
    // Previous-frame hero position — yields the travel direction the prop
    // recycler biases toward (zero displacement → full-circle placement).
    private _lastHeroX = 0;
    private _lastHeroZ = 0;
    private hero: Champion | null = null;

    // ── Per-player slots (co-op M4) — see PlayerSlot above. The local player's six
    //    core systems are reached through the get/set accessors below, so every
    //    existing `this.heroController` / `this.playerStats` / … call-site is
    //    unchanged and single-player stays byte-identical. ──────────────────────
    private players: PlayerSlot[] = [];
    private localId = 0;
    /** The local player's slot, or undefined outside a run (between startRun/exit). */
    private local(): PlayerSlot | undefined { return this.players[this.localId]; }
    private get heroController(): HeroController | null { return this.local()?.hero ?? null; }
    private set heroController(v: HeroController | null) { const s = this.local(); if (s) s.hero = v; }
    private get playerStats(): PlayerStats | null { return this.local()?.stats ?? null; }
    private set playerStats(v: PlayerStats | null) { const s = this.local(); if (s) s.stats = v; }
    private get levelSystem(): LevelSystem | null { return this.local()?.level ?? null; }
    private set levelSystem(v: LevelSystem | null) { const s = this.local(); if (s) s.level = v; }
    private get powerSlots(): PowerSlotManager | null { return this.local()?.powers ?? null; }
    private set powerSlots(v: PowerSlotManager | null) { const s = this.local(); if (s) s.powers = v; }
    private get abilityManager(): AbilityManager | null { return this.local()?.abilities ?? null; }
    private set abilityManager(v: AbilityManager | null) { const s = this.local(); if (s) s.abilities = v; }
    private get runItems(): RunItems | null { return this.local()?.items ?? null; }
    private set runItems(v: RunItems | null) { const s = this.local(); if (s) s.items = v; }

    private coopSession: CoopSession | null = null;
    /** M5-4/5: the room code, kept so a future transparent reconnect can resume the
     *  same room via the RoomService without re-querying matchmaking. */
    private _roomCode: string | null = null;
    /** M5-6: drives the peer-disconnect grace countdown + reconnect overlay. Non-null
     *  only while a disconnect is being waited out. */
    private _connMachine: ConnectionMachine | null = null;
    private _reconnectEl: HTMLDivElement | null = null;
    /** M6 D1: why the grace window is open — 'self' = OUR socket dropped (we attempt
     *  the resume), 'peer' = the relay reported the OTHER peer left (we wait). */
    private _connLostKind: 'self' | 'peer' | null = null;
    /** M6 D1: resume-attempt pacing (~1.5s) + overlapping-attempt guard. */
    private _resumeAccumS = 0;
    private _resumeInFlight = false;
    /** M6 D1: kept from startRun/wireCoopSession so a resume can reconnect into the
     *  same room (same code), reclaim the same role, and re-wire the same champ. */
    private _roomService: RoomService | null = null;
    private _myCoopRole: NetRole | null = null;
    private _localChampionType: string | null = null;
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
    /** M4-11: the LOCAL hero is dead and spectating the surviving teammate (co-op). */
    private _spectating = false;
    /** "YOU DIED — waiting to respawn" banner shown while the local hero is downed
     *  (co-op spectate). Created lazily in the 'overlay' layer; removed on respawn/exit. */
    private _downedBanner: HTMLElement | null = null;
    /** M4-11: the run has ended (both heroes down / SP death) — guards the game-over
     *  transition so it fires exactly once even if host + guest both detect it. */
    private _runEnded = false;
    /** M4-12 (host): the guest's most recent hero summary (sent ~every 2s), used to
     *  aggregate the 2-column game-over without a death-timing race. */
    private _guestSummary: CoopHeroSummary | null = null;
    /** M4-12 (guest): accumulator for the periodic hero-summary send. */
    private _summaryAccumS = 0;
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
    /** M5-7: the last FULL snapshot the host sent, used as the delta base. A keyframe
     *  (full snapshot) goes out every SNAPSHOT_KEYFRAME_TICKS so a joiner / dropped
     *  delta resyncs within ~1s; the ticks between are delta-compressed. */
    private _lastSentSnapshot: SnapshotMsg | null = null;
    private static readonly SNAPSHOT_KEYFRAME_TICKS = 20;
    /** Throttle for the co-op diagnostic log (guest only). */
    private _coopDiagAccumS = 0;
    /** On-screen co-op debug overlay + counters (opt-in via the `?coopdebug` URL param). */
    private readonly _coopDbgEnabled =
        typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('coopdebug');
    private _coopDbgEl: HTMLDivElement | null = null;
    private _coopDbgAccumS = 0;
    private _coopDbgSpawns = 0;   // host: emitted; guest: received
    private _coopDbgDeaths = 0;
    private _coopDbgSnaps = 0;    // guest: snapshots applied
    /** Monotonically-increasing snapshot tick counter (debug + ack). */
    private _snapshotTick = 0;
    /** Guest: last snapshot tick pushed into the enemy interpolation buffers, so a
     *  given snapshot is buffered once (not re-pushed every frame). */
    private _lastGuestSnapTick = -1;
    /** Guest: last snapshot tick its local hero was reconciled against (M4-8) — so the
     *  position correction runs once per snapshot, not every render frame. */
    private _lastReconcileTick = -1;
    /** Scratch velocity for animating the ghost from interpolated pose deltas. */
    private _coopGhostVel = new Vector3();
    /** Scratch for the ghost's capped input (shared-math helper writes into it). */
    private _scratchGhostInput = { dx: 0, dz: 0 };
    /** Last remote anim code applied to the ghost — used to fire triggerAttack once
     *  on the rising edge to 2 (the heroState carries anim every frame). */
    private _coopGhostLastAnim = 0;
    /** M6 C2: active cosmetic ultimate channels replayed for the teammate, keyed by
     *  ability id (single peer → one concurrent channel per ability). Each entry's
     *  dispose() is idempotent and fires on 'ultStop', on a duration+2s safety
     *  timeout (in case the stop is lost), and on exit()/host-solo detach. */
    private coopUltChannels: Map<string, { dispose: () => void }> = new Map();
    /** Once-only guard for the fx-dispatch failure warn (avoids log spam if a
     *  whole backlog of malformed fx drains at once). Reset in exit(). */
    private _fxDispatchWarned = false;
    private joystick: SurvivorsJoystick | null = null;
    private grass: ReturnType<typeof createProceduralGrass> | null = null;
    /** Far-field grass layer — coarser blades covering out to the terrain cap
     *  rim (the isometric camera's telephoto lens magnifies that band). */
    private grassFar: ReturnType<typeof createProceduralGrass> | null = null;
    private shadowSourceLight: DirectionalLight | null = null;
    private shadowGenerator: ShadowGenerator | null = null;
    /** Slow FPS EMA (~8s time constant) sampled across each wave — read at wave
     *  clear by maybeTrimPerformance to decide late-wave quality stepdowns. */
    private _fpsEma = 60;
    /** One-way per-run quality ratchet: 0 full, 1 reduced post-fx, 2 + slower
     *  shadow refresh. Reset (with the post-fx baseline) in exit(). */
    private _perfTrimLevel = 0;
    private torchShadowGenerator: ShadowGenerator | null = null;
    // After this wave clears, enemies stop casting shadows: the hordes grow large
    // enough that the per-caster shadow-map cost outweighs the visual detail. The
    // hero keeps its directional shadow. Idempotent guard so we only flip once.
    private static readonly ENEMY_SHADOW_CUTOFF_WAVE = 5;
    private enemyShadowsDisabled = false;
    // Per-run env/sky GPU resources — tracked so exit() can dispose them.
    // cleanupScene() only frees meshes/particles/ADT textures, so these cube
    // textures + skybox material otherwise leak one set per run.
    private globeSky: GlobeSky | null = null;

    // Gameplay systems
    private enemyManager: EnemyManager | null = null;
    private waveManager: WaveManager | null = null;
    // playerStats + levelSystem now live in the local PlayerSlot (get/set accessors above).
    // XP / leveling — replaces the gold Armory shop. Gold income folds into XP;
    // each level-up pushes +1%/level onto every attribute except crit chance
    // (which stays +0.5%/level) — see applyLevelBonuses.
    /** Hero base max HP captured at run start — XP scales max HP off this. */
    private baseMaxHealth = 0;
    /** How much max-HP bonus has already been pushed to the hero (delta-applied). */
    private appliedMaxHpBonus = 0;
    /** Seconds remaining in the post-wave breather before auto-advancing (shop removed). */
    private waveBreatherRemaining = 0;
    private static readonly WAVE_BREATHER_SECONDS = 2;
    // powerSlots + abilityManager now live in the local PlayerSlot (accessors above).

    // Power drops
    private powerDrops: PowerDrop[] = [];

    // Item drops (from milestone bosses) — runItems lives in the local PlayerSlot (accessors above).
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

    // ── Itemization & merchant shop (single-player only; all null in co-op) ──
    private equipment: Equipment | null = null;
    private equipTracker: EquipFoldTracker = newEquipFoldTracker();
    private itemEffects: ItemEffectRuntime | null = null;
    private rageGlow: RageGlow | null = null;
    private shopOverlay: ShopOverlay | null = null;
    /** Gribble's live portrait — isolated mini-renderer, mounted in the shop UI. */
    private goblinPortrait: GoblinPortrait | null = null;
    /** Always-accessible character sheet, opened from the HUD inventory strip. */
    private characterProfile: CharacterProfile | null = null;
    private shopPhase: 'none' | 'open' = 'none';
    private currentStock: ItemDef[] = [];
    /** Item ids bought this shop visit — kept as locked "Sold" tiles (fixed
     *  positions, no reflow). Cleared on each fresh stock roll. */
    private purchasedIds = new Set<string>();
    private rerollsThisVisit = 0;
    /** Equipment max-HP already pushed to the hero (delta-applied, mirrors appliedMaxHpBonus). */
    private equipMaxHpApplied = 0;

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
        this.map = new GlobeGround(this.scene);

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

        // Co-op M4: establish the local player's slot BEFORE any per-player system is
        // constructed below — the playerStats/heroController/… setters write into it.
        // Single-player + host both run with exactly players=[slot0]; the host's
        // players[1] (guest hero) is added when input-authority lands.
        this.localId = 0;
        this.players = [makePlayerSlot(0, true)];

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
            Infinity, // infinite map — arenaClampScale(…, Infinity) never clamps
            variant.speed,
            heroHp,
            championType,
        );

        this.heroController.setOnDeath(() => {
            this.onLocalHeroDeath();
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
        // Menu lobby flow FIRST: the Co-op lobby hands over a live, already-
        // connected transport via PendingCoop (it connected while still in the
        // menu, so connection order — not champion-select speed — fixed the
        // host/guest roles). Absent that, fall through to the dev URL-param flow.
        const pendingCoop = takePendingCoop();
        if (pendingCoop) {
            // Keep service + code for resume reconnects (M6 D1), then wire the
            // session exactly like the URL flow does. Any frames the peer sent
            // while we sat in champion select are backlogged in the transport
            // (the lobby detached its handler; capped — oldest dropped on overflow)
            // and drain into the NetClient, which decodes them but DROPS them (its
            // hooks aren't wired yet). That loss is acceptable: snapshots/inputs
            // are continuous streams that resume immediately, and one-shot events
            // (spawns via the guest's requestState catch-up) are sent post-wiring.
            this._roomService = pendingCoop.roomService;
            this._roomCode = pendingCoop.code;
            console.log(`[coop] lobby session: room ${pendingCoop.code} as ${pendingCoop.role}`);
            this.wireCoopSession(pendingCoop.transport, championType);
        }
        // Dev flow: ?host → host a room; ?join[=CODE] → join one. For easy two-tab
        // testing the room code defaults to a FIXED dev code, so the GUEST tab can
        // simply use ?join with nothing to copy. Open the host tab FIRST (the server
        // assigns host/guest by connection order). Use ?host=random to mint a real
        // random room.
        const coopParams = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search) : null;
        if (!pendingCoop && (coopParams?.has('host') || coopParams?.has('join'))) {
            const localChamp = championType;
            void (async () => {
                try {
                    const FIXED_TEST_ROOM = 'TESTER'; // deterministic dev room ([A-Z2-9]{6})
                    // M5-4: game code talks only to the RoomService interface, so a
                    // future matchmaking service can replace this without changes here.
                    const room: RoomService = new PrivateRoomService();
                    this._roomService = room; // kept for resume reconnects (M6 D1)
                    let code: string;
                    if (coopParams.has('host')) {
                        code = coopParams.get('host') === 'random'
                            ? (await room.createRoom()).code
                            : FIXED_TEST_ROOM;
                        console.log(`[coop] hosting room ${code} — join the other tab with ?join (or ?join=${code})`);
                    } else {
                        // ?join with no value → the fixed dev room; ?join=CODE → that room.
                        code = coopParams.get('join') || FIXED_TEST_ROOM;
                    }
                    if (code.length !== 6) return;
                    this._roomCode = code;
                    const transport = await room.connect(code);
                    this.wireCoopSession(transport, localChamp);
                } catch (err) {
                    console.error('[coop] connection failed:', err);
                }
            })();
        }

        // Itemization/merchant systems are SINGLE-PLAYER ONLY (co-op stays
        // byte-identical to the pre-shop behavior). "Solo" must be decidable
        // synchronously here: the lobby flow has already set coopSession above,
        // and the dev ?host/?join flow connects asynchronously — so treat the
        // mere presence of those params as co-op too.
        const solo = !this.coopSession && !(coopParams?.has('host') || coopParams?.has('join'));

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
        // Unconditional reset (not just in the solo block below) so a fresh run
        // never inherits stale equipment-fold state from a previous one.
        this.equipTracker = newEquipFoldTracker();
        this.equipMaxHpApplied = 0;
        this.playerStats.setXpSink((amount) => {
            this.awardXp(amount);
            // Itemization: Midas-style effects see every gold income (null in co-op).
            this.itemEffects?.onGoldEarned(amount);
        });
        this.applyLevelBonuses();

        // Install the global crit provider — every Enemy.takeDamage() reads from it.
        // Cleared in exit() so the menu / non-survivors flows never crit.
        Enemy.critProvider = () => ({
            chance:     this.playerStats?.critChance          ?? 0,
            damageMult: this.playerStats?.critDamageMultiplier ?? 1.5,
        });

        this.enemyManager = new EnemyManager(this.game);
        this.enemyManager.setPlayerStats(this.playerStats);
        // M3: wire host-side spawn/death hooks. Install them UNCONDITIONALLY and
        // self-gate inside the callback on coopSession at CALL time. The co-op
        // connection resolves in a later async IIFE above, so this synchronous
        // code runs while coopSession is still null — gating the WIRING on it
        // (as before) silently skipped the hooks, so the host never emitted
        // spawn events and the guest saw no enemies. In single-player the
        // callbacks no-op (coopSession is null).
        this.enemyManager.setOnEnemySpawned((e) => {
            if (this.coopSession?.role === 'host') { this._coopDbgSpawns++; this.coopSession.sendSpawn(this.buildSpawnMsg(e)); }
        });
        this.enemyManager.setOnEnemyDied((e) => {
            if (this.coopSession?.role === 'host') { this._coopDbgDeaths++; this.coopSession.sendDeath(this.buildDeathMsg(e)); }
        });
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
                // M4-11: a dead/spectating local hero stops being a seek/orb-pull target
                // so co-op enemies converge on the surviving teammate. SP never spectates
                // (single-provider resolveSeekTarget bypasses pickNearestAlive) → unchanged.
                isAlive: () => !!this.heroController && !this.heroController.isDeadOrSpectating(),
                applyPull: (towardX: number, towardZ: number, speed: number, durationS: number) => {
                    this.heroController?.applyPull(towardX, towardZ, speed, durationS);
                },
                applySlow: (multiplier: number, durationS: number) => {
                    this.heroController?.applySlow(multiplier, durationS);
                },
            },
        ];
        // Infinite map: arenaRadius=Infinity disables EnemyManager's interior
        // clamp; the spawn ring is the SPAWN_RING_RADIUS constant now.
        this.enemyManager.configureSurvivorsMode(this._heroProviders, Infinity);

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
        // Infinite map: enemies render sunk by the globe curvature relative to
        // the hero (render-only — gameplay positions stay flat).
        Enemy.curveDropFn = curveDropAt;
        // Horizon props: recycled low-poly decoration that drifts past as the
        // hero runs — the motion cue that sells the rotating-globe illusion.
        this.propField = new PropField(this.scene);
        Enemy.onDamageCallback = (position, damage, isCrit, element) => {
            this.damageNumbers?.showDamage(position, damage, element, isCrit);
            // M4-9: mirror EVERY host-side damage number to the guest — its own routed
            // hits AND the host's own hits — so the guest sees full combat feedback.
            // Single broadcast point (fires here for guest reports applied above too),
            // so there's no double-count. enemyId is unused by the guest (shows by pos).
            if (this.coopSession?.role === 'host') {
                this.coopSession.sendDamageResult({
                    t: 'damageResult',
                    enemyId: 0,
                    amount: damage,
                    isCrit,
                    element: element ?? 'physical',
                    x: position.x,
                    z: position.z,
                });
            }
        };
        Enemy.onRewardCallback = (position, reward) => {
            // Show what is actually CREDITED: EnemyManager pays out
            // reward × goldGainMultiplier, so the float must scale identically.
            this.damageNumbers?.showReward(position,
                Math.round(reward * (this.playerStats?.goldGainMultiplier ?? 1)));
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

        // When a power-slot fires, play a cast animation. Ranger/mage reuse the
        // NORMAL attack clip for power autocasts — the special clip is reserved
        // for the manual Q/E ultimates (AbilityManager → triggerSpecial /
        // playAbilityClip). The barbarian keeps the special swing for power casts.
        this.powerSlots.setOnCast((slot) => {
            if (this.hero) {
                if (this.hero.championType === 'barbarian') this.hero.triggerSpecial();
                else this.hero.triggerAttack();
            }
            // Co-op (M6 C1): fusion + ultimate casts now replicate their EXACT visuals
            // via the PowerEffects primitives ('pe' messages emitted inside each
            // primitive), so the generic element-burst placeholder would double up —
            // suppress it for those. It REMAINS for casts that don't route through the
            // primitives: base mage/ranger powers (bespoke projectile FX in
            // PowerDefinitions.ts) and un-migrated fusion pairs (parent-cast fallback).
            // The body 'special' pose is already shared via heroState anim=3.
            if (isCoopFxActive() && !this.castRoutesThroughPrimitives(slot.def)) {
                const p = this.hero?.getPosition();
                if (p) emitCoopFx('power', p.x, p.z, undefined, undefined, slot.def.element);
            }
            // Itemization: Echo (free recast) rolls on every cast (null in co-op).
            this.itemEffects?.onPowerCast();
        });

        // Sync power casts to the cast animation: the special clip starts on the
        // onCast callback above, and the actual cast() (projectile spawn) is
        // deferred to the clip's visual release point. 0 for procedural champs.
        this.powerSlots.setCastDelayProvider(() => {
            const hero = this.hero as { getCastReleaseDelay?: () => number } | null;
            return hero?.getCastReleaseDelay?.() ?? 0;
        });

        // Wire enemy provider and power slots into HeroController for melee AOE + enchantments.
        // Role-aware + evaluated per call (see activeAttackEnemies): the co-op guest targets
        // its render-only registry, the host/SP the authoritative EnemyManager.
        this.heroController.setEnemyProvider(() => this.activeAttackEnemies());
        this.heroController.setPowerSlots(this.powerSlots);
        // Route the global damage multiplier (shop powerDamageMultiplier × run perk)
        // into the basic attack — without this, weapon damage never scaled with
        // upgrades and power picks felt purely cosmetic for melee/projectile champs.
        this.heroController.setDamageMultiplierProvider(
            () => (this.playerStats?.powerDamageMultiplier ?? 1.0)
                * (this.playerStats?.basicDamageMultiplier ?? 1.0)   // equipment basic-damage (1.0 in co-op)
                * (this.itemEffects?.damageBonusMult() ?? 1.0)       // RAGE rider (null in co-op)
                * this.runPerks.damageMultiplier,
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
            this.maybeTrimPerformance(clearedWave);
            // M4-11: revive any spectating teammate at the wave break (arena is empty,
            // so respawning at center is safe). Host-authoritative — the guest sees its
            // alive flag flip true in the next snapshot and exits spectate.
            if (this.coopSession) this.respawnDeadHeroes();
            // Calibration log: read in a ?test run to tune XP_CONFIG so level 100
            // lands near wave 30 (see the XP spec §6).
            if (this.levelSystem) {
                console.log(`[xp] wave=${clearedWave} level=${this.levelSystem.getLevel()} ` +
                    `progress=${Math.round(this.levelSystem.getProgress() * 100)}% ` +
                    `totalXp=${Math.round(this.levelSystem.getTotalXp())}`);
            }
            // ?test advances immediately for a fully unattended stress pass.
            if (this.testMode) { this.waveManager?.startNextWave(); return; }
            // Single-player: the on-screen shop replaces the auto-breather — it
            // opens immediately (pausing solo via isPausedForOverlay) and the next
            // wave waits for "To battle!". Solo-ness is re-checked HERE (not
            // captured) so a co-op session that connected after startRun still
            // gets the old breather.
            // Co-op: old auto-advance breather, byte-identical to pre-shop main.
            const soloNow = !this.coopSession;
            if (soloNow && this.shopOverlay) {
                this.shopPhase = 'open';
                this.currentStock = [];
                this.rerollsThisVisit = 0;
                this.openShop();
            } else {
                this.waveBreatherRemaining = SurvivorsGameplayState.WAVE_BREATHER_SECONDS;
            }
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
        // M4-9: abilities target the role-aware enemy list (GuestEnemies on the co-op
        // guest, where the host EnemyManager is empty) — evaluated per call so the role
        // is current even though the co-op connection resolves after startRun. Their
        // damage then routes to the host via Enemy.guestDamageRedirect.
        this.abilityManager.setEnemiesProvider(() => this.activeAttackEnemies());
        // M4-11: block manual ults + dash while the local hero is dead/spectating.
        this.abilityManager.setActiveProvider(() => !this.heroController?.isDeadOrSpectating());
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
        this.abilityManager.setDamageMultiplierProvider(
            () => (this.playerStats?.powerDamageMultiplier ?? 1.0) * this.runPerks.damageMultiplier,
        );
        this.abilityManager.prewarmAbilityEffects();
        this.prewarmPowerEffects();

        // Snapshot the post-setup scene resource counts as the watchdog baseline.
        // Everything that legitimately persists for the whole run (hero, arena,
        // grass, prewarmed cached FX materials) exists by now; later growth at
        // wave-clear time is measured against this floor.
        this.captureResourceBaseline();

        // Hero ultimate body clips: ABILITY_CLIPS (module-level) maps ability id →
        // GLB clip; played as a forced "special" channel.
        this.abilityManager.setOnActivate((abilityId) => {
            const clip = ABILITY_CLIPS[abilityId];
            if (!clip || !this.hero) return;
            const hero = this.hero as { playAbilityClip?: (s: string, d?: number, sp?: number) => void };
            if (typeof hero.playAbilityClip === 'function') {
                hero.playAbilityClip(clip.suffix, clip.duration, clip.speed ?? 1.0);
                // Co-op (M6 C2): mirror the EXACT clip on the teammate's ghost (the
                // generic anim=3 special pose is skipped while the clip is active).
                if (isCoopFxActive()) {
                    const p = this.hero.getPosition();
                    emitCoopFx('abilityClip', p.x, p.z, undefined, undefined,
                        JSON.stringify({ s: clip.suffix, d: clip.duration, sp: clip.speed ?? 1.0 }));
                }
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

        // ── Itemization + merchant shop ──────────────────────────────────────
        // Per-client: each player owns its own equipment/effects/shop. Construct
        // for solo AND co-op (every system resolves through the per-PlayerSlot
        // accessors). Combat-event hooks are wired below — solo immediately,
        // co-op in the guest-safe form (a later phase).
        this.equipment = new Equipment(this.playerStats);
        this.equipTracker = newEquipFoldTracker();
        this.equipMaxHpApplied = 0;
        this.rageGlow = new RageGlow(this.scene, () => this.hero?.getPosition() ?? null);
        this.itemEffects = new ItemEffectRuntime(this.buildEffectContext());
        this.shopOverlay = new ShopOverlay(this.gameUI!.layer('overlay'));
        this.goblinPortrait = getGoblinPortrait();
        this.characterProfile = new CharacterProfile(this.gameUI!.layer('overlay'));
        this.hud.setOnHorn(() => this.soundHorn());
        this.hud.setOnOpenCharacter(() => this.openCharacter());
        this.updateInventoryHud(); // populate + show the always-visible strip

        if (solo) {
            // Combat-event hooks (deliberately NOT wired in co-op — the guest's
            // hit/hurt paths are asymmetric and would desync the host). Deferred
            // to a later phase in the guest-safe form.
            this.heroController.setOnHurt((amount) => this.itemEffects?.onHeroHurt(amount));
            this.heroController.getBasicAttack()?.setOnHit((enemy, dmg) =>
                this.itemEffects?.onBasicHit(enemy, dmg));
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
        // withFxReplay: prewarm is local shader-warming, not a real cast — without the
        // guard each primitive would broadcast a spurious 'pe' to the co-op teammate.
        withFxReplay(() => {
            for (const el of elems) {
                aoeBurst(scene, [], p.x, p.z, { radius: 1, damage: 0, element: el, ringLifeS: 0.05 });
                gatherVortex(scene, [], p.x, p.z, { radius: 1, durationS: 0.05, pull: 0, tickDamage: 0, element: el });
                persistentZone(scene, [], p.x, p.z, { radius: 1, durationS: 0.05, tickIntervalS: 0.05, tickDamage: 0, element: el });
                omniVolley(scene, [], p.x, p.z, { count: 2, speed: 4, damage: 0, element: el, lifeS: 0.05 });
            }
        });
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

        // ── Env cube (IBL only) ──────────────────────────────────────────────
        // Skipped on the NullEngine fallback (no WebGPU/WebGL): the cube upload
        // takes the GL path with no GL context and crashes in the image-load
        // handler ("reading 'TEXTURE_CUBE_MAP_POSITIVE_X' of undefined").
        if (!this.game.isGpuUnavailable()) {
            const envTexture = CubeTexture.CreateFromImages(envFiles, scene);
            // Use the env as scene IBL so the rigged GLB heroes pick up nice reflections.
            // intensity reduced 0.6 → 0.25 — IBL was adding a huge uniform ambient
            // term on every surface, which is the dominant cause of the "full bright"
            // / flat look. 0.25 still gives heroes some sky reflection.
            scene.environmentTexture = envTexture;
            scene.environmentIntensity = 0.25;
        }

        // Gradient + stars sky dome (globe map): warm dusk band at the curved
        // horizon fading to indigo overhead, so the space above the world's rim
        // isn't a black void. The env cube above stays for IBL reflections only.
        this.globeSky = new GlobeSky(scene, this.game.isGpuUnavailable());

        // ── Horizon distance fog ──────────────────────────────────────────────
        // Blend the far ground cap + grass-fade seam into the sky's horizon band
        // so the finite (square) terrain edge isn't visible when the camera is
        // zoomed out. Game.setupScene disables fog globally (it broke the old
        // orthographic TD camera); survivors uses a perspective camera, so it's
        // safe here. fogStart/fogEnd are refreshed every frame in update()
        // (shifted outward with zoom); exit() restores the fog-off default.
        scene.fogMode = Scene.FOGMODE_LINEAR;
        scene.fogColor.copyFromFloats(FOG_COLOR_RGB[0], FOG_COLOR_RGB[1], FOG_COLOR_RGB[2]);
        scene.fogStart = FOG_START;
        scene.fogEnd = FOG_END;
        scene.fogEnabled = true;

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
        // WebGL and WebGPU. Up to 32000 hardware-instanced blades (quality-
        // tiered) with vertex lighting and a sin-based wind sway.
        this.grass = createProceduralGrass(scene, {
            tileSize: GRASS_TILE_SIZE,
            curveRadius: GLOBE_RADIUS,
            bladeCount: bladeCountForQuality(GameSettings.getGraphicsQuality()),
            bladeWidth: 0.06,
            bladeHeight: 0.45,
            // Radial height-fade so the dense near tile tapers out in a CIRCLE
            // (blades gone by its ±22 edge, square corners included) instead of
            // ending in a hard square boundary against the sparser far layer.
            // The far layer underneath provides continuous coverage past it.
            fadeStart: 14,
            fadeEnd: 22,
            directionalLight: this.shadowSourceLight ?? undefined,
            // shadowGenerator: this.shadowGenerator ?? undefined, // disabled while debugging
            ambientColor: new Color3(0.42, 0.50, 0.32),
            colorRoot: new Color3(0.18, 0.26, 0.10),
            colorTip:  new Color3(0.55, 0.78, 0.30),
            colorDry:  new Color3(0.72, 0.65, 0.32),
            influencerRadius: 0.9,
            influencerStrength: 0.55,
        });

        // Far-field layer: the same blade count as the near layer, but spread
        // over the much larger ±100 tile so blades carpet the entire visible
        // ground out past the cap edge (no bare-ground "square"). Wider blades
        // (foreshortening at grazing angles keeps it reading dense). The fade
        // now sits beyond the horizon, so it's never seen.
        // LOD: 2 curve segments (12 verts vs 20 — curve detail is invisible at
        // distance) and no influencer bend loop (characters never reach it),
        // which together cut this layer's vertex cost to a fraction.
        this.grassFar = createProceduralGrass(scene, {
            tileSize: GRASS_FAR_TILE_SIZE,
            curveRadius: GLOBE_RADIUS,
            bladeCount: bladeCountForQuality(GameSettings.getGraphicsQuality()) * 3,
            bladeWidth: 0.12,
            bladeHeight: 0.50,
            bladeSegments: 2,
            influencers: false,
            fadeStart: GRASS_FAR_FADE_START,
            fadeEnd: GRASS_FAR_FADE_END,
            directionalLight: this.shadowSourceLight ?? undefined,
            ambientColor: new Color3(0.42, 0.50, 0.32),
            colorRoot: new Color3(0.18, 0.26, 0.10),
            colorTip:  new Color3(0.55, 0.78, 0.30),
            colorDry:  new Color3(0.72, 0.65, 0.32),
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

        // 300ms slow-mo pickup punch — single-player only. In co-op timeScale is
        // shared (the host streams it in the snapshot), so one player's pickup must
        // not slow the other player's game.
        if (!this.coopSession) {
            this.timeScale = 0.6;
            setTimeout(() => { this.timeScale = 1.0; }, 300);
        }
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
            bossTier: (e instanceof MilestoneBoss) ? e.waveTier : undefined,
        };
    }

    /** Build a DeathMsg for an enemy that just died. */
    private buildDeathMsg(e: Enemy): DeathMsg {
        const pos = e.getPosition();
        const isClone = (e instanceof MilestoneBoss) ? e.isClone : false;
        // Per-player items (audit #21): a REAL milestone-boss death at an item-bearing
        // tier carries the tier so the guest spawns its OWN gem — mirrors eliteElement
        // driving per-player power orbs. Authored regardless of the HOST's ownership
        // (per-player: the guest may not own it yet); each side's spawnItemDrop does
        // its own hasItem skip. Clones never drop (same rule as the local pipeline).
        const itemTier = (e instanceof MilestoneBoss && !isClone && RunItems.itemForTier(e.waveTier) !== null)
            ? e.waveTier : undefined;
        return {
            t: 'death',
            id: e.id,
            x: pos.x,
            z: pos.z,
            isElite: e.isElite,
            isClone,
            reward: e.getReward(),
            eliteElement: (e.isElite && e.eliteDropElement) ? e.eliteDropElement : undefined,
            itemTier,
        };
    }

    /** Host (M4-8): advance the guest's ghost from its latest InputMsg — the host's
     *  authoritative simulation of the guest hero. Mirrors HeroController.update's
     *  input→velocity→arena-clamp at the guest champion's base speed (per-run move
     *  multipliers + knockback/pull aren't modelled yet — guest reconciliation and a
     *  later host-event pass close that gap). Coasts on the last input on packet loss. */
    private _driveGuestGhostFromInput(dt: number): void {
        if (!this.coopGhost || !this.coopSession) return;
        const input = this.coopSession.getLatestInput();
        // Cap + clamp via the SAME pure helpers the guest's replay uses
        // (integrateMove.ts) so host sim and guest prediction share one math.
        capInputLen(input?.dx ?? 0, input?.dz ?? 0, this._scratchGhostInput);
        const speed = CHAMP_BASE_SPEED[this.coopSession.getRemoteChamp() ?? 'barbarian'] ?? 6;
        this._coopGhostVel.set(this._scratchGhostInput.dx * speed, 0, this._scratchGhostInput.dz * speed);
        this.coopGhost.setPlayerVelocity(this._coopGhostVel);
        this.coopGhost.update(dt); // integrates velocity → position + walk/idle + faces velocity
        // Clamp inside the arena (same buffer HeroController uses for the local hero).
        const g = this.coopGhost as unknown as { position: Vector3; mesh: Mesh | null };
        const k = arenaClampScale(g.position.x, g.position.z, Infinity); // infinite map
        if (k !== 1) {
            g.position.x *= k;
            g.position.z *= k;
            if (g.mesh) { g.mesh.position.x = g.position.x; g.mesh.position.z = g.position.z; }
        }
    }

    /** Build a full world snapshot for broadcast to the guest. */
    private buildSnapshot(): SnapshotMsg {
        // Heroes: [local hero (id=0), ghost (id=1)]
        const heroes: SnapshotMsg['heroes'] = [];
        if (this.hero && this.heroController) {
            const p = this.hero.getPosition();
            const ry = this.hero.getFacingY();
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
            const gry = this.coopGhost.getFacingY();
            // Part C: carry the host-tracked guest HP in the snapshot so the guest
            // can apply it as snapshot-authoritative HP instead of computing locally.
            // M4-8: dx/dz echo the input the host integrated this frame; the guest
            // reconciles its predicted position against this authoritative (x,z).
            const gInput = this.coopSession?.getLatestInput();
            heroes.push({
                id: 1, x: gp.x, y: gp.y, z: gp.z, ry: gry, hp: this.guestHeroHp, anim: 0,
                dx: gInput?.dx ?? 0, dz: gInput?.dz ?? 0,
                alive: this.guestHeroHp > 0,
                level: 1, xp: 0, // real values wired in scene task (M4-9 progression)
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
                const shieldFrac = e.getShieldFraction();
                // Plain literal + conditional assignment (no spread): this runs
                // per enemy at 20 Hz on the host, and the short-circuit-spread
                // pattern allocates a throwaway object per enemy per snapshot.
                const entry: SnapshotMsg['enemies'][number] = {
                    id: e.id,
                    x: ep.x,
                    z: ep.z,
                    ry: eRy,
                    hp: e.getHealth(),
                    flags,
                    anim: e.getNetAnimCode(), // walk/attack from the melee FSM, or 10+N for a named _skillN clip (see SnapshotEnemy.anim)
                };
                if (shieldFrac !== undefined) entry.shield = shieldFrac;
                enemies.push(entry);
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
            ackSeq: this.coopSession?.getInputAckSeq() ?? 0, // highest guest input seq applied (M4-8)
            timeScale: this.timeScale,
            heroes,
            enemies,
            wave,
        };
    }

    // ── Co-op death / spectate / respawn (M4-11) ─────────────────────────────

    /** The LOCAL hero just died. Single-player ends the run; co-op spectates the
     *  surviving teammate, or ends the run only when BOTH are down. Wired to the
     *  host's HeroController death; the guest drives its own death off the snapshot
     *  alive flag (see the guest apply block), never hp>0. */
    private onLocalHeroDeath(): void {
        if (!this.coopSession) { this.buildAndSendRunSummary(); return; } // single-player
        if (this.isTeammateAlive()) this.enterSpectate();
        else this.buildAndSendRunSummary();
    }

    /** Is the OTHER hero still alive? Host's teammate is the guest (guestHeroAlive);
     *  the guest's teammate is the host (heroes[0].alive in the latest snapshot). */
    private isTeammateAlive(): boolean {
        // Host: a teammate exists once the guest is IDENTIFIED (first heroState sets the
        // remote champ — earlier than the async ghost-mesh load), so a host death during
        // the ghost-spawn window still spectates rather than ending the run. With no guest
        // at all, getRemoteChamp() is null → the run ends.
        if (this.coopSession?.role === 'host') {
            return this.coopSession.getRemoteChamp() !== null && this.guestHeroAlive;
        }
        const snap = this.coopSession?.getLatestSnapshot();
        return snap?.heroes.find(h => h.id === 0)?.alive ?? false;
    }

    /** Enter spectate: the local hero goes inert (no input/attack/powers) and fades;
     *  the camera follows the teammate. Idempotent (guards the spec's double-fire risk). */
    private enterSpectate(): void {
        if (this._spectating) return;
        this._spectating = true;
        if (this.heroController) this.heroController.spectating = true;
        // Play the champion's death animation (GLB `_dead` clip) and crumple in place.
        (this.hero as unknown as { triggerDeath?: () => void } | null)?.triggerDeath?.();
        const mesh = (this.hero as unknown as { mesh?: { visibility: number } } | null)?.mesh;
        // Keep the body mostly visible so the death animation reads; still slightly
        // ghosted to signal the inert spectate state.
        if (mesh) mesh.visibility = 0.6;
        this.showDownedBanner();
    }

    /** Revive the local hero at (x,z): clear spectate, restore HP, un-fade. */
    private respawnLocalHero(x: number, z: number): void {
        this._spectating = false;
        (this.hero as unknown as { clearDeath?: () => void } | null)?.clearDeath?.();
        this.heroController?.respawn(x, z);
        const mesh = (this.hero as unknown as { mesh?: { visibility: number } } | null)?.mesh;
        if (mesh) mesh.visibility = 1;
        this.hideDownedBanner();
    }

    /** Show the centered "YOU DIED — waiting to respawn next wave" overlay while the
     *  local hero is down. pointer-events:none so it never blocks the spectated view. */
    private showDownedBanner(): void {
        if (this._downedBanner || !this.gameUI) return;
        const banner = document.createElement('div');
        banner.style.cssText = [
            'position:absolute', 'top:18%', 'left:50%', 'transform:translateX(-50%)',
            'text-align:center', 'pointer-events:none', 'user-select:none',
            'font-family:Cinzel, Georgia, serif', 'z-index:50',
        ].join(';');
        const title = document.createElement('div');
        title.textContent = 'YOU DIED';
        title.style.cssText = [
            'font-size:clamp(34px, 7vw, 64px)', 'font-weight:700', 'letter-spacing:0.08em',
            'color:#e8434a', 'text-shadow:0 2px 14px rgba(0,0,0,0.85), 0 0 22px rgba(232,67,74,0.45)',
        ].join(';');
        const sub = document.createElement('div');
        sub.textContent = 'Waiting to respawn next wave…';
        sub.style.cssText = [
            'margin-top:10px', 'font-size:clamp(14px, 2.4vw, 22px)', 'font-weight:400',
            'letter-spacing:0.04em', 'color:#e8d9b8',
            'text-shadow:0 1px 6px rgba(0,0,0,0.9)',
            'animation:coop-wait-pulse 1.6s ease-in-out infinite',
        ].join(';');
        banner.append(title, sub);
        this.gameUI.layer('overlay').append(banner);
        this._downedBanner = banner;
    }

    /** Remove the downed banner (respawn / exit). */
    private hideDownedBanner(): void {
        this._downedBanner?.remove();
        this._downedBanner = null;
    }

    /** Host-authoritative wave-clear revive: bring back the local hero if it was
     *  down, and reset the guest's authoritative HP/alive + ghost position. The guest
     *  observes its alive flag flip and exits spectate on its side. */
    private respawnDeadHeroes(): void {
        if (this.heroController?.isDeadOrSpectating()) this.respawnLocalHero(-1.5, 0);
        if (this.coopSession?.role === 'host' && this.coopGhost && !this.guestHeroAlive) {
            this.guestHeroHp = this.guestHeroMaxHp;
            this.guestHeroAlive = true;
            (this.coopGhost as unknown as { clearDeath?: () => void }).clearDeath?.();
            const g = this.coopGhost as unknown as { position: Vector3; mesh: (Mesh & { visibility: number }) | null };
            g.position.set(1.5, g.position.y, 0);
            if (g.mesh) { g.mesh.position.x = 1.5; g.mesh.position.z = 0; g.mesh.visibility = 1; }
        }
    }

    /** Build the LOCAL hero's end-of-run summary (M4-12). id 0 = host, 1 = guest. */
    private buildLocalHeroSummary(id: number): CoopHeroSummary {
        const loadout = (this.powerSlots?.getSlots() ?? [])
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .map(s => ({ name: s.def.name, level: s.state.level, icon: s.def.icon, tier: s.def.tier }));
        return {
            id,
            championType: this.currentChampionType,
            kills: this.playerStats?.getTotalKills() ?? 0,
            level: this.levelSystem?.getLevel() ?? 1,
            xp: Math.round(this.playerStats?.getTotalMoneyEarned() ?? 0),
            // Guest's waveManager isn't ticked (returns 0), so read the snapshot-mirrored
            // wave; host/SP use the live waveManager.
            wave: this.coopSession?.role === 'guest'
                ? (this._guestWave?.wave ?? 0)
                : (this.waveManager?.getCurrentWave() ?? 0),
            loadout,
        };
    }

    /** Host / single-player run-over: aggregate the per-hero summaries and show the
     *  game-over. In co-op the host is the SOLE run-over authority — it broadcasts the
     *  final result so the guest renders the identical 2-column screen (showCoopGameOver).
     *  The guest never reaches here for run-over (it waits on onRunOver). */
    private buildAndSendRunSummary(): void {
        if (this._runEnded) return; // fire exactly once
        this._runEnded = true;
        const role = this.coopSession?.role ?? null;
        const timeSurvivedSec = (performance.now() - this.runStartTime) / 1000;
        const waveReached = this.waveManager?.getCurrentWave() ?? 0;
        const localHero = this.buildLocalHeroSummary(role === 'guest' ? 1 : 0);

        const heroes: CoopHeroSummary[] = [localHero];
        if (role === 'host' && this._guestSummary) heroes.push(this._guestSummary);
        if (role === 'host') {
            this.coopSession?.sendRunOver({ t: 'runOver', timeSurvivedSec, waveReached, heroes });
        }

        const summary: SurvivorsRunSummary = {
            waveReached,
            timeSurvivedSec,
            kills: localHero.kills,
            goldCollected: localHero.xp,
            levelReached: localHero.level,
            finalLoadout: localHero.loadout,
            championType: this.currentChampionType,
            heroes: heroes.length > 1 ? heroes.slice().sort((a, b) => a.id - b.id) : undefined,
        };
        const gos = this.game.getStateManager().getState('gameOver') as GameOverState;
        if (gos) gos.setSurvivorsSummary(summary);
        this.game.getStateManager().changeState('gameOver');
    }

    // ── Co-op session wiring (M6 D1) ─────────────────────────────────────────

    /** Create the CoopSession over `transport` and perform ALL game-side wiring.
     *  Called once from startRun's connect path, and again on a successful resume
     *  (M6 D1 transparent rejoin) — so everything here must be re-entrant: any
     *  prior session is disposed first, and once-only scene objects (GuestEnemies)
     *  are guarded against re-creation. Wiring order mirrors the original inline
     *  block: session → drop handlers → FX → guest branch | host branch. */
    private wireCoopSession(transport: NetTransport, localChamp: string): void {
        // Re-wire support: drop any previous session. dispose() closes the OLD
        // session's (already-dead) transport — never the new one passed in here.
        // Carry the old outgoing seq counter into the new session: the host's
        // persistent session keeps its high `inputSeq` watermark across our
        // resume, so a counter restarting at 0 would have every post-resume
        // input dropped as "stale" (movement-locked guest until it caught up).
        const carrySeq = this.coopSession?.getLocalSeq() ?? 0;
        this.coopSession?.dispose();
        this.coopSession = new CoopSession(new NetClient(transport), localChamp, undefined, carrySeq);
        console.log(`[coop] connected as ${this.coopSession.role}`);
        // M6 D1: remember role + champ so a later resume can reclaim this exact slot.
        this._myCoopRole = this.coopSession.role;
        this._localChampionType = localChamp;
        // M5-5/6: an unexpected drop of OUR socket, or the relay telling us the
        // OTHER peer left, both start the grace-window countdown UX — but only OUR
        // drop drives OUR resume attempts (M6 D1).
        transport.onClose?.(() => this.onConnectionLost('self'));
        this.coopSession.onPeerLeft = () => this.onConnectionLost('peer');
        // M6 D1: the peer came back — explicit relay notice, or (fallback) any
        // gameplay traffic from them proves they resumed. onPeerBack self-gates on
        // being in a 'peer'-kind grace window, so the per-message tap is a no-op
        // during normal play.
        this.coopSession.onPeerRejoined = () => this.onPeerBack();
        this.coopSession.onPeerTraffic = () => this.onPeerBack();
        // Cosmetic-FX replication (both roles): broadcast the local hero's
        // combat visuals + replay the teammate's. Damage is authoritative
        // elsewhere, so these carry no gameplay effect.
        setCoopFxEmit((kind, x, z, tx, tz, hint) =>
            this.coopSession?.sendFx({ t: 'fx', kind, x, z, tx, tz, hint }));
        // Hardening: a malformed fx must never abort the backlog drain loop or
        // the message pump — swallow, warn once (first failure, with the kind).
        this.coopSession.onFx = (m) => {
            try {
                this.playRemoteFx(m);
            } catch (e) {
                if (!this._fxDispatchWarned) {
                    this._fxDispatchWarned = true;
                    console.warn(`[coop] fx dispatch failed (kind=${m.kind})`, e);
                }
            }
        };
        // M3: wire guest enemy registry OR host spawn/death hooks.
        if (this.coopSession.role === 'guest') {
            // Once-only scene object: the GuestEnemies INSTANCE survives a re-wire
            // (never recreated mid-run), but its contents do not get to: removal is
            // driven only by death events, and any death that fired while our socket
            // was dead is lost forever — stale ids would stay frozen/targetable
            // zombies. Contract: every (re)wire clears the registry and re-requests
            // catch-up spawns below, fully rebuilding it from the host's live set.
            if (!this.guestEnemies) this.guestEnemies = new GuestEnemies(this.game, getCachedEnemyAsset);
            this.coopSession.onSpawn = (m) => { this._coopDbgSpawns++; this.guestEnemies?.spawn(m); };
            this.coopSession.onDeath = (m) => {
                this._coopDbgDeaths++;
                this.guestEnemies?.death(m.id);
                // Share death feedback the host produces (DeathMsg carries x/z/
                // reward/eliteElement): a gold reward float + a small cosmetic
                // death poof, so on the guest enemies don't just silently vanish.
                if (this.scene) {
                    if (m.reward > 0) this.damageNumbers?.showReward(new Vector3(m.x, 0, m.z), m.reward);
                    // withFxReplay: this burst is itself a replay of a host
                    // event — without the guard, aoeBurst's 'pe' broadcast
                    // would echo a phantom ring back to the host.
                    const scene = this.scene;
                    withFxReplay(() => aoeBurst(scene, [], m.x, m.z, { radius: m.isElite ? 1.6 : 0.9, damage: 0, element: (m.eliteElement ?? 'physical') as PowerElement }));
                }
                // M4-10 (per-player orbs): the guest gets its OWN power orb on
                // each elite death — magnets to the guest hero, and picking it up
                // raises the guest's local (non-blocking) power-choice. Fully
                // independent of the host's orb; both players grow their own build.
                if (m.eliteElement && this.scene && this.hero) {
                    const drop = new PowerDrop(
                        this.scene,
                        new Vector3(m.x, 0, m.z),
                        m.eliteElement,
                        () => this.hero!.getPosition(),
                        { pickupRadius: 1.5, magnetRadius: 4, magnetSpeed: 12, onPickup: (el) => this.onOrbPickup(el) },
                    );
                    this.powerDrops.push(drop);
                }
                // Per-player items (audit #21): a milestone-boss death carries its
                // tier — the guest spawns its OWN item gem, magneting to the guest
                // hero; pickup grants the GUEST's RunItems/HUD through the exact SP
                // path (spawnItemDrop → onItemPickup), which also skips tiers the
                // guest already owns. Fully independent of the host's local gem.
                if (m.itemTier !== undefined && this.scene && this.hero) {
                    this.spawnItemDrop(new Vector3(m.x, 0, m.z), m.itemTier);
                }
            };
            // M3b: guest basic-attack reports hits to the host instead of
            // mutating enemy HP locally. The target/enemy providers themselves
            // are wired role-aware in startRun (see activeAttackEnemies /
            // getNearestEnemy) — they read GuestEnemies at call time, so we do
            // NOT set them here (doing so raced with, and was clobbered by,
            // startRun's own setTargetProvider/setEnemyProvider once the GLB
            // load awaits resolved, leaving the guest unable to acquire a target).
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
            // M4-9: route ALL power/ability/DoT damage to the host too. Powers
            // call enemy.takeDamage directly (dozens of sites); this single
            // redirect catches them so the guest's powers actually hurt the
            // shared enemies instead of mutating render-only stubs.
            Enemy.guestDamageRedirect = (enemyId, amount, element) => {
                this.coopSession?.sendDamageReport({
                    t: 'damageReport',
                    enemyId,
                    amount,
                    element: element ?? 'physical',
                    sourceHeroId: 1,
                });
            };
            // M4-9 review fix: route guest CC/DoT (freeze/stun/burn/chill/curse)
            // to the host too — without this the guest's status powers were inert
            // on shared enemies (applied to never-ticked render-only stubs).
            Enemy.guestStatusRedirect = (enemyId, effect, durationS, strength) => {
                this.coopSession?.sendDamageReport({
                    t: 'damageReport',
                    enemyId,
                    amount: 0,
                    element: 'physical',
                    sourceHeroId: 1,
                    status: { kind: effect, duration: durationS, magnitude: strength },
                });
            };
            // M6 A5: route guest-cast knockback (Smash, dash push, knockback
            // item) to the host — without this only the guest's render-only
            // copies moved; the shared enemies were never pushed.
            Enemy.guestKnockbackRedirect = (enemyId, dirX, dirZ, magnitude) => {
                this.coopSession?.sendDamageReport({
                    t: 'damageReport',
                    enemyId,
                    amount: 0,
                    element: 'physical',
                    sourceHeroId: 1,
                    knockback: { dx: dirX, dz: dirZ, magnitude },
                });
            };
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
            // M4-12: the host owns run-over; render its authoritative 2-column result.
            this.coopSession.onRunOver = (m) => this.showCoopGameOver(m);
            // Now that the guest's spawn/death handlers are wired, ask the
            // host to re-send the current world so we render enemies that
            // already existed before we joined (catch-up). The host only
            // emits this in response — it can't, on its own connect (which
            // happened earlier, into an empty room). On a resume re-wire this
            // doubles as the resync request (M6 D1) — clear the registry FIRST
            // so enemies that died on the host while our socket was dead (their
            // death events went to nobody) don't linger as zombies; the catch-up
            // spawns rebuild the registry from the host's live set. On the
            // initial connect the registry is empty, so clear() is a no-op.
            this.guestEnemies?.clear();
            this.coopSession.sendRequestState();
        } else {
            // host: wire EnemyManager hooks. enemyManager is constructed
            // in startRun; store closures — they capture `this` so the actual
            // manager reference is resolved at call time, not wiring time.
            // The actual setOnEnemySpawned/setOnEnemyDied calls live in startRun
            // (installed unconditionally, self-gating on coopSession at call time).
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
                // maxRangeSq = 900 (30u) — covers power/ability reach (fireball,
                // chain, vortex) beyond basic-attack range, generous for lag.
                // Co-op peers are trusted, so this gate is anti-garbage, not anti-cheat.
                if (!validateDamageReport(m, ep, 900, srcPos)) return;
                if (e) {
                    // takeDamage fires Enemy.onDamageCallback, which broadcasts the
                    // damageResult to the guest centrally (M4-9) — no per-report echo.
                    if (m.amount > 0) e.takeDamage(m.amount, m.element as PowerElement);
                    // Apply routed CC/DoT host-side (guard amount>0 above so a
                    // pure-status report doesn't roll a 0-damage crit + echo).
                    if (m.status) {
                        e.applyStatusEffect(m.status.kind as StatusEffect, m.status.duration, m.status.magnitude);
                    }
                    // M6 A5: apply routed knockback through the BASE implementation —
                    // the guest's call already went through any subclass scaling
                    // (BossEnemy ×0.3) before redirecting, so a virtual re-dispatch
                    // here would double-scale. Base body keeps the alive/CC gating.
                    if (m.knockback) {
                        Enemy.prototype.applyKnockback.call(e, m.knockback.dx, m.knockback.dz, m.knockback.magnitude);
                    }
                }
            };

            // Catch-up ON DEMAND: the host connects FIRST (into an empty
            // room), so emitting catch-up on its own connect broadcasts
            // to nobody. Instead, wait for the guest to send requestState
            // (once it's connected + wired) and THEN re-send a spawn for
            // every live enemy. Without this, every enemy that spawned
            // before the guest joined is never delivered (guest spawn
            // count < host spawn count). Future spawns flow through the
            // self-gating setOnEnemySpawned hook installed synchronously.
            this.coopSession.onRequestState = () => {
                const liveNow = this.enemyManager?.getEnemies() ?? [];
                for (const e of liveNow) this.coopSession?.sendSpawn(this.buildSpawnMsg(e));
                console.log(`[coop] guest requested state: catch-up sent ${liveNow.length} live enemy spawns`);
            };
            // M4-12: keep the latest guest hero summary for run-over aggregation.
            this.coopSession.onRunSummary = (m) => { this._guestSummary = m.hero; };
        }
    }

    // ── Co-op reconnect grace (M5-5/6) ───────────────────────────────────────

    /** A peer dropped: 'self' = OUR socket closed, 'peer' = the relay reported
     *  peer-left. Both start the same grace window (_updateReconnect ticks it, shows
     *  the countdown, and decides what happens on expiry), but only 'self' drives
     *  resume attempts into our vacated slot (M6 D1). Idempotent — except that a
     *  'self' drop arriving while we were already waiting out a 'peer' drop upgrades
     *  the kind, so we still try to restore our own socket. */
    private onConnectionLost(kind: 'self' | 'peer'): void {
        if (!this.coopSession || this._runEnded) return;
        if (this._connMachine) {
            // Already in the grace window. If OUR socket now dropped too, switch to
            // self-resume — without our own slot back, nothing can recover.
            if (kind === 'self') this._connLostKind = 'self';
            return;
        }
        this._connLostKind = kind;
        this._resumeAccumS = 0;
        this._connMachine = new ConnectionMachine(30);
        this._connMachine.onPeerLeft(); // connected → reconnecting (30s)
        console.warn(`[coop] connection lost (room ${this._roomCode ?? '?'}, ${this.coopSession.role}, ${kind === 'self' ? 'our socket dropped' : 'peer left'}) — grace window started`);
    }

    /** M6 D1: the OTHER peer rejoined while we were waiting out THEIR absence —
     *  dismiss the grace window and resume play. Our wiring is intact (our socket
     *  never dropped); the rejoined guest re-sends requestState on its re-wire, so
     *  the host's existing onRequestState flow pushes it the fresh world state.
     *  No-op unless we're in a 'peer'-kind reconnect (a 'self' drop recovers via
     *  _attemptResume, and no traffic arrives on a dead socket anyway). */
    private onPeerBack(): void {
        if (this._connMachine?.state !== 'reconnecting' || this._connLostKind !== 'peer') return;
        console.log('[coop] peer rejoined — resuming play');
        this._connMachine.onPeerRejoined(); // reconnecting → connected
        this._endReconnect();               // hide overlay + clear the FSM
        // The HOST dropped and resumed: spawns/deaths during its gap went to our
        // (fine) socket via ITS dead one — i.e. were never sent — so our world is
        // stale. Rebuild it: drop every render copy and re-request catch-up spawns.
        // Fires exactly once per rejoin (_endReconnect above nulled _connMachine,
        // so the per-message onPeerTraffic tap no-ops until the next drop) and is
        // cheap (one requestState; the host re-sends live spawns, spawn() dedups).
        if (this.coopSession?.role === 'guest') {
            this.guestEnemies?.clear();
            this.coopSession.sendRequestState();
        }
    }

    /** M6 D1: one resume attempt — reconnect into OUR vacated slot (the Room DO
     *  restores our role within its grace window). Guarded by _resumeInFlight; a
     *  failed attempt is swallowed and the next ~1.5s tick retries until the FSM
     *  window expires (expiry behavior unchanged). */
    private _attemptResume(): void {
        const code = this._roomCode;
        const room = this._roomService;
        const role = this._myCoopRole;
        const champ = this._localChampionType;
        if (!code || !room || !role || !champ) return;
        this._resumeInFlight = true;
        room.connect(code, { resume: { role } }).then(
            (t) => {
                this._resumeInFlight = false;
                // The window may have expired (host-solo continue / guest run-over)
                // or the run ended while the connect was in flight — then there is no
                // session to re-wire; discard the fresh socket. Also bail if the DO
                // lost the vacated record (eviction) and re-admitted us as the OTHER
                // role: a mid-run role swap would invert all authority wiring.
                if (this._connMachine?.state !== 'reconnecting' || this._runEnded || t.role !== role) {
                    t.close();
                    return;
                }
                console.log(`[coop] resumed room ${code} as ${t.role} — re-wiring session`);
                // Re-wire the live run over the new transport. For the guest this
                // also clears + re-requests the enemy registry (resync); the
                // periodic snapshot keyframe restores the delta base (M5-7).
                this.wireCoopSession(t, champ);
                // OUR slot is restored — but if the OTHER peer left permanently while
                // our socket was dead, its peer-left notice reached nobody and we'd
                // hang silently. Don't end the reconnect UX: convert the wait into a
                // 'peer' wait with a fresh grace window (onPeerRejoined → onPeerLeft
                // re-arms the same FSM; no new transitions needed). First traffic
                // from the peer clears it via onPeerBack — within a tick when they're
                // alive, so the happy path is visually unchanged; if they're really
                // gone, the existing expiry fallback (host-solo continue / guest
                // run-over) fires as usual.
                this._connMachine.onPeerRejoined(); // reconnecting → connected (our resume succeeded)
                this._connLostKind = 'peer';
                this._connMachine.onPeerLeft();     // connected → reconnecting: fresh window for the PEER
            },
            () => {
                this._resumeInFlight = false; // swallow; retry on the next tick
            },
        );
    }

    /** Per-frame while a disconnect is pending: count down + update the overlay, then
     *  on expiry continue solo (host) or end the run (guest). Uses wall-clock dt. */
    private _updateReconnect(deltaTime: number): void {
        const cm = this._connMachine;
        if (!cm) return;
        cm.tick(deltaTime);
        // M6 D1: while the window is open because OUR socket dropped, retry a resume
        // into our vacated slot every ~1.5s (driven by the same render-loop tick).
        if (cm.state === 'reconnecting' && this._connLostKind === 'self') {
            this._resumeAccumS += deltaTime;
            if (this._resumeAccumS >= 1.5 && !this._resumeInFlight) {
                this._resumeAccumS = 0;
                this._attemptResume();
            }
        }
        if (!this._reconnectEl) {
            const el = document.createElement('div');
            el.style.cssText =
                'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99998;display:flex;' +
                'align-items:center;justify-content:center;background:#0008;color:#fda;' +
                'font:600 20px/1.4 sans-serif;text-align:center;pointer-events:none';
            document.body.appendChild(el);
            this._reconnectEl = el;
        }
        const secs = Math.ceil(cm.graceRemaining);
        const role = this.coopSession?.role;
        // 'self' = OUR socket dropped (we're the one reconnecting); 'peer' = the
        // teammate dropped (we're waiting for THEM). Subject must match the kind.
        const self = this._connLostKind === 'self';
        const headline = self ? 'Connection lost' : 'Teammate disconnected';
        const action = self ? 'Reconnecting you…' : 'Reconnecting…';
        const outcome = self
            ? (role === 'host' ? '(run continues solo if you can’t rejoin)' : '(run ends if you can’t rejoin)')
            : (role === 'host' ? '(continuing solo if they don’t return)' : '(run ends if the host doesn’t return)');
        this._reconnectEl.textContent = `${headline}\n${action} ${secs}s\n${outcome}`;
        this._reconnectEl.style.whiteSpace = 'pre-line';

        if (cm.state === 'closed') {
            this._endReconnect();
            if (this.coopSession?.role === 'guest') {
                // The host (authority) is gone — the guest can't simulate alone.
                this.buildAndSendRunSummary();
            } else if (this.heroController?.isDeadOrSpectating()) {
                // Host is itself down with no teammate left to revive it (powers/attack
                // are suspended while spectating, so it can't clear a wave) → end the run
                // rather than soft-lock as an inert spectator.
                this.buildAndSendRunSummary();
            } else {
                // Host-solo continue: fully detach co-op so the host plays as single-player
                // (drop the ghost + its targeting provider, stop streaming to a dead socket,
                // re-enable the pause overlay). coopRole becomes null next frame.
                this.guestHeroAlive = false;
                this.coopGhost?.dispose();
                this.coopGhost = null;
                this.disposeUltChannels(); // M6 C2: the peer is gone — stop its channels
                this._heroProviders.length = 1; // drop the ghost provider IN PLACE (EnemyManager shares this array)
                this.coopSession?.dispose();
                this.coopSession = null;
                // Stop cosmetic-FX broadcasting too — otherwise isCoopFxActive() stays
                // true and every cast keeps building JSON hints that go nowhere.
                setCoopFxEmit(null);
            }
        }
    }

    private _endReconnect(): void {
        this._connMachine = null;
        this._reconnectEl?.remove();
        this._reconnectEl = null;
        this._connLostKind = null;  // M6 D1 (an in-flight resume self-checks on resolve)
        this._resumeAccumS = 0;
        // Invariant: no reconnect state ⇒ no resume considered in flight. A connect
        // promise that resolves later self-discards (_connMachine is null → it
        // closes the fresh socket) and resetting the flag again is harmless.
        this._resumeInFlight = false;
    }

    /** True when this def's cast() delivers its visuals through the PowerEffects
     *  primitives (which self-broadcast exact 'pe' FX): all slot ultimates, and any
     *  fusion whose element pair has a registered autocast archetype. */
    private castRoutesThroughPrimitives(def: PowerDefinition): boolean {
        if (def.tier === 'ultimate') return true;
        if (def.tier === 'fusion' && def.elements?.length === 2) {
            return !!getAutocastArchetype(archetypeKey(def.elements[0], def.elements[1]));
        }
        return false;
    }

    /** Replay a teammate's cosmetic combat FX (no gameplay effect — damage/CC are
     *  authoritative via damageReport/snapshot). Dispatches by kind. */
    private playRemoteFx(m: FxMsg): void {
        if (!this.scene) return;
        switch (m.kind) {
            case 'proj': {
                const shape = m.hint ?? 'sphere';
                const element = shape === 'mageBolt' ? 'arcane' : 'physical';
                spawnCosmeticProjectile(this.scene, shape, m.x, m.z, m.tx ?? m.x, m.tz ?? m.z, element);
                break;
            }
            case 'swing': {
                const range = m.hint ? parseFloat(m.hint) : 3.5;
                spawnCosmeticSwingRing(this.scene, m.x, m.z, isNaN(range) ? 3.5 : range);
                break;
            }
            case 'power':
            case 'ult': {
                // M6 C2: manual ults send a parameterised JSON hint → exact replay.
                if (m.kind === 'ult' && this.replayUltimateFx(m)) break;
                // Cosmetic element-coloured pop at the teammate's cast point (no damage —
                // enemies=[]). Fallback for casts that don't route through the PowerEffects
                // primitives (base mage/ranger powers, un-migrated fusion pairs) and for
                // 'ult' hints that are unknown/malformed (or plain elements: dash, legacy
                // ults). withFxReplay stops aoeBurst's own 'pe' broadcast from echoing
                // back to the sender.
                const PE_ELEMENTS: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];
                const element = PE_ELEMENTS.includes(m.hint as PowerElement)
                    ? m.hint as PowerElement
                    : (m.kind === 'ult' ? 'arcane' : 'physical');
                const scene = this.scene;
                withFxReplay(() => aoeBurst(scene, [], m.x, m.z, { radius: m.kind === 'ult' ? 3.5 : 2, damage: 0, element }));
                break;
            }
            case 'ultStart':
                this.startRemoteUltChannel(m);
                break;
            case 'ultStop':
                // hint = ability id; dispose() also clears the safety timer + map entry.
                if (m.hint) this.coopUltChannels.get(m.hint)?.dispose();
                break;
            case 'abilityClip':
                this.replayRemoteAbilityClip(m);
                break;
            case 'pe': {
                // Exact power-FX replication (M6 C1): re-run the teammate's PowerEffects
                // primitive with enemies=[] and zero damage/status — pure cosmetics.
                // Nothing routes through the guest damage/status redirects, a replayed
                // vortex can't pull enemies (pull:0 + creation-time isReplay guard), and
                // withFxReplay() stops the replayed primitive from re-emitting.
                this.replayPrimitiveFx(m);
                break;
            }
            case 'enemyProj':
                spawnCosmeticEnemyProjectile(this.scene, m.x, m.z, m.tx ?? m.x, m.tz ?? m.z);
                break;
            case 'telegraph':
                spawnCosmeticTelegraph(this.scene, m.x, m.z, m.tx ?? m.x, m.tz ?? m.z, m.hint === 'pull' ? 'pull' : 'dash');
                break;
            default:
                break;
        }
    }

    /** Parse + replay one 'pe' (primitive effect) message. Explicit per-primitive
     *  allowlist (never dynamic dispatch by string); numeric params are sanitised
     *  with sane fallbacks + caps; malformed hints are dropped, never thrown. */
    private replayPrimitiveFx(m: FxMsg): void {
        const scene = this.scene;
        if (!scene || !m.hint) return;
        try {
            const h = JSON.parse(m.hint) as Record<string, unknown>;
            const PE_ELEMENTS: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];
            const element = PE_ELEMENTS.includes(h.e as PowerElement) ? h.e as PowerElement : 'physical';
            const num = (v: unknown, fallback: number, max: number): number =>
                typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : fallback;
            withFxReplay(() => {
                switch (h.p) {
                    case 'aoeBurst':
                        aoeBurst(scene, [], m.x, m.z, {
                            radius: num(h.r, 2, 20), damage: 0, element,
                            ringLifeS: typeof h.l === 'number' ? num(h.l, 0.35, 2) : undefined,
                        });
                        break;
                    case 'bolt':
                        // One chain segment, replayed verbatim (spawnBolt emits per hop).
                        spawnBolt(scene, new Vector3(m.x, 1, m.z), new Vector3(m.tx ?? m.x, 1, m.tz ?? m.z), element);
                        break;
                    case 'vortex':
                        // pull:0 + the primitive's creation-time isReplay guard ⇒ the
                        // replayed vortex can never move this side's enemies; tickDamage
                        // 0 over enemies=[] ⇒ no gameplay. finalBurst omitted — the
                        // caster's real final burst arrives as its own 'pe' aoeBurst.
                        gatherVortex(scene, [], m.x, m.z, {
                            radius: num(h.r, 4, 20), durationS: num(h.d, 1.5, 8),
                            pull: 0, tickDamage: 0, element,
                        });
                        break;
                    case 'zone':
                        persistentZone(scene, [], m.x, m.z, {
                            radius: num(h.r, 3, 20), durationS: num(h.d, 3, 10), tickDamage: 0, element,
                            crawlToward: typeof h.cx === 'number' && typeof h.cz === 'number'
                                ? { x: h.cx, z: h.cz } : undefined,
                            crawlSpeed: typeof h.cs === 'number' ? num(h.cs, 1.5, 10) : undefined,
                        });
                        break;
                    case 'volley':
                        omniVolley(scene, [], m.x, m.z, {
                            count: Math.round(num(h.c, 6, 24)), speed: num(h.s, 16, 40),
                            damage: 0, element,
                            lifeS: typeof h.l === 'number' ? num(h.l, 1.2, 4) : undefined,
                        });
                        break;
                    case 'arrow':
                        // Fixed-point flight target (the enemy's position at emit time);
                        // impact FX arrives as the impacted primitive's own 'pe'.
                        arrowStrike(scene, m.x, m.z,
                            { isAlive: () => true, getPosition: () => ({ x: m.tx ?? m.x, z: m.tz ?? m.z }) },
                            element, () => { /* cosmetic flight only */ });
                        break;
                    default:
                        break; // unknown primitive name — ignore
                }
            });
        } catch { /* malformed remote hint — drop silently */ }
    }

    /** M6 C2: parse + replay one EXACT one-shot manual-ultimate visual. Same shape
     *  as replayPrimitiveFx: explicit ability-id allowlist, sanitised/capped numeric
     *  params, malformed hints dropped. The AbilityVisuals builders are the very
     *  code the local cast renders with, minus all damage/CC — and they never emit
     *  fx, so no withFxReplay wrap is needed. Returns false for non-JSON/unknown
     *  hints so the caller falls back to the generic element burst. */
    private replayUltimateFx(m: FxMsg): boolean {
        const scene = this.scene;
        if (!scene || !m.hint || !m.hint.startsWith('{')) return false;
        try {
            const h = JSON.parse(m.hint) as Record<string, unknown>;
            switch (h.a) {
                case 'meteor':
                    // Same barrage scheduler as the local cast (5 strikes, 120ms
                    // stagger, scatter ring); each replay strike is visual-only.
                    // Strikes are setTimeout-staggered, so guard against the run
                    // having ended before the late ones land.
                    scheduleMeteorBarrage(new Vector3(m.x, 0, m.z), (target) => {
                        if (this.scene === scene) createMeteorVisual(scene, target, 4);
                    });
                    return true;
                case 'frostNova':
                    createFrostNovaVisual(scene); // arena-wide, parameterless
                    return true;
                case 'smash':
                    spawnSmashShockwave(scene, new Vector3(m.x, 0, m.z));
                    return true;
                case 'expArrow': {
                    // Flight to the FIXED point the caster locked at spawn (exact),
                    // then the blast visual at the impact point.
                    const r = typeof h.r === 'number' && Number.isFinite(h.r) && h.r > 0
                        ? Math.min(h.r, 8) : 3;
                    spawnExplosiveArrowFlight(scene, new Vector3(m.x, 0, m.z),
                        new Vector3(m.tx ?? m.x, 1.0, m.tz ?? m.z),
                        (impact) => { if (this.scene === scene) spawnExplosionVisual(scene, impact, r); });
                    return true;
                }
                default:
                    return false; // unknown ability id → generic burst fallback
            }
        } catch { return false; }
    }

    /** M6 C2: start a cosmetic channelled-ultimate replay (whirlwind hurricane /
     *  multishot volley) that follows the ghost's interpolated position each frame.
     *  Lifecycle is airtight: 'ultStop' disposes; a duration+2s safety timeout
     *  catches a lost stop; exit()/host-solo detach dispose whatever remains. */
    private startRemoteUltChannel(m: FxMsg): void {
        const scene = this.scene;
        if (!scene || !m.hint) return;
        try {
            const h = JSON.parse(m.hint) as Record<string, unknown>;
            const ability = h.a;
            if (ability !== 'whirlwind' && ability !== 'multishot') return;
            // One concurrent channel per ability per (single) peer — restart replaces.
            this.coopUltChannels.get(ability)?.dispose();
            const d = typeof h.d === 'number' && Number.isFinite(h.d) && h.d > 0 ? Math.min(h.d, 10) : 5;
            const r = typeof h.r === 'number' && Number.isFinite(h.r) && h.r > 0 ? Math.min(h.r, 20) : 7;
            // Follow the ghost each frame; until it exists (champ still loading) the
            // cast point anchors the visual.
            const fallback = new Vector3(m.x, 0, m.z);
            const channel = startCosmeticUltChannel(
                scene, ability,
                () => this.coopGhost?.getPosition() ?? fallback,
                () => this.coopGhost?.getFacingY() ?? 0,
                d, r,
            );
            const timer = window.setTimeout(() => entry.dispose(), (d + 2) * 1000);
            const entry = {
                dispose: () => {
                    window.clearTimeout(timer);
                    channel.dispose(); // idempotent
                    this.coopUltChannels.delete(ability);
                },
            };
            this.coopUltChannels.set(ability, entry);
        } catch { /* malformed remote hint — drop silently */ }
    }

    /** M6 C2: dispose every active cosmetic ult channel (state exit / peer detach). */
    private disposeUltChannels(): void {
        for (const c of Array.from(this.coopUltChannels.values())) c.dispose();
        this.coopUltChannels.clear();
    }

    /** M6 C2: play the teammate's exact ability body clip on the ghost. The suffix
     *  is allowlisted against the clips we ourselves can send (COOP_ABILITY_CLIP_
     *  SUFFIXES); duration/speed are capped. playAbilityClip itself no-ops safely
     *  when the ghost's rig has no matching clip (e.g. different champion). */
    private replayRemoteAbilityClip(m: FxMsg): void {
        if (!m.hint || !this.coopGhost) return;
        try {
            const h = JSON.parse(m.hint) as Record<string, unknown>;
            if (typeof h.s !== 'string' || !COOP_ABILITY_CLIP_SUFFIXES.has(h.s)) return;
            const d = typeof h.d === 'number' && Number.isFinite(h.d) && h.d > 0
                ? Math.min(h.d, 10) : undefined;
            const sp = typeof h.sp === 'number' && Number.isFinite(h.sp)
                ? Math.min(Math.max(h.sp, 0.1), 5) : 1.0;
            this.coopGhost.playAbilityClip(h.s, d, sp);
        } catch { /* malformed remote hint — drop silently */ }
    }

    /** Guest run-over (M4-12): render the host's authoritative final result. */
    private showCoopGameOver(m: RunOverMsg): void {
        if (this._runEnded) return;
        this._runEnded = true;
        const me = m.heroes.find(h => h.id === 1) ?? m.heroes[0];
        const summary: SurvivorsRunSummary = {
            waveReached: m.waveReached,
            timeSurvivedSec: m.timeSurvivedSec,
            kills: me?.kills ?? 0,
            goldCollected: me?.xp ?? 0,
            levelReached: me?.level ?? 1,
            finalLoadout: me?.loadout ?? [],
            championType: me?.championType ?? this.currentChampionType,
            heroes: m.heroes.length > 1 ? m.heroes.slice().sort((a, b) => a.id - b.id) : undefined,
        };
        const gos = this.game.getStateManager().getState('gameOver') as GameOverState;
        if (gos) gos.setSurvivorsSummary(summary);
        this.game.getStateManager().changeState('gameOver');
    }

    /** On-screen co-op debug box (top-right) — shows the host→guest pipeline live
     *  so issues are readable without the dev console. Opt-in via `?coopdebug`. */
    private _updateCoopDebugOverlay(deltaTime: number): void {
        if (!this._coopDbgEnabled || !this.coopSession) return;
        this._coopDbgAccumS += deltaTime;
        if (this._coopDbgAccumS < 0.25) return;
        this._coopDbgAccumS = 0;
        if (!this._coopDbgEl) {
            const el = document.createElement('div');
            el.style.cssText =
                'position:fixed;top:8px;right:8px;z-index:99999;background:#000a;color:#3f6;' +
                'font:11px/1.35 monospace;padding:6px 8px;border:1px solid #0a4;border-radius:4px;' +
                'white-space:pre;pointer-events:none';
            document.body.appendChild(el);
            this._coopDbgEl = el;
        }
        const role = this.coopSession.role;
        const hp = this.hero?.getPosition();
        const lines = [`COOP role=${role}  spawns=${this._coopDbgSpawns} deaths=${this._coopDbgDeaths}`];
        if (role === 'host') {
            lines.push(`enemies(host)=${this.enemyManager?.getEnemies().length ?? 0}`);
            lines.push(`ghost=${this.coopGhost ? 'Y' : 'N'} guestHP=${Math.round(this.guestHeroHp)}`);
            // M4-8 diag: is the guest's input arriving, and is the ghost moving from it?
            const inp = this.coopSession.getLatestInput();
            const gp = this.coopGhost?.getPosition();
            lines.push(`in(${inp ? `${inp.dx.toFixed(1)},${inp.dz.toFixed(1)}` : '—'}) seq=${this.coopSession.getInputAckSeq()}`);
            lines.push(`ghost@(${gp ? `${gp.x.toFixed(1)},${gp.z.toFixed(1)}` : '—'})`);
        } else {
            const list = this.guestEnemies?.getEnemies() ?? [];
            let alive = 0, nearest = Infinity;
            for (const e of list) {
                if (!e.isAlive()) continue;
                alive++;
                const ep = e.getPosition();
                const d = Math.hypot(ep.x - (hp?.x ?? 0), ep.z - (hp?.z ?? 0));
                if (d < nearest) nearest = d;
            }
            const snap = this.coopSession.getLatestSnapshot();
            lines.push(`snaps=${this._coopDbgSnaps} hasSnap=${snap ? 'Y' : 'N'} snapEnemies=${snap?.enemies.length ?? 0}`);
            // M4-8 diag: my predicted pos vs the host-authoritative heroes[1], + the gap.
            const h1 = snap?.heroes.find(h => h.id === 1);
            const gap = (h1 && hp) ? Math.hypot(h1.x - hp.x, h1.z - hp.z) : -1;
            lines.push(`h1@(${h1 ? `${h1.x.toFixed(1)},${h1.z.toFixed(1)}` : '—'}) gap=${gap.toFixed(1)}`);
            lines.push(`enemies(local)=${list.length} alive=${alive}`);
            lines.push(`nearest=${nearest === Infinity ? 'none' : nearest.toFixed(1)}u (ranger~9 melee~3.5)`);
            const ba = this.heroController?.getBasicAttack();
            if (ba) {
                const d = ba.debugState();
                lines.push(`ATK busy=${d.busy ? 'Y' : 'N'} tgt=${d.hasTarget ? 'Y' : 'N'} dist=${d.dist.toFixed(1)} rng=${d.range.toFixed(1)} cd=${d.cooldown.toFixed(2)}`);
            }
        }
        lines.push(`hero@(${hp?.x.toFixed(1)},${hp?.z.toFixed(1)})`);
        this._coopDbgEl.textContent = lines.join('\n');
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

        // Itemization + on-screen shop teardown. shopOverlay.close() fires onClosed
        // (a no-op now). exit() must NEVER call endShoppingPhase() here: no wave
        // scheduling during teardown. The goblin portrait is a session-scoped
        // singleton — stop its render loop and detach its element, but don't
        // dispose it (it's reused next run, like the cached GLB containers).
        this.shopOverlay?.close();
        this.shopOverlay = null;
        this.characterProfile?.close();
        this.characterProfile = null;
        this.goblinPortrait?.stop();
        this.goblinPortrait?.detach();
        this.goblinPortrait = null;
        this.itemEffects?.reset();
        this.itemEffects = null;
        this.rageGlow?.dispose();
        this.rageGlow = null;
        this.equipment = null;
        this.equipTracker = newEquipFoldTracker();
        this.shopPhase = 'none';
        this.currentStock = [];
        this.purchasedIds.clear();
        this.rerollsThisVisit = 0;
        this.equipMaxHpApplied = 0;

        Enemy.onDamageCallback = null;
        Enemy.onRewardCallback = null;
        Enemy.curveDropFn = null; // globe drop off outside a run
        Enemy.onKillCallback = null;
        Enemy.onShatterCallback = null;
        Enemy.guestDamageRedirect = null; // M4-9: clear the guest damage redirect
        Enemy.guestStatusRedirect = null; // M4-9 review fix: clear the guest status redirect
        Enemy.guestKnockbackRedirect = null; // M6 A5: clear the guest knockback redirect
        setCoopFxEmit(null);              // cosmetic-FX: stop broadcasting on teardown
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

        // Co-op M4: drop the per-player slots last (the disposes above ran through
        // the accessors, writing null into slot0; this releases the slot itself).
        this.players = [];
        this.localId = 0;

        this.coopSession?.dispose();
        this.coopSession = null;
        // Hardening: drop any lobby stash that never reached startRun() (closes
        // its un-consumed transport) so a stale handoff can't leak into a later run.
        clearPendingCoop();
        this._fxDispatchWarned = false;
        this.coopGhost?.dispose();
        this.coopGhost = null;
        this.coopGhostPending = false;
        this.disposeUltChannels(); // M6 C2: tear down any in-flight cosmetic ult channel
        // Part D: reset host-tracked guest-hero HP state and providers array.
        this.guestHeroHp = 0;
        this.guestHeroMaxHp = 0;
        this.guestHeroAlive = true;
        this._spectating = false;   // M4-11
        this.hideDownedBanner();
        this._runEnded = false;     // M4-11
        this._guestSummary = null;  // M4-12
        this._summaryAccumS = 0;    // M4-12
        this._endReconnect();       // M5-6: tear down any reconnect overlay/FSM
        this._roomCode = null;
        // M6 D1: drop resume context (an in-flight attempt self-discards on resolve:
        // _connMachine is null after _endReconnect, so it closes the fresh socket).
        this._roomService = null;
        this._myCoopRole = null;
        this._localChampionType = null;
        this._resumeInFlight = false;
        this._heroProviders = [];
        // M3: clear guest enemy registry and reset snapshot state.
        this.guestEnemies?.clear();
        this.guestEnemies = null;
        this._guestWave = null;
        this._coopGhostLastAnim = 0;
        this._snapshotAccumS = 0;
        this._snapshotTick = 0;
        this._lastSentSnapshot = null; // M5-7
        this._lastGuestSnapTick = -1;
        this._lastReconcileTick = -1;
        // Co-op debug overlay teardown + counter reset.
        this._coopDbgEl?.remove();
        this._coopDbgEl = null;
        this._coopDbgAccumS = 0;
        this._coopDbgSpawns = 0;
        this._coopDbgDeaths = 0;
        this._coopDbgSnaps = 0;

        this.hero?.dispose();
        this.hero = null;

        this.ui?.dispose();
        this.ui = null;

        this.map?.dispose();
        this.map = null;
        this.propField?.dispose();
        this.propField = null;
        this._lastHeroX = 0;
        this._lastHeroZ = 0;
        clearCurveOrigin(); // globe drop reads 0 everywhere until the next run

        this.grass?.dispose();
        this.grass = null;
        this.grassFar?.dispose();
        this.grassFar = null;

        // Restore Game.setupScene's fog-off default so the menu / game-over
        // (and any non-survivors flow) aren't left hazed by this run.
        if (this.scene) {
            this.scene.fogEnabled = false;
            this.scene.fogMode = Scene.FOGMODE_NONE;
        }

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
        this.globeSky?.dispose();
        this.globeSky = null;

        // Free the cross-run GPU resource pools. By now every survivors mesh that
        // referenced these (hero, enemies, drops, projectiles) has been disposed
        // above, so disposing the shared materials + pooled meshes is safe — and it
        // bounds cross-run growth to a single run even if a future caller ever
        // introduces an unbounded cache key. Cached materials are recompiled (and
        // re-prewarmed) on the next run start. ProjectilePool reassigns materials on
        // acquire, so clearing the cache never leaves a pooled mesh on a dead material.
        clearMaterialCache();
        clearProjectilePools();

        // Restore the post-fx baseline if the late-wave quality trim engaged
        // this run (the pipeline + glow layer are persistent, Game-owned).
        if (this._perfTrimLevel > 0) this.game.setPostFxReduced(false);
        this._perfTrimLevel = 0;
        this._fpsEma = 60;

        this.scene = null;
        this.timeScale = 1.0;
        this.runPerks = { damageMultiplier: 1.0, moveSpeedMultiplier: 1.0, attackRangeMultiplier: 1.0 };
    }

    public update(deltaTime: number): void {
        // If game hasn't started yet (champion select showing), skip game updates
        if (!this.heroController) return;

        // FPS EMA for the late-wave quality trim — real (unscaled) dt, so the
        // slow-mo orb doesn't read as a frame-rate collapse.
        if (deltaTime > 0) {
            this._fpsEma += (1 / deltaTime - this._fpsEma) * Math.min(1, deltaTime / 8);
        }

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

        if (this.coopSession) this._updateCoopDebugOverlay(deltaTime);
        if (this._connMachine) this._updateReconnect(deltaTime); // M5-6 grace countdown

        // --- Co-op M2 sync: broadcast our pose, render the remote ghost ---
        if (this.coopSession && this.hero) {
            const hp = this.hero.getPosition();
            const ry = this.hero.getFacingY();
            // NOTE(M3): the per-frame object literal here is intentionally simple for
            // M2; binary encoding + scratch reuse arrive at M3 (spec §3/§6).
            // anim: 2 while a basic-attack clip is playing so the teammate's ghost can
            // mirror the swing/shot; 1 otherwise (the ghost derives walk/idle from
            // its interpolated velocity).
            // heroState carries the local champion identity + an anim code so the
            // teammate's ghost mirrors the body animation. 3 = special/ultimate (any
            // power-slot cast or ult sets glbSpecialTimer → isSpecialActive), 2 = basic
            // attack, 1 = idle/run (the ghost derives walk/idle from velocity). Special
            // wins so an ult's cast pose shows even while the basic attack is on cooldown.
            const heroAnimSrc = this.hero as unknown as { isSpecialActive?: () => boolean; isAttackActive?: () => boolean };
            const heroAnim = heroAnimSrc.isSpecialActive?.() ? 3 : (heroAnimSrc.isAttackActive?.() ? 2 : 1);
            this.coopSession.sendLocalPose({ x: hp.x, y: hp.y, z: hp.z, ry }, heroAnim);
            if (this.coopSession.role === 'guest') {
                const mv = this.heroController?.getMoveInput();
                // buttons (dash/ult) carried for M4-9 ability routing; 0 for now.
                // dt = the same (timeScale-scaled) dt the local sim integrated this
                // input with — recorded for replay reconciliation (clamped inside).
                this.coopSession.sendLocalInput(mv?.dx ?? 0, mv?.dz ?? 0, 0, dt);
            }

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
                    // M4-8: the host input-integrates the ghost from HERE, so seed it at
                    // the guest's reported pose — otherwise it would start at the origin
                    // and the guest's first reconcile would yank it across the arena.
                    if (this.coopSession.role === 'host') {
                        const seed = this.coopSession.getRemotePose(performance.now());
                        if (seed) {
                            const g = this.coopGhost as unknown as { position: Vector3; mesh: Mesh | null };
                            g.position.set(seed.x, seed.y, seed.z);
                            if (g.mesh) { g.mesh.position.x = seed.x; g.mesh.position.z = seed.z; g.mesh.rotation.y = seed.ry; }
                        }
                    }
                    // Shared/tethered camera: set once; reads both heroes' live
                    // positions each frame. Null-guarded (hero can be nulled on death).
                    this.heroController?.setCameraFocusProvider(() => {
                        const self = this.hero?.getPosition();
                        const mate = this.coopGhost?.getPosition();
                        // Heights rescaled for the isometric camera (taller base +
                        // narrower FOV needs more height per unit of separation).
                        if (!self || !mate) return { x: 0, z: 0, height: 30 };
                        // M4-11: while spectating, follow the surviving teammate alone.
                        if (this._spectating) return { x: mate.x, z: mate.z, height: 33 };
                        return computeCameraFocus(
                            { x: self.x, z: self.z },
                            { x: mate.x, z: mate.z },
                            { baseHeight: 30, maxHeight: 45, zoomPerUnit: 0.6 },
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
            if (this.coopGhost) {
                // Fire the remote hero's clip once on the rising edge (heroState carries
                // the code). BEFORE update() so it plays this frame. 3 = special/ult,
                // 2 = basic attack. triggerSpecial outranks triggerAttack (Champion gates
                // attack while a special is active), so an ult's pose shows correctly.
                const ranim = this.coopSession.getRemoteAnim();
                const ghostAnimApi = this.coopGhost as unknown as {
                    triggerAttack?: (t?: Vector3) => void; triggerSpecial?: () => void;
                    isSpecialActive?: () => boolean;
                };
                if (ranim !== this._coopGhostLastAnim) {
                    // M6 C2: when an exact ability clip (fx 'abilityClip') is already
                    // driving the rig, isSpecialActive() is true — skip the generic
                    // special pose so triggerSpecial doesn't stomp the real clip.
                    if (ranim === 3) {
                        if (!ghostAnimApi.isSpecialActive?.()) ghostAnimApi.triggerSpecial?.();
                    } else if (ranim === 2) ghostAnimApi.triggerAttack?.();
                }
                this._coopGhostLastAnim = ranim;

                if (this.coopSession.role === 'host' && this.guestHeroAlive) {
                    // HOST: the ghost IS the guest hero — simulate it from the guest's
                    // latest input (authoritative). This replaces M2/M3 pose-copy so the
                    // guest's position can no longer be laggy/spoofed, and feeds the
                    // contact-damage + snapshot loops a host-owned position. A DEAD guest's
                    // ghost holds its last pose (no integration) and is faded (see below).
                    this._driveGuestGhostFromInput(dt);
                } else if (this.coopSession.role !== 'host' && pose) {
                    // GUEST: the ghost is the host hero — render it from the host's pose
                    // (the host is trivially authoritative for its own hero). Estimate
                    // velocity from the pose delta to drive walk anim, then snap to pose.
                    const g = this.coopGhost as unknown as { position: Vector3; mesh: Mesh | null };
                    if (dt > 1e-4) {
                        this._coopGhostVel.set((pose.x - g.position.x) / dt, 0, (pose.z - g.position.z) / dt);
                        this.coopGhost.setPlayerVelocity(this._coopGhostVel);
                    }
                    this.coopGhost.update(dt);
                    g.position.set(pose.x, pose.y, pose.z);
                    if (g.mesh) {
                        g.mesh.position.x = pose.x;
                        g.mesh.position.z = pose.z;
                        // Render-only globe drop — gameplay pose stays flat.
                        g.mesh.position.y = pose.y - curveDropAt(pose.x, pose.z);
                        g.mesh.rotation.y = pose.ry; // network yaw, after update()
                    }
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

        // The on-screen shop opens immediately at wave clear (see setOnWaveCleared)
        // and renders its goblin via its own isolated engine — there's no world
        // merchant to tick here. The shop UI pauses solo via isPausedForOverlay().
        this.rageGlow?.update();
        // Equipment HP regen (e.g. Troll-Hide Vest):
        const equipRegen = this.playerStats?.hpRegenPctPerSec ?? 0;
        if (equipRegen > 0 && this.heroController) {
            this.heroController.heal(this.heroController.getMaxHealth() * equipRegen * deltaTime);
        }
        this.itemEffects?.tick(deltaTime);

        // ── Infinite-map globe upkeep ──────────────────────────────────────
        // Order matters: set the curve origin FIRST so every render-side
        // curveDropAt() call this frame (enemies, drops, props) uses the
        // hero's current position.
        if (this.hero) {
            const hp = this.hero.getPosition();
            setCurveOrigin(hp.x, hp.z);
            this.map?.update(hp.x, hp.z);
            // Sky dome follows the hero so a long run never walks out of it.
            this.globeSky?.update(hp.x, hp.z, deltaTime);
            // Directional shadow frustum is a fixed ±30-unit ortho box around
            // the light — keep it centred on the hero. Snap to 0.5 u so the
            // shadow texels don't shimmer as the hero moves.
            if (this.shadowSourceLight) {
                this.shadowSourceLight.position.x = Math.round((hp.x + 8) * 2) / 2;
                this.shadowSourceLight.position.z = Math.round((hp.z + 8) * 2) / 2;
            }
            this.grass?.setHeroPos(hp); // grass treadmill recentre
            this.grassFar?.setHeroPos(hp);
            // Travel direction from frame-to-frame hero displacement (cheap,
            // no new API): zero when stationary → recycle uses the full circle.
            const pdx = hp.x - this._lastHeroX;
            const pdz = hp.z - this._lastHeroZ;
            this._lastHeroX = hp.x;
            this._lastHeroZ = hp.z;
            this.propField?.update(hp.x, hp.z, pdx, pdz);
        }

        // Shift the distance-fog band outward by however far the camera has
        // receded with zoom, so the hero + spawn ring stay crisp at every zoom
        // and only the far horizon hazes. (Babylon fog is camera-distance based;
        // a fixed band would creep over the play area as you zoom out.) The grass
        // shader reads scene.fogStart/End, so both layers track this too.
        const fogScene = this.scene;
        if (fogScene && fogScene.fogEnabled) {
            const fogShift = this.heroController?.getCameraDistanceFromDefault() ?? 0;
            fogScene.fogStart = FOG_START + fogShift;
            fogScene.fogEnd = FOG_END + fogShift;
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
                this.grassFar?.setTorch(opts);
            } else {
                this.grass.setTorch(null);
                this.grassFar?.setTorch(null);
            }

            // Character grass displacement: hero + nearest 7 enemies push
            // surrounding blades outward as they move. Shader caps at 8,
            // so we trim if more are alive nearby. Reuse the scratch array —
            // setInfluencers reads the contents synchronously, so swapping the
            // contents in-place each frame is safe.
            const influencers = this._scratchInfluencers;
            influencers.length = 0;
            influencers.push(this.hero.getPosition());
            if (this.enemyManager) {
                const enemies = this.enemyManager.getEnemies();
                for (let i = 0; i < enemies.length && influencers.length < 8; i++) {
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
                // Drive render-only enemies. Positions go through an interpolation
                // buffer (same smoothing as the champion ghost): push each NEW
                // snapshot's positions + HP/flags once (keyed on tick), then
                // interpolate EVERY frame toward a render time ~100ms in the past.
                if (this.guestEnemies) {
                    if (snap.tick !== this._lastGuestSnapTick) {
                        this._lastGuestSnapTick = snap.tick;
                        this._coopDbgSnaps++;
                        this.guestEnemies.pushSnapshot(snap.enemies, performance.now());
                    }
                    this.guestEnemies.interpolate(performance.now() - 100, dt);
                    this.guestEnemies.tickVisuals(dt); // ease HP bars between snapshots
                }
                // DIAGNOSTIC (guest, ~1/s): is anything within the hero's attack
                // reach? Reveals whether "not shooting" is no-target-in-range
                // (enemies converging elsewhere) vs a fire-path bug.
                this._coopDiagAccumS += deltaTime;
                if (this._coopDiagAccumS >= 1) {
                    this._coopDiagAccumS = 0;
                    const hp = this.hero?.getPosition();
                    let nearest = Infinity, alive = 0;
                    for (const e of this.guestEnemies?.getEnemies() ?? []) {
                        if (!e.isAlive()) continue;
                        alive++;
                        const ep = e.getPosition();
                        const d = Math.hypot(ep.x - (hp?.x ?? 0), ep.z - (hp?.z ?? 0));
                        if (d < nearest) nearest = d;
                    }
                    const ghost = snap.heroes.find(h => h.id === 1);
                    console.log(
                        `[coop-diag guest] hero@(${hp?.x.toFixed(1)},${hp?.z.toFixed(1)}) ` +
                        `ghost(host-view)@(${ghost?.x.toFixed(1)},${ghost?.z.toFixed(1)}) ` +
                        `aliveEnemies=${alive} nearest=${nearest === Infinity ? 'none' : nearest.toFixed(1)}u ` +
                        `(ranger range≈9, melee≈3.5)`,
                    );
                }
                // Mirror the host wave state so the guest HUD shows live info. Mutate in
                // place to avoid a per-frame allocation.
                if (this._guestWave) {
                    this._guestWave.wave = snap.wave.n;
                    this._guestWave.enemiesAlive = snap.wave.alive;
                    this._guestWave.inProgress = snap.wave.inProgress === 1;
                } else {
                    this._guestWave = { wave: snap.wave.n, enemiesAlive: snap.wave.alive, inProgress: snap.wave.inProgress === 1 };
                }
                // Part C: apply this guest hero's authoritative HP from the snapshot.
                // The guest is hero id=1 in heroes[]. The host computed contact damage
                // for both heroes so the guest does NOT compute it locally.
                // heroController is non-null here (update() guards at the top).
                // M4-12: stream my hero summary to the host (~every 2s) so it can
                // aggregate the run-over result without a death-timing race.
                this._summaryAccumS += deltaTime;
                if (this._summaryAccumS >= 2) {
                    this._summaryAccumS = 0;
                    this.coopSession!.sendRunSummary({ t: 'runSummary', hero: this.buildLocalHeroSummary(1) });
                }

                const guestEntry = snap.heroes.find(h => h.id === 1);
                if (guestEntry && this.heroController) {
                    // M4-11: death / spectate / respawn are driven by the authoritative
                    // ALIVE FLAG (not hp>0). While dead I spectate (inert) and wait; the
                    // run-over transition is the host's authoritative RunOverMsg
                    // (showCoopGameOver), never inferred here. Back up while spectating →
                    // the host revived me on a wave clear.
                    const meAlive = guestEntry.alive;
                    if (!meAlive) {
                        if (!this._spectating) {
                            // Push a fresh final summary the instant we die so the host's
                            // run-over aggregation isn't stale (don't wait for the 2s tick).
                            this.coopSession!.sendRunSummary({ t: 'runSummary', hero: this.buildLocalHeroSummary(1) });
                            this.enterSpectate();
                        }
                    } else if (this._spectating) {
                        this.respawnLocalHero(guestEntry.x, guestEntry.z);
                    }

                    // While alive: apply authoritative HP + reconcile predicted position.
                    if (meAlive) {
                        this.heroController.setHealth(guestEntry.hp);
                        // M6 E2 input-replay reconciliation — ONCE per new snapshot.
                        // Start from the host-authoritative pose, replay every input the
                        // host hasn't applied yet (seq > ackSeq) through the SAME
                        // integration math the local prediction used, then dead-zone/
                        // lerp/snap the rendered position toward that replayed target.
                        // Replaying at the guest's CURRENT effective speed keeps the
                        // replay consistent with its own prediction (residual ≈ 0);
                        // the host integrates at CHAMP_BASE_SPEED, so speed-multiplier
                        // divergence shows as a steady sub-snap gap the lerp absorbs.
                        if (this.hero && snap.tick !== this._lastReconcileTick) {
                            this._lastReconcileTick = snap.tick;
                            this.coopSession!.pruneInputHistory(snap.ackSeq);
                            const predicted = replayInputs(
                                { x: guestEntry.x, z: guestEntry.z },
                                this.coopSession!.getUnackedInputs(snap.ackSeq),
                                this.heroController.getEffectiveMoveSpeed(),
                                Infinity, // infinite map — replay must match the unclamped local sim
                            );
                            const lp = this.hero.getPosition();
                            const gap = Math.hypot(predicted.x - lp.x, predicted.z - lp.z);
                            if (gap > RECONCILE_DEAD_ZONE) {
                                const r = reconcilePosition(
                                    { x: lp.x, z: lp.z },
                                    predicted,
                                    RECONCILE_HARD_SNAP, RECONCILE_LERP,
                                );
                                this.heroController.reconcileNetworkPosition(r.pos.x, r.pos.z);
                            }
                        }
                    }
                }
            }
            _measure('guestApply');
        }

        // Power auto-fire (suspended while spectating — the dead local hero does nothing)
        if (this.powerSlots && !this._spectating) this.powerSlots.update(dt);
        _measure('powers');

        // Element visual decorations on the hero's weapon
        if (this.hero && this.powerSlots) {
            this.hero.updateElementVisuals(this.powerSlots.getActiveElements());
        }
        _measure('elemVis');

        // Manual ultimates (Meteor Strike + Frost Nova) — suspended while spectating.
        if (this.abilityManager && !this._spectating) this.abilityManager.update(dt);
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
            this.hud.setGold(this.playerStats.getGold());
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
                // M5-7: full keyframe every SNAPSHOT_KEYFRAME_TICKS (≈1s) so a joiner /
                // dropped delta resyncs; delta-compress the ticks between.
                const keyframe = !this._lastSentSnapshot
                    || this._snapshotTick % SurvivorsGameplayState.SNAPSHOT_KEYFRAME_TICKS === 0;
                if (keyframe) {
                    this.coopSession.sendEnemySnapshot(snap);
                } else {
                    this.coopSession.sendEnemySnapshotDelta(diffSnapshot(this._lastSentSnapshot!, snap));
                }
                this._lastSentSnapshot = snap;
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
        // Co-op (M4-10): the simulation is SHARED, so a power-choice / replace-slot
        // overlay must never freeze the loop — the host has to keep simulating and
        // streaming snapshots while either player picks, and the guest must keep
        // rendering. The overlay still shows; it just doesn't pause. Single-player
        // keeps its blocking pause.
        if (this.coopSession) return false;
        return !!(
            this.powerChoice?.isOpen() ||
            this.replaceSlotOverlay?.isOpen() ||
            this.shopOverlay?.isOpen() ||
            this.characterProfile?.isOpen()
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
            this.heroController?.heal(this.heroController.getMaxHealth() * 0.05 * ups);
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

        // RunItems attack-speed stacks: the assignment above ERASED the ×2/stack
        // RunItems factor on every level-up (pre-existing bug — RunItems only
        // multiplies the field once, on grant). Re-fold it here so every
        // recompute preserves it.
        ps.basicAttackSpeedMultiplier *=
            Math.pow(ATTACK_SPEED_FACTOR, this.runItems?.getStacks('attackSpeed') ?? 0);

        // Equipment: fold aggregates on top of the level assignments. Order
        // matters — fold AFTER the assignments above, BEFORE the re-push below.
        // This is the ONLY valid foldEquipmentStats call site (a bare re-fold
        // anywhere else would compound every multiplier).
        if (this.equipment) {
            const agg = this.equipment.aggregates();
            foldEquipmentStats(ps, agg, this.equipTracker);
            // Equipment max-HP as a hero-controller delta (mirrors appliedMaxHpBonus):
            const hpDelta = agg.maxHealth - this.equipMaxHpApplied;
            if (hpDelta !== 0 && this.heroController) {
                this.heroController.addMaxHealth(hpDelta);
                if (hpDelta > 0) this.heroController.heal(hpDelta);
                this.equipMaxHpApplied = agg.maxHealth;
            }
            this.itemEffects?.setActiveEffects(agg.effects);
            // Mythic weapon aura: drive off the equipped weapon's rarity (idempotent).
            const weapon = this.equipment.get('weapon');
            const mythicFx = weapon?.def.rarity === 'mythic' ? (weapon.def.mythicFx ?? null) : null;
            this.hero?.setMythicAura(mythicFx);
        }

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
    // Itemization & merchant shop (single-player only)
    // ─────────────────────────────────────────────────────────────────────────

    /** World adapter handed to ItemEffectRuntime. All damage goes through
     *  Enemy.takeDamage with an element so damage numbers colour correctly.
     *  FX colors are lowercase LITERALS (bounded material-cache keys). */
    private buildEffectContext(): EffectContext {
        return {
            heroPos: () => {
                const p = this.hero?.getPosition();
                return p ? { x: p.x, z: p.z } : { x: 0, z: 0 };
            },
            heroHpFraction: () => {
                const hc = this.heroController;
                if (!hc) return 1;
                const { current, max } = hc.getHealth();
                return max > 0 ? current / max : 1;
            },
            enemiesNear: (x, z, radius) => {
                const out: EffectEnemy[] = [];
                const rSq = radius * radius;
                for (const e of this.enemyManager?.getEnemies() ?? []) {
                    if (!e.isAlive()) continue;
                    const p = e.getPosition();
                    const dx = p.x - x, dz = p.z - z;
                    if (dx * dx + dz * dz <= rSq) out.push(e);
                }
                return out;
            },
            damage: (e, amount, element) =>
                (e as Enemy).takeDamage(amount, element as PowerElement),
            stun: (e, seconds) =>
                (e as Enemy).applyStatusEffect(StatusEffect.STUNNED, seconds, 1),
            burn: (e, seconds, strength) =>
                (e as Enemy).applyStatusEffect(StatusEffect.BURNING, seconds, strength),
            addGold: (amount) => this.playerStats?.addGold(amount),
            refundCooldownPct: (fraction) => {
                for (const slot of this.powerSlots?.getSlots() ?? []) {
                    if (slot) slot.state.cooldownRemaining *= 1 - fraction;
                }
            },
            recastFree: () => { this.powerSlots?.recastFree(); },
            wave: () => this.waveManager?.getCurrentWave() ?? 1,
            rng: Math.random,
            critChance: () => this.playerStats?.critChance ?? 0,
            tryExecuteBelow: (e, fraction) => {
                const en = e as Enemy;
                const hp = en.getHealth(); const max = en.getMaxHealth();
                if (max <= 0 || hp <= 0) return false;
                if (hp / max <= fraction) {
                    en.takeDamage(hp, 'physical' as PowerElement); // exactly lethal → normal death path
                    return true;
                }
                return false;
            },
            fx: {
                rageGlow: (on) => this.rageGlow?.setActive(on),
                coinNova: (x, z) => { if (this.scene) spawnExpandingRing(this.scene, x, z, '#ffd84a', 6); },
                shockwave: (x, z, radius) => { if (this.scene) spawnExpandingRing(this.scene, x, z, '#e0e0e0', radius); },
                ricochet: (fx, fz, tx, tz) => { if (this.scene) spawnTrail(this.scene, fx, fz, tx, tz, '#60ff90'); },
                echoShimmer: () => {
                    const p = this.hero?.getPosition();
                    if (p && this.scene) spawnExpandingRing(this.scene, p.x, p.z, '#b050ff', 3, 0.3);
                },
                ring: (x, z, colorHex, radius) => { if (this.scene) spawnExpandingRing(this.scene, x, z, colorHex, radius); },
                beam: (x0, z0, x1, z1, colorHex) => { if (this.scene) spawnTrail(this.scene, x0, z0, x1, z1, colorHex); },
            },
        };
    }

    private openShop(): void {
        if (!this.equipment || !this.shopOverlay || !this.playerStats) return;
        if (this.currentStock.length === 0) this.rollShopStock();
        this.shopOverlay.show(this.buildShopVM(pickBark('arrive')), {
            onBuy: (index) => this.handleShopBuy(index),
            onReroll: () => this.handleShopReroll(),
            onBattle: () => { this.shopOverlay?.close(); this.endShoppingPhase(); },
            onClosed: () => { /* modal torn down — game unpauses; nothing else to do */ },
        }, this.goblinPortrait?.element ?? null);
        this.goblinPortrait?.start();
    }

    private rollShopStock(): void {
        if (!this.equipment) return;
        const agg = this.equipment.aggregates();
        this.currentStock = rollStock(ITEM_CATALOG, {
            champion: this.currentChampionType,
            wave: this.waveManager?.getCurrentWave() ?? 1,
            ownedIds: this.equipment.ownedIds(),
            setCounts: agg.setCounts,
            rng: Math.random,
        });
        this.purchasedIds.clear(); // fresh stock → fixed positions reset
    }

    /** Unique-effect / set-bonus text for an item: standalone items show their
     *  effect, set pieces show the set's 3pc signature (set pieces have no effectId). */
    private itemEffectText(def: ItemDef): string | null {
        // Mythic / standalone-effect items show their own effect text.
        if (def.effectId && (def.rarity === 'mythic' || !def.setId)) return EFFECT_TEXT[def.effectId];
        // Set pieces show the set's highest (signature) tier text.
        if (def.setId) {
            const set = setById(def.setId);
            if (set && set.tiers.length > 0) return set.tiers[set.tiers.length - 1].text;
        }
        return null;
    }

    private buildShopVM(quip: string): ShopVM {
        const eq = this.equipment!;
        const ps = this.playerStats!;
        const wave = this.waveManager?.getCurrentWave() ?? 1;
        const cards: ShopCardVM[] = this.currentStock.map(def => {
            const price = priceFor(def, wave);
            const old = eq.get(def.slot);
            const credit = old ? sellValueOf(old.pricePaid) : 0;
            return {
                def, price,
                sold: this.purchasedIds.has(def.id),
                affordable: ps.getGold() + credit >= price,
                replaces: old?.def.name ?? null,
                sellCredit: credit,
                setProgress: def.setId
                    ? `${setById(def.setId)!.name} ${eq.setCount(def.setId)}/${setById(def.setId)!.pieces.length}`
                    : null,
                statLines: describeMods(def.mods),
                effectText: this.itemEffectText(def),
                // Comparison: what's equipped in this slot right now.
                equippedStatLines: old ? describeMods(old.def.mods) : [],
                equippedEffectText: old ? this.itemEffectText(old.def) : null,
            };
        });
        return {
            gold: ps.getGold(),
            cards,
            rerollCost: rerollCost(this.rerollsThisVisit),
            rerollAffordable: ps.getGold() >= rerollCost(this.rerollsThisVisit),
            quip,
        };
    }

    private handleShopBuy(index: number): void {
        const def = this.currentStock[index];
        if (!def || !this.equipment || !this.playerStats) return;
        if (this.purchasedIds.has(def.id)) return; // already bought this visit
        const wave = this.waveManager?.getCurrentWave() ?? 1;
        if (!this.equipment.buy(def, wave)) {
            this.shopOverlay?.refresh(this.buildShopVM(pickBark('poor')));
            return;
        }
        this.purchasedIds.add(def.id); // keep the tile in place as "Sold"
        this.applyLevelBonuses();      // recompute: level + equipment fold + active effects
        this.updateInventoryHud();
        this.shopOverlay?.refresh(this.buildShopVM(pickBark('buy')));
    }

    // ── Character sheet + HUD inventory strip (single-player) ────────────────

    /** The 6 equipped slots as display VMs — shared by the HUD strip + profile. */
    private buildGearSlots(): GearSlotVM[] {
        const eq = this.equipment;
        return EQUIP_SLOTS.map(slot => {
            const item = eq?.get(slot) ?? null;
            return {
                slot,
                name: item?.def.name ?? null,
                glyph: item?.def.glyph ?? null,
                rarity: item?.def.rarity ?? null,
                statLines: item ? describeMods(item.def.mods) : [],
                effectText: item ? this.itemEffectText(item.def) : null,
            };
        });
    }

    /** Push the current equipment into the always-visible HUD strip (solo only). */
    private updateInventoryHud(): void {
        if (!this.equipment) return;
        this.hud?.setInventory(this.buildGearSlots());
    }

    /** Aggregate stats for the character sheet, read live from PlayerStats. */
    private buildCharacterStats(): CharStatVM[] {
        const ps = this.playerStats;
        if (!ps) return [];
        const pct = (m: number) => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;
        const out: CharStatVM[] = [
            { label: 'Max Health', value: `${Math.round(this.heroController?.getHealth().max ?? ps.getMaxHealth())}` },
            { label: 'Basic Damage', value: pct(ps.basicDamageMultiplier) },
            { label: 'Power Damage', value: pct(ps.powerDamageMultiplier) },
            { label: 'Attack Speed', value: pct(ps.basicAttackSpeedMultiplier) },
            { label: 'Power Cooldown', value: `${Math.round((ps.powerCooldownMultiplier - 1) * 100)}%` },
            { label: 'Move Speed', value: pct(ps.moveSpeedMultiplier) },
            { label: 'Crit Chance', value: `${Math.round(ps.critChance * 100)}%` },
            { label: 'Crit Damage', value: `×${ps.critDamageMultiplier.toFixed(2)}` },
        ];
        const dr = Math.round((1 - ps.damageReductionMultiplier) * 100);
        if (dr !== 0) out.push({ label: 'Damage Reduction', value: `${dr}%` });
        if (ps.lifestealPct > 0) out.push({ label: 'Lifesteal', value: `${Math.round(ps.lifestealPct * 100)}%` });
        if (ps.goldGainMultiplier > 1) out.push({ label: 'Gold Find', value: pct(ps.goldGainMultiplier) });
        if (ps.hpRegenPctPerSec > 0) out.push({ label: 'HP Regen', value: `${(ps.hpRegenPctPerSec * 100).toFixed(1)}%/s` });
        return out;
    }

    /** Sets with ≥2 pieces (an active bonus) for the character sheet. */
    private buildCharacterSets(): CharSetVM[] {
        const counts = this.equipment?.aggregates().setCounts ?? {};
        const out: CharSetVM[] = [];
        for (const set of ITEM_SETS) {
            const count = counts[set.id] ?? 0;
            if (count < 2) continue;
            out.push({
                name: set.name, count, total: set.pieces.length,
                tiers: set.tiers.map(t => ({ pieces: t.pieces, text: t.text, active: count >= t.pieces })),
            });
        }
        return out;
    }

    private buildCharacterVM(): CharacterVM {
        return {
            slots: this.buildGearSlots(),
            stats: this.buildCharacterStats(),
            sets: this.buildCharacterSets(),
        };
    }

    /** Toggle the character sheet from the HUD inventory strip (pauses solo). */
    private openCharacter(): void {
        if (!this.characterProfile || !this.equipment) return;
        if (this.characterProfile.isOpen()) { this.characterProfile.close(); return; }
        this.characterProfile.show(this.buildCharacterVM());
    }

    private handleShopReroll(): void {
        const cost = rerollCost(this.rerollsThisVisit);
        if (!this.playerStats?.spendGold(cost)) {
            this.shopOverlay?.refresh(this.buildShopVM(pickBark('poor')));
            return;
        }
        this.rerollsThisVisit++;
        this.rollShopStock();
        this.shopOverlay?.refresh(this.buildShopVM(pickBark('reroll')));
    }

    /** "To battle!" pressed: stop the goblin portrait, short countdown, next wave. */
    private endShoppingPhase(): void {
        if (this.shopPhase === 'none') return;
        this.shopPhase = 'none';
        this.goblinPortrait?.stop();
        this.hud?.setHornVisible(false);
        this.waveBreatherRemaining = 3;
    }

    private soundHorn(): void {
        if (this.shopOverlay?.isOpen()) this.shopOverlay.close();
        this.endShoppingPhase();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The enemy list the local hero's attacks should target. Host/single-player
     * read the authoritative EnemyManager; the co-op guest reads its render-only
     * GuestEnemies registry (the host's EnemyManager is empty on the guest).
     *
     * Evaluated per call so the role is always current. This is what lets
     * startRun wire the attack providers ONCE, synchronously, even though the
     * co-op connection (which sets coopSession.role) resolves asynchronously
     * later — without it, startRun's setTargetProvider/setEnemyProvider would
     * race with (and clobber) the guest wiring, leaving the guest unable to
     * acquire a target (tgt=N) and never firing.
     */
    private activeAttackEnemies(): Enemy[] {
        if (this.coopSession?.role === 'guest') {
            return this.guestEnemies?.getEnemies() ?? [];
        }
        return this.enemyManager?.getEnemies() ?? [];
    }

    private getNearestEnemy(): BasicAttackTarget | null {
        if (!this.hero) return null;
        const heroPos = this.hero.getPosition();
        let best: Enemy | null = null;
        let bestDistSq = Infinity;
        for (const e of this.activeAttackEnemies()) {
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

    /** Late-wave dynamic quality trim (one-way ratchet per run): if the FPS EMA
     *  sagged below ~42 during the cleared wave, step render quality down —
     *  level 1 reduces post-fx (bloom kernel/weight + glow), level 2 also renders
     *  the directional shadow map every 3rd frame. Checked at wave clear so the
     *  (cheap) adjustments land during the breather, not mid-combat. Reset in
     *  exit() via game.setPostFxReduced(false). */
    private maybeTrimPerformance(clearedWave: number): void {
        if (this._fpsEma >= 42 || this._perfTrimLevel >= 2) return;
        this._perfTrimLevel++;
        if (this._perfTrimLevel === 1) {
            this.game.setPostFxReduced(true);
            console.info(`[perf-trim] wave ${clearedWave} cleared at ≈${Math.round(this._fpsEma)} fps → reduced post-fx (level 1)`);
        } else {
            const map = this.shadowGenerator?.getShadowMap();
            if (map) map.refreshRate = 3;
            console.info(`[perf-trim] wave ${clearedWave} cleared at ≈${Math.round(this._fpsEma)} fps → shadow map every 3rd frame (level 2)`);
        }
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
            // A dead/spectating hero registers no contact — otherwise enemies pile on
            // the downed body (the co-op "immortal tank"). takeDamage already no-ops
            // while dead, but skipping here also stops the hit-reaction/threat on a corpse.
            if (!this.heroController.isDeadOrSpectating()) {
                const ldx = ePos.x - heroPos.x;
                const ldz = ePos.z - heroPos.z;
                if (ldx * ldx + ldz * ldz < sumRSq) {
                    this.heroController.takeDamage(e.contactDamagePerSecond * deltaTime * reductionMult, ePos);
                }
            }

            // ── Guest hero contact (host only) ───────────────────────────────────
            // Apply contact damage against the ghost position; track HP here;
            // the authoritative value ships to the guest in every snapshot.
            // Test mode (?test) makes the guest invulnerable too — the host owns
            // the guest's HP, so this is the guest-side mirror of the local hero's
            // debugInvulnerable flag (set above when testMode is on).
            if (ghostPos && this.guestHeroAlive && !this.testMode) {
                const gdx = ePos.x - ghostPos.x;
                const gdz = ePos.z - ghostPos.z;
                if (gdx * gdx + gdz * gdz < sumRSq) {
                    // No reduction mult here — reductionMult is the HOST's, which doesn't
                    // apply to the guest (the host doesn't know the guest's reduction). Use
                    // the raw contact DPS rather than the wrong player's modifier.
                    const dmg = e.contactDamagePerSecond * deltaTime;
                    this.guestHeroHp = Math.max(0, this.guestHeroHp - dmg);
                    if (this.guestHeroHp <= 0 && this.guestHeroAlive) {
                        this.guestHeroAlive = false;
                        // Play the guest ghost's death animation + fade it (mirrors the
                        // local-hero spectate fade). The ghost is a full Champion, so it
                        // crumples on the host's screen too.
                        (this.coopGhost as unknown as { triggerDeath?: () => void } | null)?.triggerDeath?.();
                        const gm = (this.coopGhost as unknown as { mesh?: { visibility: number } } | null)?.mesh;
                        if (gm) gm.visibility = 0.6;
                        // M4-11: the guest just died. If the host is also down, both are
                        // dead → end the run; otherwise the guest spectates (it sees its
                        // alive flag flip in the snapshot) and the host plays on.
                        if (this.heroController?.isDeadOrSpectating()) this.buildAndSendRunSummary();
                    }
                }
            }
        }
    }
}
