import { Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight } from '@babylonjs/core';
import { AdvancedDynamicTexture } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { Champion } from '../gameplay/Champion';
import { HeroController } from '../gameplay/HeroController';
import { SurvivorsJoystick } from '../ui/SurvivorsJoystick';
import { EnemyManager } from '../gameplay/EnemyManager';
import { WaveManager } from '../gameplay/WaveManager';
import { PlayerStats } from '../gameplay/PlayerStats';
import { PowerDrop } from '../gameplay/PowerDrop';
import { PowerSlotManager } from '../gameplay/PowerSlotManager';
import { POWER_DEFS, getPowerByElementAndClass, getPowerMapForClass, PowerElement, ChampionType } from '../gameplay/powers/PowerDefinitions';
import { Enemy } from '../gameplay/enemies/Enemy';
import { BasicAttackTarget } from '../gameplay/HeroBasicAttack';
import { PowerChoiceOverlay, PowerCard } from '../ui/PowerChoiceOverlay';
import { ReplaceSlotOverlay } from '../ui/ReplaceSlotOverlay';
import { BetweenWaveShopOverlay, ShopItem } from '../ui/BetweenWaveShopOverlay';
import { HeroHud } from '../ui/HeroHud';
import { EliteIndicators } from '../ui/EliteIndicators';
import { ChampionSelectOverlay, ChampionOption } from '../ui/ChampionSelectOverlay';
import { GameOverState, SurvivorsRunSummary } from './GameOverState';
import { AbilityManager } from '../gameplay/AbilityManager';
import { DamageNumberManager } from '../gameplay/DamageNumberManager';
import { RunItems, ItemId } from '../gameplay/RunItems';
import { ItemDrop } from '../gameplay/ItemDrop';

/** Float-text labels and colors for item pickups (mirror the HUD slot colors). */
const ITEM_DISPLAY_NAMES: Record<ItemId, string> = {
    lifesteal: 'Lifesteal',
    multishotCleave: 'Multishot',
    knockback: 'Knockback',
    attackSpeed: 'Attack Speed',
};
const ITEM_FLOAT_COLOR: Record<ItemId, string> = {
    lifesteal: '#ff2a40',
    multishotCleave: '#ffd84a',
    knockback: '#4ea7ff',
    attackSpeed: '#fff080',
};

export class SurvivorsGameplayState implements GameState {
    private game: Game;
    private scene: Scene | null = null;
    private ui: AdvancedDynamicTexture | null = null;
    private map: Map | null = null;
    private hero: Champion | null = null;
    private heroController: HeroController | null = null;
    private joystick: SurvivorsJoystick | null = null;

    // Gameplay systems
    private enemyManager: EnemyManager | null = null;
    private waveManager: WaveManager | null = null;
    private playerStats: PlayerStats | null = null;
    private powerSlots: PowerSlotManager | null = null;
    private abilityManager: AbilityManager | null = null;

    // Power drops
    private powerDrops: PowerDrop[] = [];

    // Item drops (from milestone bosses)
    private runItems: RunItems | null = null;
    private itemDrops: ItemDrop[] = [];

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

    // Run tracking for game-over summary
    private runStartTime: number = 0;
    private currentChampionType: ChampionType = 'mage';

    // Floating damage / reward text
    private damageNumbers: DamageNumberManager | null = null;
    private damageHandler: ((e: Event) => void) | null = null;
    private rewardHandler: ((e: Event) => void) | null = null;

    // UI modules
    private hud: HeroHud | null = null;
    private powerChoice: PowerChoiceOverlay | null = null;
    private replaceSlotOverlay: ReplaceSlotOverlay | null = null;
    private shopOverlay: BetweenWaveShopOverlay | null = null;
    private eliteIndicators: EliteIndicators | null = null;
    private championSelect: ChampionSelectOverlay | null = null;
    private shopItems: ShopItem[] = [];

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        this.game.cleanupScene();
        this.scene = this.game.getScene();
        this.scene.clearColor = new Color4(0.03, 0.04, 0.07, 1);

        // Ambient fill — keep low so the directional light gives form
        const ambientLight = new HemisphericLight('survivorsAmbient', new Vector3(0, 1, 0), this.scene);
        ambientLight.intensity = 0.3;
        ambientLight.diffuse = new Color3(0.55, 0.65, 0.85);   // cool blue fill from above
        ambientLight.groundColor = new Color3(0.15, 0.12, 0.10); // dim warm bounce from below

        // Key light — warm directional from upper-left-front for form/shadow falloff
        const keyLight = new DirectionalLight('survivorsKey', new Vector3(-0.4, -1, -0.6), this.scene);
        keyLight.intensity = 0.7;
        keyLight.diffuse = new Color3(1.0, 0.85, 0.7);

        // Build base scene resources first
        this.map = new Map(this.game);
        this.map.buildSurvivorsArena(25);

        // Create UI layer
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('survivorsUI', true, this.scene);
        this.ui.idealWidth = 800; // cap GUI rasterization — matches MenuState and GameOverState

        // Show champion select; actual run starts when player picks
        this.championSelect = new ChampionSelectOverlay(this.ui);
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
                startingPower: 'Fire Arrow',
                color: '#60C080',
            },
            {
                type: 'mage',
                name: 'Mage',
                summary: 'HP: 80  Speed: 7  Attack: 10 ranged\nElement orbs unlock spells. Fragile but devastating.',
                startingPower: 'Arcane Nova',
                color: '#6080C0',
            },
        ];
        this.championSelect.show(championOptions, (type) => this.startRun(type));
    }

    /** Initialize all gameplay systems and begin the run. Called once champion is chosen. */
    private startRun(championType: string): void {
        if (!this.scene || !this.ui || !this.map) return;

        this.runStartTime = performance.now();
        this.currentChampionType = (championType as ChampionType) ?? 'mage';

        // Stat variants by champion type
        const variants: Record<string, { hp: number; speed: number; startPower?: string }> = {
            barbarian: { hp: 140, speed: 6  },
            ranger:    { hp: 90,  speed: 9,  startPower: 'ranger_fire' },
            mage:      { hp: 80,  speed: 7,  startPower: 'mage_arcane' },
        };
        const variant = variants[championType] ?? variants['barbarian'];

        // Spawn hero — Champion in player-controlled mode
        this.hero = new Champion(this.game, [], null, championType as 'barbarian' | 'ranger' | 'mage');
        this.hero.controlMode = 'player';

        this.heroController = new HeroController(
            this.scene,
            this.hero,
            this.map.getArenaRadius(),
            variant.speed,
            variant.hp,
            championType,
        );

        this.heroController.setOnDeath(() => {
            this.buildAndSendRunSummary();
        });

        // ---------- Gameplay systems ----------

        this.playerStats = new PlayerStats(variant.hp, 100);

        this.enemyManager = new EnemyManager(this.game, this.map);
        this.enemyManager.setPlayerStats(this.playerStats);
        this.enemyManager.configureSurvivorsMode(
            { getPosition: () => this.hero!.getPosition() },
            this.map.getArenaRadius(),
        );

        // Pre-warm all enemy types so the first spawn of each doesn't hitch
        // the frame with shader compilation and GPU buffer uploads.
        this.enemyManager.prewarmEnemyTypes();

        // Damage / reward floating text manager
        this.damageNumbers = new DamageNumberManager(this.game);
        this.damageHandler = (e: Event) => {
            const d = (e as CustomEvent).detail;
            this.damageNumbers?.showDamage(d.position, d.damage);
        };
        this.rewardHandler = (e: Event) => {
            const d = (e as CustomEvent).detail;
            this.damageNumbers?.showReward(d.position, d.reward);
        };
        document.addEventListener('enemyDamage', this.damageHandler);
        document.addEventListener('enemyReward', this.rewardHandler);

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

        // Wire enemy provider and power slots into HeroController for melee AOE + enchantments
        this.heroController.setEnemyProvider(() => this.enemyManager!.getEnemies());
        this.heroController.setPowerSlots(this.powerSlots);

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
        this.waveManager.setSurvivorsRates(2.2, 1.6);

        // Survivors-mode: manual wave start after the shop
        this.waveManager.setOnWaveCleared(() => {
            this.openShop();
        });

        // Override spawn fn: spawn enemies at arena perimeter
        this.waveManager.setSpawnFn((type, eliteElement) => {
            this.enemyManager!.spawnSurvivorsEnemy(type, eliteElement);
        });

        // Wire basic-attack target provider to nearest alive enemy
        this.heroController.setTargetProvider(() => this.getNearestEnemy());

        // Ability manager — configure for chosen champion class
        this.abilityManager = new AbilityManager(this.game, this.enemyManager);
        this.abilityManager.configureForClass(this.currentChampionType);
        this.abilityManager.setHeroProvider(() => this.hero!.getPosition());
        this.abilityManager.setHero(this.hero);
        this.abilityManager.prewarmAbilityEffects();

        // ---------- UI ----------

        // Mobile virtual joystick
        this.joystick = new SurvivorsJoystick(this.ui);
        this.joystick.onDirection((dx, dz) => {
            if (this.heroController) this.heroController.setExternalInput(dx, dz);
        });

        // HUD (HP bar, gold, power slots, ultimate buttons)
        // Built AFTER configureForClass so HUD reads the correct ability IDs.
        this.hud = new HeroHud(this.ui, this.abilityManager, this.game);

        if (this.runItems) {
            this.hud.setRunItems(this.runItems);
        }

        // Overlays
        this.powerChoice     = new PowerChoiceOverlay(this.ui);
        this.replaceSlotOverlay = new ReplaceSlotOverlay(this.ui);
        this.shopOverlay     = new BetweenWaveShopOverlay(this.ui);

        // Define shop items (applied directly via playerStats + heroController)
        this.shopItems = this.buildShopItems();

        // Off-screen elite indicators
        this.eliteIndicators = new EliteIndicators(
            this.ui,
            this.scene,
            this.heroController.getCamera(),
            () => this.enemyManager?.getEnemies() ?? [],
        );
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

    /** Gather end-of-run stats and transition to game-over. */
    private buildAndSendRunSummary(): void {
        const timeSurvivedSec = (performance.now() - this.runStartTime) / 1000;
        const waveReached = this.waveManager?.getCurrentWave() ?? 0;
        const kills = this.playerStats?.getTotalKills() ?? 0;
        const goldCollected = this.playerStats?.getTotalMoneyEarned() ?? 0;

        const finalLoadout = (this.powerSlots?.getSlots() ?? [])
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .map(s => ({ name: s.def.name, level: s.state.level, icon: s.def.icon }));

        const summary: SurvivorsRunSummary = {
            waveReached,
            timeSurvivedSec,
            kills,
            goldCollected,
            finalLoadout,
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

        this.championSelect?.close();
        this.championSelect = null;

        this.eliteIndicators?.dispose();
        this.eliteIndicators = null;

        this.powerSlots?.dispose();
        this.powerSlots = null;

        this.abilityManager = null;

        this.shopOverlay?.close();
        this.shopOverlay = null;

        this.replaceSlotOverlay?.close();
        this.replaceSlotOverlay = null;

        this.powerChoice?.close();
        this.powerChoice = null;

        if (this.damageHandler) {
            document.removeEventListener('enemyDamage', this.damageHandler);
            this.damageHandler = null;
        }
        if (this.rewardHandler) {
            document.removeEventListener('enemyReward', this.rewardHandler);
            this.rewardHandler = null;
        }
        this.damageNumbers?.dispose();
        this.damageNumbers = null;

        this.hud?.dispose();
        this.hud = null;

        this.waveManager?.dispose();
        this.waveManager = null;

        this.enemyManager?.dispose();
        this.enemyManager = null;

        this.playerStats = null;

        this.joystick?.dispose();
        this.joystick = null;

        this.heroController?.dispose();
        this.heroController = null;

        this.hero?.dispose();
        this.hero = null;

        this.ui?.dispose();
        this.ui = null;

        this.map?.dispose();
        this.map = null;

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

        this.heroController.update(dt);
        if (this.hero) this.hero.update(dt);

        if (this.waveManager) this.waveManager.update(dt);
        if (this.enemyManager) this.enemyManager.update(dt);

        // Contact damage
        this.applyContactDamage(dt);

        // Power auto-fire
        if (this.powerSlots) this.powerSlots.update(dt);

        // Element visual decorations on the hero's weapon
        if (this.hero && this.powerSlots) {
            this.hero.updateElementVisuals(this.powerSlots.getActiveElements());
        }

        // Manual ultimates (Meteor Strike + Frost Nova)
        if (this.abilityManager) this.abilityManager.update(dt);

        // Power drops (magnet + pickup)
        for (const d of this.powerDrops) d.update(dt);
        this.powerDrops = this.powerDrops.filter(d => d.isAlive());

        // Item drops (milestone boss rewards)
        for (const d of this.itemDrops) d.update(dt);
        this.itemDrops = this.itemDrops.filter(d => d.isAlive());

        this.damageNumbers?.update(dt);

        // HUD update
        if (this.hud && this.powerSlots && this.playerStats) {
            const waveInfo = this.waveManager
                ? {
                    wave: this.waveManager.getCurrentWave(),
                    enemiesAlive: this.waveManager?.getRemainingEnemiesInWave() ?? 0,
                    inProgress: this.waveManager.isWaveInProgress(),
                  }
                : undefined;
            this.hud.update(
                this.heroController.getHealth(),
                this.playerStats.getGold(),
                this.powerSlots.getSlots(),
                dt,
                waveInfo,
            );
        }

        // Off-screen elite indicators
        if (this.eliteIndicators) this.eliteIndicators.update();
    }

    private isPausedForOverlay(): boolean {
        return !!(
            this.powerChoice?.isOpen() ||
            this.replaceSlotOverlay?.isOpen() ||
            this.shopOverlay?.isOpen()
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orb pickup → Power Choice overlay
    // ─────────────────────────────────────────────────────────────────────────

    private onOrbPickup(element: string): void {
        if (!this.powerSlots || !this.powerChoice || !this.playerStats) return;

        // Don't open if another overlay is already up
        if (this.powerChoice.isOpen() || this.replaceSlotOverlay?.isOpen()) return;

        const orbDef = getPowerByElementAndClass(element as PowerElement, this.currentChampionType) ?? Object.values(POWER_DEFS)[0];
        const cards: PowerCard[] = [];

        // Card A: the orb's power
        const owned     = this.powerSlots.hasPower(orbDef.id);
        const slotData  = this.powerSlots.getSlots().find(s => s?.def.id === orbDef.id);
        const slotsFull = this.powerSlots.emptySlotIndex() < 0;

        cards.push({
            kind:     'power',
            title:    orbDef.name,
            subtitle: owned
                ? `Lv ${slotData!.state.level} → ${slotData!.state.level + 1}`
                : slotsFull ? 'New (Replace slot)' : 'New',
            onPick: () => {
                if (owned) {
                    this.powerSlots!.levelUp(orbDef.id);
                } else if (slotsFull) {
                    // Open replace-slot secondary prompt (after choice overlay closes)
                    this.openReplacePrompt(orbDef.id);
                } else {
                    this.powerSlots!.addPower(orbDef.id);
                }
            },
        });

        // Card B: wildcard — random upgrade of another owned power, or another new power
        const ownedSlots = this.powerSlots
            .getSlots()
            .filter((s): s is NonNullable<typeof s> => s !== null && s.def.id !== orbDef.id);

        if (ownedSlots.length > 0) {
            const target = ownedSlots[Math.floor(Math.random() * ownedSlots.length)];
            cards.push({
                kind:     'wildcard',
                title:    target.def.name,
                subtitle: `Lv ${target.state.level} → ${target.state.level + 1}`,
                onPick: () => this.powerSlots!.levelUp(target.def.id),
            });
        } else {
            // Offer a random class-specific power the player doesn't already own
            const classMap = getPowerMapForClass(this.currentChampionType);
            const classPowerIds = Object.values(classMap).filter(id => id !== orbDef.id && !this.powerSlots!.hasPower(id));
            const altId = classPowerIds.length > 0
                ? classPowerIds[Math.floor(Math.random() * classPowerIds.length)]
                : Object.values(classMap).filter(id => id !== orbDef.id)[0];
            const altDef = POWER_DEFS[altId];
            cards.push({
                kind:     'wildcard',
                title:    altDef.name,
                subtitle: 'New',
                onPick: () => this.powerSlots!.addPower(altDef.id),
            });
        }

        // Card C: run perk
        const perks = [
            {
                title: '+5% Damage',
                apply: () => { this.runPerks.damageMultiplier *= 1.05; },
            },
            {
                title: '+5% Move Speed',
                apply: () => {
                    this.runPerks.moveSpeedMultiplier *= 1.05;
                    // Apply immediately to hero controller
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
        cards.push({
            kind:     'perk',
            title:    perk.title,
            subtitle: 'This run',
            onPick:   perk.apply,
        });

        // Pause game while overlay is open (handled by isPausedForOverlay in update)
        this.powerChoice.show(
            cards,
            () => this.playerStats!.addGold(25), // cancel → +25 gold
            () => {},                            // onClosed → nothing (pause auto-lifts)
        );
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
    // Between-wave shop
    // ─────────────────────────────────────────────────────────────────────────

    private openShop(): void {
        if (!this.shopOverlay || !this.playerStats) return;
        this.shopOverlay.show(
            this.shopItems,
            () => this.playerStats!.getGold(),
            (id) => this.playerStats!.getPurchaseCount(id),
            (amount) => this.playerStats!.spendGold(amount),
            () => {
                // Player pressed "Start Next Wave"
                this.waveManager?.startNextWave();
            },
        );
    }

    private buildShopItems(): ShopItem[] {
        return [
            {
                id:          'vitality',
                name:        'Vitality',
                description: '+20 max HP, heal +20',
                baseCost:    30,
                costGrowth:  1.5,
                isCapped:    () => false,
                apply: () => {
                    this.playerStats!.incrementPurchase('vitality');
                    this.playerStats!.bonusMaxHealth += 20;
                    this.heroController!.addMaxHealth(20);
                    this.heroController!.heal(20);
                },
            },
            {
                id:          'swiftness',
                name:        'Swiftness',
                description: '+10% move speed',
                baseCost:    40,
                costGrowth:  1.6,
                isCapped:    () => false,
                apply: () => {
                    this.playerStats!.incrementPurchase('swiftness');
                    this.playerStats!.moveSpeedMultiplier *= 1.10;
                    this.heroController!.updateMoveSpeed(
                        this.playerStats!.moveSpeedMultiplier * this.runPerks.moveSpeedMultiplier,
                    );
                },
            },
            {
                id:          'reach',
                name:        'Reach',
                description: '+10% basic attack range',
                baseCost:    35,
                costGrowth:  1.55,
                isCapped:    () => false,
                apply: () => {
                    this.playerStats!.incrementPurchase('reach');
                    this.playerStats!.attackRangeMultiplier *= 1.10;
                    this.heroController!.updateBasicAttackRange(
                        this.playerStats!.attackRangeMultiplier * this.runPerks.attackRangeMultiplier,
                    );
                },
            },
            {
                id:          'power',
                name:        'Power',
                description: '+10% all power damage',
                baseCost:    50,
                costGrowth:  1.7,
                isCapped:    () => false,
                apply: () => {
                    this.playerStats!.incrementPurchase('power');
                    this.playerStats!.powerDamageMultiplier *= 1.10;
                },
            },
            {
                id:          'haste',
                name:        'Haste',
                description: '-5% all power cooldowns',
                baseCost:    60,
                costGrowth:  1.7,
                isCapped:    (count) => this.playerStats!.powerCooldownMultiplier <= 0.5,
                apply: () => {
                    this.playerStats!.incrementPurchase('haste');
                    this.playerStats!.powerCooldownMultiplier = Math.max(
                        0.5,
                        this.playerStats!.powerCooldownMultiplier * 0.95,
                    );
                },
            },
            {
                id:          'bulwark',
                name:        'Bulwark',
                description: '-5% contact damage taken',
                baseCost:    45,
                costGrowth:  1.5,
                isCapped:    () => this.playerStats!.damageReductionMultiplier <= 0.2,
                apply: () => {
                    this.playerStats!.incrementPurchase('bulwark');
                    this.playerStats!.damageReductionMultiplier = Math.max(
                        0.2,
                        this.playerStats!.damageReductionMultiplier * 0.95,
                    );
                },
            },
            {
                id:          'quickness',
                name:        'Quickness',
                description: '+10% basic attack speed',
                baseCost:    45,
                costGrowth:  1.6,
                isCapped:    () => false,
                apply: () => {
                    this.playerStats!.incrementPurchase('quickness');
                    this.playerStats!.basicAttackSpeedMultiplier *= 1.10;
                    this.heroController!.updateBasicAttackSpeed(this.playerStats!.basicAttackSpeedMultiplier);
                },
            },
        ];
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
            takeDamage: (n) => captured.takeDamage(n),
            isAlive:    () => captured.isAlive(),
        };
    }

    private applyContactDamage(deltaTime: number): void {
        if (!this.hero || !this.enemyManager || !this.heroController) return;
        const heroPos = this.hero.getPosition();
        const reductionMult = this.playerStats?.damageReductionMultiplier ?? 1.0;
        for (const e of this.enemyManager.getEnemies()) {
            // Hero death inside takeDamage triggers state.exit() synchronously,
            // which nulls heroController. Re-check each iteration.
            if (!this.heroController) return;
            if (!e.isAlive()) continue;
            const ePos = e.getPosition();
            const dx = ePos.x - heroPos.x;
            const dz = ePos.z - heroPos.z;
            const distSq = dx * dx + dz * dz;
            const sumR = this.heroRadius + 0.6;
            if (distSq < sumR * sumR) {
                this.heroController.takeDamage(e.contactDamagePerSecond * deltaTime * reductionMult, ePos);
            }
        }
    }
}
