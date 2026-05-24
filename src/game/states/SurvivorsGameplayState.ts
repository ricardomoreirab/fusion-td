import { Scene, Vector3, Color4, HemisphericLight } from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { Champion } from '../gameplay/Champion';
import { HeroController } from '../gameplay/HeroController';
import { SurvivorsJoystick } from '../ui/SurvivorsJoystick';

export class SurvivorsGameplayState implements GameState {
    private game: Game;
    private scene: Scene | null = null;
    private ui: AdvancedDynamicTexture | null = null;
    private map: Map | null = null;
    private hero: Champion | null = null;
    private heroController: HeroController | null = null;
    private joystick: SurvivorsJoystick | null = null;

    // HP HUD
    private hpBarBg: Rectangle | null = null;
    private hpBarFill: Rectangle | null = null;
    private hpText: TextBlock | null = null;

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

        // Spawn hero directly — Champion with empty path in player-controlled mode
        // (ChampionManager requires EnemyManager/WaveManager which don't exist here yet)
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
    }

    public exit(): void {
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
        this.scene = null;
    }

    public update(deltaTime: number): void {
        if (this.heroController) this.heroController.update(deltaTime);
        if (this.hero) this.hero.update(deltaTime);

        // Update HP HUD
        if (this.heroController && this.hpBarFill && this.hpText) {
            const ratio = this.heroController.getHealthRatio();
            this.hpBarFill.width = ratio;
            const hp = this.heroController.getHealth();
            this.hpText.text = `${Math.ceil(hp.current)} / ${hp.max}`;
        }
    }
}
