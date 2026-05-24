import { Scene, Vector3, Color4, HemisphericLight } from '@babylonjs/core';
import { AdvancedDynamicTexture } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';

export class SurvivorsGameplayState implements GameState {
    private game: Game;
    private scene: Scene | null = null;
    private ui: AdvancedDynamicTexture | null = null;
    private map: Map | null = null;

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

        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('survivorsUI', true, this.scene);
    }

    public exit(): void {
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

    public update(_deltaTime: number): void {
    }
}
