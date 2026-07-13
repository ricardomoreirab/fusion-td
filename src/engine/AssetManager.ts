/**
 * AssetManager - boot-time asset loading + sound playback facade.
 *
 * Slimmed down in the Three migration: the TD-era mesh/texture task queue
 * (basic_tower.glb etc.) was dead weight - character/enemy GLBs are loaded
 * on demand by SurvivorsGameplayState via engine/three/assets. What remains
 * is the sound preload (tolerant of missing files, as before) and the
 * playSound facade the gameplay call sites use.
 */

import { loadSound, playSound } from './three/audio';

const SOUNDS: Array<{ name: string; url: string; volume: number }> = [
    { name: 'bgMusic', url: 'assets/sounds/background.mp3', volume: 0.5 },
    { name: 'towerShoot', url: 'assets/sounds/tower_shoot.mp3', volume: 0.7 },
    { name: 'enemyDeath', url: 'assets/sounds/enemy_death.mp3', volume: 0.7 },
    { name: 'explosion', url: 'assets/sounds/explosion.mp3', volume: 0.8 },
];

export class AssetManager {
    private volumes = new Map<string, number>();

    /**
     * Load all boot assets.
     * @param onComplete Callback when loading finishes (failures tolerated)
     * @param onProgress Callback for loading progress (0-1)
     */
    public loadAssets(onComplete: () => void, onProgress?: (progress: number) => void): void {
        let done = 0;
        const total = SOUNDS.length;
        const tasks = SOUNDS.map(async s => {
            this.volumes.set(s.name, s.volume);
            await loadSound(s.name, s.url);
            done++;
            onProgress?.(done / total);
        });
        void Promise.allSettled(tasks).then(() => onComplete());
    }

    /** Play a preloaded sound by name (no-op if it failed to load). */
    public playSound(name: string): void {
        playSound(name, this.volumes.get(name) ?? 1);
    }
}
