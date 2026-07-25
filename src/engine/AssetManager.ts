/**
 * AssetManager - boot-time audio loading + sound playback facade.
 *
 * The game used to ship NO audio files: every sound was synthesized at boot by
 * proceduralSfx.ts. That was replaced with generated audio assets because the
 * synthesized set sounded cheap and only covered five events. Sounds now load
 * from `assets/audio/**` into the WebAudio buffer registry in three/audio.ts.
 *
 * Rules kept from the old facade:
 *  - One `playSound(name)` entry point; call sites never touch WebAudio.
 *  - Loops (the ambience beds) route through playLoop, not playSound.
 *  - A missing or failed asset degrades to SILENCE. Audio must never be able to
 *    take the boot sequence or a gameplay frame down with it.
 */

import { loadSoundFile, playSound, playLoop, stopLoop, hasSound } from './three/audio';

/** Per-sound mix levels. Authored here so the generated files need no offline
 *  normalisation pass. */
const VOLUMES: Record<string, number> = {
    // ambience beds
    bgMusic: 0.40,
    ambienceMeadow: 0.38,
    ambienceScorched: 0.40,
    ambienceCursed: 0.40,
    // gameplay
    enemyDeath: 0.40,
    enemyDeathHeavy: 0.55,
    explosion: 0.70,
    pickup: 0.50,
    levelUp: 0.65,
    heal: 0.55,
    heroAttack: 0.30,
    heroHit: 0.60,
    powerCast: 0.35,
    waveStart: 0.60,
    // ui
    uiConfirm: 0.50,
};

/**
 * name → file. Explicit rather than globbed, so a missing asset shows up as a
 * visible diff instead of a silent gap.
 *
 * `bgMusic` is the menu bed and reuses the meadow ambience; the survivors state
 * swaps to the per-biome beds via setAmbience().
 */
const MANIFEST: Record<string, string> = {
    enemyDeath:       'assets/audio/sfx/enemyDeath.mp3',
    enemyDeathHeavy:  'assets/audio/sfx/enemyDeathHeavy.mp3',
    explosion:        'assets/audio/sfx/explosion.mp3',
    pickup:           'assets/audio/sfx/pickup.mp3',
    levelUp:          'assets/audio/sfx/levelUp.mp3',
    heal:             'assets/audio/sfx/heal.mp3',
    heroAttack:       'assets/audio/sfx/heroAttack.mp3',
    heroHit:          'assets/audio/sfx/heroHit.mp3',
    powerCast:        'assets/audio/sfx/powerCast.mp3',
    waveStart:        'assets/audio/sfx/waveStart.mp3',
    uiConfirm:        'assets/audio/ui/uiConfirm.mp3',
    bgMusic:          'assets/audio/ambience/ambienceMeadow.mp3',
    ambienceMeadow:   'assets/audio/ambience/ambienceMeadow.mp3',
    ambienceScorched: 'assets/audio/ambience/ambienceScorched.mp3',
    ambienceCursed:   'assets/audio/ambience/ambienceCursed.mp3',
};

/** Sound names played as seamless loops rather than one-shots. */
const LOOPS = new Set(['bgMusic', 'ambienceMeadow', 'ambienceScorched', 'ambienceCursed']);

export class AssetManager {
    private currentAmbience: string | null = null;

    /**
     * Load every manifested sound.
     * @param onComplete Callback when loading finishes (failures tolerated)
     * @param onProgress Callback for loading progress (0-1)
     */
    public loadAssets(onComplete: () => void, onProgress?: (progress: number) => void): void {
        if (typeof AudioContext === 'undefined') {
            onComplete();
            return;
        }
        const entries = Object.entries(MANIFEST);
        // bgMusic and ambienceMeadow point at the same file; the browser cache
        // collapses the second request, so this is one network fetch.
        let done = 0;
        const tasks = entries.map(async ([name, url]) => {
            try {
                await loadSoundFile(name, url);
            } catch (err) {
                console.warn(`[audio] "${name}" failed to load from ${url} — silent`, err);
            } finally {
                done++;
                onProgress?.(done / entries.length);
            }
        });
        void Promise.allSettled(tasks).then(() => onComplete());
    }

    /** Play a named sound (loops start once and keep playing; one-shots fire). */
    public playSound(name: string): void {
        const volume = VOLUMES[name] ?? 1;
        if (LOOPS.has(name)) playLoop(name, volume);
        else playSound(name, volume);
    }

    /** Fade out and stop a looping bed. */
    public stopSound(name: string, fadeS = 0.8): void {
        stopLoop(name, fadeS);
    }

    /**
     * Cross-fade to a biome ambience bed, fading out the others.
     * No-ops when already on `name`, so callers can drive it every frame.
     */
    public setAmbience(name: string): void {
        if (!hasSound(name) || this.currentAmbience === name) return;
        for (const other of LOOPS) {
            if (other !== name) stopLoop(other, 1.2);
        }
        this.currentAmbience = name;
        playLoop(name, VOLUMES[name] ?? 0.4);
    }

    /** Stop every ambience bed (state exit). */
    public stopAllAmbience(fadeS = 0.8): void {
        for (const name of LOOPS) stopLoop(name, fadeS);
        this.currentAmbience = null;
    }
}
