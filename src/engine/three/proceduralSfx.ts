/**
 * proceduralSfx.ts - synthesized game audio, rendered once at boot into
 * AudioBuffers via OfflineAudioContext. The game ships no audio files;
 * every sound is built from oscillators + filtered noise, which keeps the
 * bundle free of binary assets and the sound palette consistent.
 *
 * Each definition renders into the shared buffer registry in audio.ts, so
 * the existing AssetManager.playSound facade plays them like loaded files.
 * 'ambience' renders as a seamless loop (ends crossfaded) for playLoop.
 */

export interface SfxDef {
    name: string;
    seconds: number;
    /** true → crossfade the buffer ends so it can loop seamlessly. */
    loop?: boolean;
    build: (ctx: OfflineAudioContext) => void;
}

/** White-noise source with an exponential gain envelope through a filter. */
function noiseBurst(
    ctx: OfflineAudioContext,
    opts: {
        startS?: number; durS: number; gain: number;
        filter: BiquadFilterType; freq: number; freqEnd?: number;
    },
): void {
    const start = opts.startS ?? 0;
    const buffer = ctx.createBuffer(1, Math.ceil(opts.durS * ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter;
    filter.frequency.setValueAtTime(opts.freq, start);
    if (opts.freqEnd !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), start + opts.durS);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.durS);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(start);
}

/** Oscillator with a pitch sweep and exponential decay envelope. */
function tone(
    ctx: OfflineAudioContext,
    opts: {
        startS?: number; durS: number; gain: number;
        type: OscillatorType; freq: number; freqEnd?: number;
        attackS?: number;
    },
): void {
    const start = opts.startS ?? 0;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.freqEnd !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), start + opts.durS);
    }
    const gain = ctx.createGain();
    const attack = opts.attackS ?? 0.005;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(opts.gain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.durS);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + opts.durS);
}

export const SFX_DEFS: SfxDef[] = [
    {
        // Soft thump + air: fires constantly at horde scale, so it must not fatigue.
        name: 'enemyDeath',
        seconds: 0.25,
        build: ctx => {
            tone(ctx, { durS: 0.2, gain: 0.5, type: 'triangle', freq: 220, freqEnd: 60 });
            noiseBurst(ctx, { durS: 0.09, gain: 0.18, filter: 'highpass', freq: 1200 });
        },
    },
    {
        name: 'explosion',
        seconds: 0.9,
        build: ctx => {
            tone(ctx, { durS: 0.7, gain: 0.9, type: 'sine', freq: 150, freqEnd: 35 });
            noiseBurst(ctx, { durS: 0.6, gain: 0.5, filter: 'lowpass', freq: 900, freqEnd: 120 });
        },
    },
    {
        name: 'towerShoot',
        seconds: 0.12,
        build: ctx => {
            tone(ctx, { durS: 0.1, gain: 0.35, type: 'square', freq: 640, freqEnd: 280 });
        },
    },
    {
        // Coin-ish two-partial blip for gold/orb pickups.
        name: 'pickup',
        seconds: 0.18,
        build: ctx => {
            tone(ctx, { durS: 0.12, gain: 0.3, type: 'sine', freq: 880, freqEnd: 1320 });
            tone(ctx, { startS: 0.03, durS: 0.12, gain: 0.18, type: 'sine', freq: 1760 });
        },
    },
    {
        // Rising C-major arpeggio: level-up / forge fanfare.
        name: 'levelUp',
        seconds: 0.65,
        build: ctx => {
            const notes = [523.25, 659.25, 783.99, 1046.5];
            notes.forEach((f, i) => {
                tone(ctx, { startS: i * 0.09, durS: 0.3, gain: 0.28, type: 'triangle', freq: f });
            });
        },
    },
    {
        // Gentle two-note chime for heals.
        name: 'heal',
        seconds: 0.5,
        build: ctx => {
            tone(ctx, { durS: 0.35, gain: 0.25, type: 'sine', freq: 523.25 });
            tone(ctx, { startS: 0.12, durS: 0.35, gain: 0.25, type: 'sine', freq: 783.99 });
        },
    },
    {
        // Ambient bed: band-passed wind wash + a barely-audible low drone.
        // Rendered as a seamless 8s loop, started by the menu as 'bgMusic'.
        name: 'ambience',
        seconds: 8,
        loop: true,
        build: ctx => {
            // ctx.length covers the loop body PLUS the fade window makeSeamless trims.
            const noise = ctx.createBuffer(1, ctx.length, ctx.sampleRate);
            const data = noise.getChannelData(0);
            let last = 0;
            for (let i = 0; i < data.length; i++) {
                // One-pole lowpassed white noise ≈ wind body.
                last = last * 0.98 + (Math.random() * 2 - 1) * 0.02;
                data[i] = last * 18;
            }
            const src = ctx.createBufferSource();
            src.buffer = noise;
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.Q.value = 0.6;
            // Slow gust cycle across the loop: 350 → 700 → 350 Hz.
            filter.frequency.setValueAtTime(350, 0);
            filter.frequency.linearRampToValueAtTime(700, 4);
            filter.frequency.linearRampToValueAtTime(350, 8);
            const windGain = ctx.createGain();
            windGain.gain.value = 0.16;
            src.connect(filter).connect(windGain).connect(ctx.destination);
            src.start(0);

            const drone = ctx.createOscillator();
            drone.type = 'sine';
            drone.frequency.value = 55;
            const droneGain = ctx.createGain();
            // Gentle amplitude wobble so the drone breathes with the gusts.
            droneGain.gain.setValueAtTime(0.030, 0);
            droneGain.gain.linearRampToValueAtTime(0.045, 4);
            droneGain.gain.linearRampToValueAtTime(0.030, 8);
            // No stop() — the drone runs through the extra fade window that
            // makeSeamless folds back into the loop head (values at 8s match 0s).
            drone.connect(droneGain).connect(ctx.destination);
            drone.start(0);
        },
    },
];

/** Fold the last `fadeS` seconds into the head as a crossfade, then trim the
 *  tail off, leaving a buffer whose end flows seamlessly back to its start. */
function makeSeamless(buffer: AudioBuffer, fadeS: number): AudioBuffer {
    const fadeSamples = Math.min(Math.floor(fadeS * buffer.sampleRate), Math.floor(buffer.length / 2));
    const outLength = buffer.length - fadeSamples;
    const out = new AudioBuffer({
        length: outLength,
        numberOfChannels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
    });
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const src = buffer.getChannelData(ch);
        const dst = out.getChannelData(ch);
        dst.set(src.subarray(0, outLength));
        for (let i = 0; i < fadeSamples; i++) {
            const t = i / fadeSamples;
            dst[i] = src[i] * t + src[outLength + i] * (1 - t);
        }
    }
    return out;
}

/** Render one definition to an AudioBuffer (mono is fine for game SFX). */
export async function renderSfx(def: SfxDef): Promise<AudioBuffer> {
    const sampleRate = 44100;
    // Loops render an extra fade window that makeSeamless folds back and trims.
    const fadeS = def.loop ? 0.5 : 0;
    const ctx = new OfflineAudioContext(1, Math.ceil((def.seconds + fadeS) * sampleRate), sampleRate);
    def.build(ctx);
    const buffer = await ctx.startRendering();
    return def.loop ? makeSeamless(buffer, fadeS) : buffer;
}
