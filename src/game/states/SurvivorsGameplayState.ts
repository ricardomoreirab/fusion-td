import { Scene, Vector3, Color4, ArcRotateCamera, HemisphericLight } from '@babylonjs/core';
import { AdvancedDynamicTexture } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';

export class SurvivorsGameplayState implements GameState {
    private game: Game;
    private scene: Scene | null = null;
    private ui: AdvancedDynamicTexture | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        this.game.cleanupScene();
        this.scene = this.game.getScene();
        this.scene.clearColor = new Color4(0.05, 0.05, 0.08, 1);

        new HemisphericLight('survivorsLight', new Vector3(0, 1, 0), this.scene);

        const camera = new ArcRotateCamera(
            'survivorsCam',
            -Math.PI / 2,
            Math.PI / 4,
            35,
            Vector3.Zero(),
            this.scene,
        );
        camera.attachControl(this.game.getCanvas(), false);
        this.scene.activeCamera = camera;

        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('survivorsUI', true, this.scene);
    }

    public exit(): void {
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
        this.scene = null;
    }

    public update(_deltaTime: number): void {
    }
}
