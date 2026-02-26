import { Vector3, Animation, ArcRotateCamera, Scene, CubicEase, EasingFunction } from '@babylonjs/core';
import { Game } from '../Game';
import { Map } from './Map';
import { LevelConfig, ALL_LEVELS } from './LevelConfig';

export class LevelManager {
    private game: Game;
    private scene: Scene;
    private currentLevelIndex: number = 0;
    private maps: Map[] = [];
    private readonly zOffsetPerLevel: number = 50;

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();
    }

    public getCurrentLevelIndex(): number {
        return this.currentLevelIndex;
    }

    public getCurrentLevelConfig(): LevelConfig {
        return ALL_LEVELS[this.currentLevelIndex];
    }

    public getZOffset(levelIndex: number): number {
        return levelIndex * this.zOffsetPerLevel;
    }

    public getCameraTarget(levelIndex: number): Vector3 {
        return new Vector3(20, 0, 20 + this.getZOffset(levelIndex));
    }

    public isLastLevel(): boolean {
        return this.currentLevelIndex >= ALL_LEVELS.length - 1;
    }

    public getTotalLevels(): number {
        return ALL_LEVELS.length;
    }

    /**
     * Create a Map for the given level index, with the correct Z offset.
     */
    public createMapForLevel(levelIndex: number): Map {
        const config = ALL_LEVELS[levelIndex];
        const zOffset = this.getZOffset(levelIndex);
        const map = new Map(this.game, config, zOffset);
        map.initialize();
        this.maps.push(map);
        return map;
    }

    /**
     * Advance to the next level. Returns the new level index.
     */
    public advanceLevel(): number {
        this.currentLevelIndex++;
        return this.currentLevelIndex;
    }

    /**
     * Animate camera from current target to the next level's target.
     * Returns a Promise that resolves when the animation completes.
     */
    public animateCameraToLevel(levelIndex: number): Promise<void> {
        return new Promise((resolve) => {
            const camera = this.scene.activeCamera as ArcRotateCamera;
            if (!camera) {
                resolve();
                return;
            }

            const from = camera.target.clone();
            const to = this.getCameraTarget(levelIndex);

            const anim = new Animation(
                'cameraTransition',
                'target',
                30, // 30 fps
                Animation.ANIMATIONTYPE_VECTOR3,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );

            anim.setKeys([
                { frame: 0, value: from },
                { frame: 60, value: to } // 2 seconds at 30 fps
            ]);

            const easing = new CubicEase();
            easing.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
            anim.setEasingFunction(easing);

            camera.animations = [anim];

            this.scene.beginAnimation(camera, 0, 60, false, 1, () => {
                camera.target = to;
                resolve();
            });
        });
    }

    /**
     * Dispose all maps created by this manager.
     */
    public dispose(): void {
        for (const map of this.maps) {
            map.dispose();
        }
        this.maps = [];
    }
}
