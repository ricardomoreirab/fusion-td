import { Scene, Vector3, Color4, HemisphericLight } from '@babylonjs/core';
import { AdvancedDynamicTexture } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { Champion } from '../gameplay/Champion';
import { HeroController } from '../gameplay/HeroController';

export class SurvivorsGameplayState implements GameState {
    private game: Game;
    private scene: Scene | null = null;
    private ui: AdvancedDynamicTexture | null = null;
    private map: Map | null = null;
    private hero: Champion | null = null;
    private heroController: HeroController | null = null;

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
    }

    public exit(): void {
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
        this.scene = null;
    }

    public update(deltaTime: number): void {
        if (this.heroController) this.heroController.update(deltaTime);
        if (this.hero) this.hero.update(deltaTime);
    }
}
