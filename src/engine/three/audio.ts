/**
 * audio.ts - engine-agnostic WebAudio playback replacing Babylon Sound.
 *
 * Load failures (404, decode errors) are tolerated with a single warn per
 * sound - the shipped assets/sounds/ files are optional and Babylon's
 * loader tolerated their absence too. AudioContext is created lazily and
 * resumed on the next user gesture if the browser suspended it.
 */

const buffers = new Map<string, AudioBuffer>();
const warned = new Set<string>();

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

export async function loadSound(name: string, url: string): Promise<void> {
    const audio = getContext();
    if (!audio) return;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        buffers.set(name, await audio.decodeAudioData(data));
    } catch (err) {
        if (!warned.has(name)) {
            warned.add(name);
            console.warn(`[audio] sound '${name}' unavailable (${String(err)})`);
        }
    }
}

export function playSound(name: string, volume = 1): void {
    const audio = getContext();
    const buffer = buffers.get(name);
    if (!audio || !buffer || !masterGain) return;
    if (audio.state === 'suspended') void audio.resume();
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const gain = audio.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(masterGain);
    source.start();
}

export function setMasterVolume(v: number): void {
    masterVolume = v;
    if (masterGain) masterGain.gain.value = v;
}
