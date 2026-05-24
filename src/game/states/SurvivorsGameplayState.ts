import { Scene, Vector3, Color4, HemisphericLight } from '@babylonjs/core';
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
import { POWER_DEFS, getPowerByElement, PowerElement } from '../gameplay/powers/PowerDefinitions';
import { Enemy } from '../gameplay/enemies/Enemy';
import { BasicAttackTarget } from '../gameplay/HeroBasicAttack';
import { PowerChoiceOverlay, PowerCard } from '../ui/PowerChoiceOverlay';
import { ReplaceSlotOverlay } from '../ui/ReplaceSlotOverlay';
import { BetweenWaveShopOverlay, ShopItem } from '../ui/BetweenWaveShopOverlay';
import { HeroHud } from '../ui/HeroHud';
import { EliteIndicators } from '../ui/EliteIndicators';

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

    // Power drops
    private powerDrops: PowerDrop[] = [];

    // Contact damage radius (hero bounding circle)
    private readonly heroRadius: number = 0.6;

    // Time scale (0.2 during power-choice overlay, 1.0 otherwise)
    private timeScale: number = 1.0;

    // Run perks accumulated from orb-choice Card C
    private runPerks = {
        damageMultiplier: 1.0,
        moveSpeedMultiplier: 1.0,
        pickupRadiusMultiplier: 1.0,
    };

    // UI modules
    private hud: HeroHud | null = null;
    private powerChoice: PowerChoiceOverlay | null = null;
    private replaceSlotOverlay: ReplaceSlotOverlay | null = null;
    private shopOverlay: BetweenWaveShopOverlay | null = null;
    private eliteIndicators: EliteIndicators | null = null;
    private shopItems: ShopItem[] = [];

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        this.game.cleanupScene();
        this.scene = this.game.getScene();
        this.scene.clearColor = new Color4(0.05, 0.05, 0.08, 1);

        new HemisphericLight('survivorsLight', new Vector3(0, 1, 0), this.scene);

        this.map = new Map(this.game);
        this.map.buildSurvivorsArena(25);

        // Spawn hero — Champion in player-controlled mode
        this.hero = new Champion(this.game, [], null);
        this.hero.controlMode = 'player';

        this.heroController = new HeroController(
            this.scene,
            this.hero,
            this.map.getArenaRadius(),
            7,
            100,
        );

        this.heroController.setOnDeath(() => {
            this.game.getStateManager().changeState('gameOver');
        });

        // ---------- Gameplay systems ----------

        this.playerStats = new PlayerStats(120, 100);

        this.enemyManager = new EnemyManager(this.game, this.map);
        this.enemyManager.setPlayerStats(this.playerStats);
        this.enemyManager.configureSurvivorsMode(
            { getPosition: () => this.hero!.getPosition() },
            this.map.getArenaRadius(),
        );

        // Power slot manager — consults playerStats for damage/cooldown multipliers
        this.powerSlots = new PowerSlotManager(
            this.scene,
            () => this.hero!.getPosition(),
            () => this.enemyManager!.getEnemies(),
            () => (this.playerStats?.powerDamageMultiplier ?? 1.0) * this.runPerks.damageMultiplier,
            () => this.playerStats?.powerCooldownMultiplier ?? 1.0,
        );

        // Elite death → spawn a PowerDrop
        this.enemyManager.setOnEliteDeath((pos, element) => {
            const baseRadius = 4;
            const magnetRadius = baseRadius * this.runPerks.pickupRadiusMultiplier;
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

        // ---------- UI ----------

        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('survivorsUI', true, this.scene);

        // Mobile virtual joystick
        this.joystick = new SurvivorsJoystick(this.ui);
        this.joystick.onDirection((dx, dz) => {
            if (this.heroController) this.heroController.setExternalInput(dx, dz);
        });

        // HUD (HP bar, gold, power slots)
        this.hud = new HeroHud(this.ui);

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

    public exit(): void {
        for (const d of this.powerDrops) d.dispose();
        this.powerDrops = [];

        this.eliteIndicators?.dispose();
        this.eliteIndicators = null;

        this.powerSlots?.dispose();
        this.powerSlots = null;

        this.shopOverlay?.close();
        this.shopOverlay = null;

        this.replaceSlotOverlay?.close();
        this.replaceSlotOverlay = null;

        this.powerChoice?.close();
        this.powerChoice = null;

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
    }

    public update(deltaTime: number): void {
        // Apply time scale for slow-mo during power-choice overlay
        const dt = deltaTime * this.timeScale;

        if (this.heroController) this.heroController.update(dt);
        if (this.hero) this.hero.update(dt);

        if (this.waveManager) this.waveManager.update(dt);
        if (this.enemyManager) this.enemyManager.update(dt);

        // Contact damage
        this.applyContactDamage(dt);

        // Power auto-fire (only when game is not paused in shop)
        if (!this.shopOverlay?.isOpen() && !this.replaceSlotOverlay?.isOpen()) {
            if (this.powerSlots) this.powerSlots.update(dt);
        }

        // Power drops (magnet + pickup)
        for (const d of this.powerDrops) d.update(dt);
        this.powerDrops = this.powerDrops.filter(d => d.isAlive());

        // HUD update
        if (this.hud && this.heroController && this.powerSlots && this.playerStats) {
            this.hud.update(
                this.heroController.getHealth(),
                this.playerStats.getGold(),
                this.powerSlots.getSlots(),
            );
        }

        // Off-screen elite indicators
        if (this.eliteIndicators) this.eliteIndicators.update();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orb pickup → Power Choice overlay
    // ─────────────────────────────────────────────────────────────────────────

    private onOrbPickup(element: string): void {
        if (!this.powerSlots || !this.powerChoice || !this.playerStats) return;

        // Don't open if another overlay is already up
        if (this.powerChoice.isOpen() || this.replaceSlotOverlay?.isOpen()) return;

        const orbDef = getPowerByElement(element as PowerElement) ?? Object.values(POWER_DEFS)[0];
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
            const rolls = Object.values(POWER_DEFS).filter(d => d.id !== orbDef.id);
            const altDef = rolls[Math.floor(Math.random() * rolls.length)];
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
                title: '+10% Pickup Radius',
                apply: () => { this.runPerks.pickupRadiusMultiplier *= 1.1; },
            },
        ];
        const perk = perks[Math.floor(Math.random() * perks.length)];
        cards.push({
            kind:     'perk',
            title:    perk.title,
            subtitle: 'This run',
            onPick:   perk.apply,
        });

        // Slow time, open overlay
        this.timeScale = 0.2;
        this.powerChoice.show(
            cards,
            () => this.playerStats!.addGold(25), // cancel → +25 gold
            () => { this.timeScale = 1.0; },      // onClosed → restore speed
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
                id:          'magnetism',
                name:        'Magnetism',
                description: '+25% pickup radius',
                baseCost:    25,
                costGrowth:  1.5,
                isCapped:    () => false,
                apply: () => {
                    this.playerStats!.incrementPurchase('magnetism');
                    this.playerStats!.pickupRadiusMultiplier *= 1.25;
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
                isCapped:    (count) => this.playerStats!.damageReductionMultiplier <= 0.2,
                apply: () => {
                    this.playerStats!.incrementPurchase('bulwark');
                    this.playerStats!.damageReductionMultiplier = Math.max(
                        0.2,
                        this.playerStats!.damageReductionMultiplier * 0.95,
                    );
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
            if (!e.isAlive()) continue;
            const ePos = e.getPosition();
            const dx = ePos.x - heroPos.x;
            const dz = ePos.z - heroPos.z;
            const distSq = dx * dx + dz * dz;
            const sumR = this.heroRadius + 0.6;
            if (distSq < sumR * sumR) {
                this.heroController.takeDamage(e.contactDamagePerSecond * deltaTime * reductionMult);
            }
        }
    }
}
