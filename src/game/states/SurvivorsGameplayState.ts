import { Scene, Vector3, Color4, HemisphericLight } from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
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
import { Enemy } from '../gameplay/enemies/Enemy';
import { BasicAttackTarget } from '../gameplay/HeroBasicAttack';

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

    // Power drops
    private powerDrops: PowerDrop[] = [];

    // Contact damage radius (hero bounding circle)
    private readonly heroRadius: number = 0.6;

    // HP HUD
    private hpBarBg: Rectangle | null = null;
    private hpBarFill: Rectangle | null = null;
    private hpText: TextBlock | null = null;

    // Gold HUD
    private goldText: TextBlock | null = null;

    // Reward listener for enemyReward custom events
    private rewardHandler: ((e: Event) => void) | null = null;

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

        // Spawn hero — Champion with empty path in player-controlled mode
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

        // Elite death → spawn a PowerDrop
        this.enemyManager.setOnEliteDeath((pos, element) => {
            const drop = new PowerDrop(
                this.scene!,
                pos,
                element,
                () => this.hero!.getPosition(),
                {
                    pickupRadius: 1.5,
                    magnetRadius: 4,
                    magnetSpeed: 12,
                    onPickup: (_el) => {
                        // Phase 4 will replace this with the Power Choice overlay.
                        // For now, just heal 1 HP.
                        this.heroController!.heal(1);
                    },
                },
            );
            this.powerDrops.push(drop);
        });

        this.waveManager = new WaveManager(this.enemyManager, this.playerStats);

        // Override spawn fn: spawn enemies at arena perimeter, pass elite element if present
        this.waveManager.setSpawnFn((type, eliteElement) => {
            this.enemyManager!.spawnSurvivorsEnemy(type, eliteElement);
        });

        // Wire basic-attack target provider to nearest alive enemy
        this.heroController.setTargetProvider(() => this.getNearestEnemy());

        // Listen for gold reward events dispatched by enemies on death
        this.rewardHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail && typeof detail.reward === 'number') {
                this.playerStats!.addMoney(detail.reward);
            }
        };
        document.addEventListener('enemyReward', this.rewardHandler);

        // ---------- UI ----------

        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('survivorsUI', true, this.scene);

        // Mobile virtual joystick — bottom-left corner
        this.joystick = new SurvivorsJoystick(this.ui);
        this.joystick.onDirection((dx, dz) => {
            if (this.heroController) this.heroController.setExternalInput(dx, dz);
        });

        // HP bar — bottom-left above the joystick
        this.hpBarBg = new Rectangle('hpBg');
        this.hpBarBg.width = '240px';
        this.hpBarBg.height = '22px';
        this.hpBarBg.thickness = 2;
        this.hpBarBg.color = '#222';
        this.hpBarBg.background = '#111';
        this.hpBarBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hpBarBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.hpBarBg.left = '20px';
        this.hpBarBg.top = '-145px'; // above the joystick
        this.ui.addControl(this.hpBarBg);

        this.hpBarFill = new Rectangle('hpFill');
        this.hpBarFill.width = 1.0;
        this.hpBarFill.height = 1.0;
        this.hpBarFill.thickness = 0;
        this.hpBarFill.background = '#c33';
        this.hpBarFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hpBarBg.addControl(this.hpBarFill);

        this.hpText = new TextBlock('hpText', '100 / 100');
        this.hpText.color = '#fff';
        this.hpText.fontSize = 14;
        this.hpBarBg.addControl(this.hpText);

        // Gold readout — next to the HP bar
        this.goldText = new TextBlock('goldText', '💰 0');
        this.goldText.color = '#ffd700';
        this.goldText.fontSize = 16;
        this.goldText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.goldText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.goldText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.goldText.left = '270px';
        this.goldText.top = '-145px';
        this.goldText.width = '120px';
        this.goldText.height = '22px';
        this.ui.addControl(this.goldText);
    }

    public exit(): void {
        if (this.rewardHandler) {
            document.removeEventListener('enemyReward', this.rewardHandler);
            this.rewardHandler = null;
        }
        for (const d of this.powerDrops) d.dispose();
        this.powerDrops = [];

        if (this.waveManager) {
            this.waveManager.dispose();
            this.waveManager = null;
        }
        if (this.enemyManager) {
            this.enemyManager.dispose();
            this.enemyManager = null;
        }
        this.playerStats = null;

        if (this.joystick) {
            this.joystick.dispose();
            this.joystick = null;
        }
        if (this.heroController) {
            this.heroController.dispose();
            this.heroController = null;
        }
        if (this.hero) {
            this.hero.dispose();
            this.hero = null;
        }
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
        if (this.map) {
            this.map.dispose();
            this.map = null;
        }
        this.hpBarBg = null;
        this.hpBarFill = null;
        this.hpText = null;
        this.goldText = null;
        this.scene = null;
    }

    public update(deltaTime: number): void {
        if (this.heroController) this.heroController.update(deltaTime);
        if (this.hero) this.hero.update(deltaTime);

        if (this.waveManager) this.waveManager.update(deltaTime);
        if (this.enemyManager) this.enemyManager.update(deltaTime);

        // Contact damage: apply DPS when an enemy overlaps the hero
        this.applyContactDamage(deltaTime);

        // Update power drops (magnet + pickup)
        for (const d of this.powerDrops) d.update(deltaTime);
        this.powerDrops = this.powerDrops.filter(d => d.isAlive());

        // Update HP HUD
        if (this.heroController && this.hpBarFill && this.hpText) {
            const ratio = this.heroController.getHealthRatio();
            this.hpBarFill.width = ratio;
            const hp = this.heroController.getHealth();
            this.hpText.text = `${Math.ceil(hp.current)} / ${hp.max}`;
        }

        // Update gold HUD
        if (this.goldText && this.playerStats) {
            this.goldText.text = '💰 ' + this.playerStats.getMoney();
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /** Return the nearest alive enemy to the hero, in BasicAttackTarget form. */
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
            position: captured.getPosition(),
            takeDamage: (n) => captured.takeDamage(n),
            isAlive: () => captured.isAlive(),
        };
    }

    /** Tick contact damage from overlapping enemies each frame. */
    private applyContactDamage(deltaTime: number): void {
        if (!this.hero || !this.enemyManager || !this.heroController) return;
        const heroPos = this.hero.getPosition();
        for (const e of this.enemyManager.getEnemies()) {
            if (!e.isAlive()) continue;
            const ePos = e.getPosition();
            const dx = ePos.x - heroPos.x;
            const dz = ePos.z - heroPos.z;
            const distSq = dx * dx + dz * dz;
            const sumR = this.heroRadius + 0.6; // enemy body radius ~0.6
            if (distSq < sumR * sumR) {
                this.heroController.takeDamage(e.contactDamagePerSecond * deltaTime);
            }
        }
    }
}
