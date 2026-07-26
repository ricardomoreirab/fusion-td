import { describe, it, expect } from 'vitest';
import { detectLoopRange } from '../src/engine/three/audio';

const SR = 44100;

/** `head` silent samples, then `body` samples of tone, then `tail` silent.
    Cosine, so the tone starts at full amplitude — a sine would put an exact
    zero on the first body sample and read as one more frame of padding. */
function bed(head: number, body: number, tail: number): Float32Array {
    const out = new Float32Array(head + body + tail);
    for (let i = 0; i < body; i++) out[head + i] = 0.3 * Math.cos(i / 40);
    return out;
}

describe('detectLoopRange — MP3 encoder padding', () => {
    it('trims the decode delay and final-frame padding off a looping bed', () => {
        // Measured on the re-encoded meadow bed: ~13 ms lead-in, ~30 ms tail.
        const head = 573, tail = 1659;
        const range = detectLoopRange(bed(head, SR * 2, tail), SR);
        expect(range.startSample).toBe(head);
        expect(range.endSample).toBe(head + SR * 2);
    });

    it('leaves a bed with no padding at its full length', () => {
        const data = bed(0, SR, 0);
        expect(detectLoopRange(data, SR)).toEqual({ startSample: 0, endSample: data.length });
    });

    it('does NOT clip a bed that deliberately fades in from silence', () => {
        // A half-second lead-in is content, not padding — trimming it would make
        // the bed start mid-swell on every pass.
        const head = Math.floor(SR * 0.5);
        const data = bed(head, SR, 0);
        expect(detectLoopRange(data, SR)).toEqual({ startSample: 0, endSample: data.length });
    });

    it('never returns an inverted or out-of-bounds range for all-silent input', () => {
        const data = new Float32Array(SR);
        const range = detectLoopRange(data, SR);
        expect(range.startSample).toBe(0);
        expect(range.endSample).toBe(data.length);
    });
});
