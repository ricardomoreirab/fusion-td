/**
 * audio.ts - engine-agnostic WebAudio playback replacing Babylon Sound.
 *
 * Buffers are decoded from shipped audio files via loadSoundFile (see
 * AssetManager's manifest). registerSound remains for anything that builds a
 * buffer in memory. AudioContext is created lazily and resumed on the next
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

/** Register an already-built buffer under a name. */
export function registerSound(name: string, buffer: AudioBuffer): void {
    buffers.set(name, buffer);
}

/** True once a buffer exists for `name` — call sites stay silent rather than
 *  throwing when an asset failed to load. */
export function hasSound(name: string): boolean {
    return buffers.has(name);
}

/**
 * Fetch + decode an audio file and register it under `name`.
 *
 * Decoding needs an AudioContext, but creating one before a user gesture leaves
 * it 'suspended' — that is fine, decodeAudioData works on a suspended context,
 * and getContext() already wires the gesture listeners that resume it.
 *
 * Rejects are the caller's to handle: a failed sound must degrade to silence,
 * never take the boot sequence down with it.
 */
export async function loadSoundFile(name: string, url: string): Promise<void> {
    const audio = getContext();
    if (!audio) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const bytes = await res.arrayBuffer();
    const buffer = await audio.decodeAudioData(bytes);
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

/** Longest run of silence treated as encoder padding rather than as content.
 *  MP3 decode delay + final-frame padding is tens of milliseconds; a bed that
 *  genuinely opens quiet stays untouched. */
const MAX_PADDING_S = 0.12;
/** Below this amplitude a sample counts as silence for padding detection. */
const PADDING_FLOOR = 1 / 2048;

/** Loop points that skip an MP3's encoder delay/padding, cached per buffer.
 *  A lossy encode adds silence at both ends of the file; with `loop = true` and
 *  no loop points those two silences meet at the wrap and punch an audible hole
 *  through an otherwise seamless bed once every pass. */
const loopPoints = new WeakMap<AudioBuffer, { start: number; end: number }>();

/**
 * Sample range of a looping bed with encoder padding excluded. Pure — exported
 * for Vitest, which has no AudioBuffer.
 *
 * Bails out to the full range if either end is silent for longer than
 * MAX_PADDING_S, so a bed that legitimately fades in from nothing is never
 * clipped into starting mid-swell.
 */
export function detectLoopRange(
    data: Float32Array | number[], sampleRate: number,
): { startSample: number; endSample: number } {
    const maxPad = Math.floor(MAX_PADDING_S * sampleRate);
    let head = 0;
    while (head < maxPad && head < data.length && Math.abs(data[head]) < PADDING_FLOOR) head++;
    let tail = 0;
    while (tail < maxPad && tail < data.length && Math.abs(data[data.length - 1 - tail]) < PADDING_FLOOR) tail++;
    if (head >= maxPad || tail >= maxPad) return { startSample: 0, endSample: data.length };
    return { startSample: head, endSample: data.length - tail };
}

function seamlessLoopPoints(buffer: AudioBuffer): { start: number; end: number } {
    const cached = loopPoints.get(buffer);
    if (cached) return cached;
    const { startSample, endSample } = detectLoopRange(buffer.getChannelData(0), buffer.sampleRate);
    const points = { start: startSample / buffer.sampleRate, end: endSample / buffer.sampleRate };
    loopPoints.set(buffer, points);
    return points;
}

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
    const { start, end } = seamlessLoopPoints(buffer);
    source.loopStart = start;
    source.loopEnd = end;
    const gain = audio.createGain();
    // Fade in so the loop never pops on state transitions.
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), audio.currentTime + 1.5);
    source.connect(gain);
    gain.connect(masterGain);
    source.start(0, start); // begin AT the loop point, not in the leading padding
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
