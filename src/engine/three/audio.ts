/**
 * audio.ts - engine-agnostic WebAudio playback replacing Babylon Sound.
 *
 * Buffers come from proceduralSfx.ts via registerSound (the game ships no
 * audio files). AudioContext is created lazily and resumed on the next
 * user gesture if the browser suspended it.
 */

const buffers = new Map<string, AudioBuffer>();

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterVolume = 1;

function getContext(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!ctx) {
        ctx = new AudioContext();
        masterGain = ctx.createGain();
        masterGain.gain.value = masterVolume;
        masterGain.connect(ctx.destination);
        const resume = (): void => {
            void ctx?.resume();
        };
        window.addEventListener('pointerdown', resume, { once: true });
        window.addEventListener('keydown', resume, { once: true });
    }
    return ctx;
}

/** Register an already-built buffer (procedural SFX) under a name. */
export function registerSound(name: string, buffer: AudioBuffer): void {
    buffers.set(name, buffer);
}

// One-shots retrigger no faster than this — at horde scale dozens of identical
// death sounds per frame would otherwise stack into a clipping wall.
const MIN_RETRIGGER_MS = 45;
const lastPlayedAt = new Map<string, number>();

export function playSound(name: string, volume = 1): void {
    const audio = getContext();
    const buffer = buffers.get(name);
    if (!audio || !buffer || !masterGain) return;
    const now = performance.now();
    if (now - (lastPlayedAt.get(name) ?? -Infinity) < MIN_RETRIGGER_MS) return;
    lastPlayedAt.set(name, now);
    if (audio.state === 'suspended') void audio.resume();
    const source = audio.createBufferSource();
    source.buffer = buffer;
    // ±8% pitch variance keeps repeated SFX from sounding machine-gunned.
    source.playbackRate.value = 0.92 + Math.random() * 0.16;
    const gain = audio.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(masterGain);
    source.start();
}

const activeLoops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();

/** Start a named buffer as a seamless loop (no-op if already playing). */
export function playLoop(name: string, volume = 1): void {
    if (activeLoops.has(name)) return;
    const audio = getContext();
    const buffer = buffers.get(name);
    if (!audio || !buffer || !masterGain) return;
    if (audio.state === 'suspended') void audio.resume();
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = audio.createGain();
    // Fade in so the loop never pops on state transitions.
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), audio.currentTime + 1.5);
    source.connect(gain);
    gain.connect(masterGain);
    source.start();
    activeLoops.set(name, { source, gain });
}

/** Fade out and stop a named loop (no-op if not playing). */
export function stopLoop(name: string, fadeS = 0.8): void {
    const loop = activeLoops.get(name);
    const audio = ctx;
    if (!loop || !audio) return;
    activeLoops.delete(name);
    // Clear any pending fade-IN ramp first, or it would re-raise the gain
    // after our fade-out when stopping during the start ramp.
    loop.gain.gain.cancelScheduledValues(audio.currentTime);
    loop.gain.gain.setValueAtTime(Math.max(loop.gain.gain.value, 0.0001), audio.currentTime);
    loop.gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + fadeS);
    loop.source.stop(audio.currentTime + fadeS);
}

export function setMasterVolume(v: number): void {
    masterVolume = v;
    if (masterGain) masterGain.gain.value = v;
}
