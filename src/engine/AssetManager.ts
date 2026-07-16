/**
 * AssetManager - boot-time asset loading + sound playback facade.
 *
 * Slimmed down in the Three migration: the TD-era mesh/texture task queue
 * (basic_tower.glb etc.) was dead weight - character/enemy GLBs are loaded
 * on demand by SurvivorsGameplayState via engine/three/assets. What remains
 * is the sound setup and the playSound facade the gameplay call sites use.
 *
 * The game ships NO audio files - every sound is synthesized at boot by
 * proceduralSfx.ts and registered into the WebAudio buffer registry.
 * 'bgMusic' is the looping ambient bed (wind + low drone), so the facade
 * routes it through playLoop instead of a one-shot.
 */

import { registerSound, playSound, playLoop } from './three/audio';
import { SFX_DEFS, renderSfx } from './three/proceduralSfx';

const VOLUMES: Record<string, number> = {
    bgMusic: 0.5,
    towerShoot: 0.5,
    enemyDeath: 0.55,
    explosion: 0.8,
    pickup: 0.5,
    levelUp: 0.6,
    heal: 0.6,
};

/** Sound names played as seamless loops rather than one-shots. */
const LOOPS = new Set(['bgMusic']);

export class AssetManager {
    /**
     * Render all procedural sounds.
     * @param onComplete Callback when rendering finishes (failures tolerated)
     * @param onProgress Callback for loading progress (0-1)
     */
    public loadAssets(onComplete: () => void, onProgress?: (progress: number) => void): void {
        if (typeof OfflineAudioContext === 'undefined') {
            onComplete();
            return;
        }
        let done = 0;
        const tasks = SFX_DEFS.map(async def => {
            // The ambience def registers under the legacy 'bgMusic' handle its
            // call sites use.
            const name = def.name === 'ambience' ? 'bgMusic' : def.name;
            registerSound(name, await renderSfx(def));
            done++;
            onProgress?.(done / SFX_DEFS.length);
        });
        void Promise.allSettled(tasks).then(() => onComplete());
    }

    /** Play a named sound (loops start once and keep playing; one-shots fire). */
    public playSound(name: string): void {
        const volume = VOLUMES[name] ?? 1;
        if (LOOPS.has(name)) playLoop(name, volume);
        else playSound(name, volume);
    }
}
