import { describe, expect, it } from 'vitest';
import { AnimationClip, AnimationMixer, NumberKeyframeTrack, Object3D } from 'three';
import { AnimGroup } from '../src/engine/three/AnimGroup';

/** 1-second clip animating position.x from 0 to 10. */
function makeRig(): { root: Object3D; mixer: AnimationMixer; group: AnimGroup } {
    const root = new Object3D();
    const track = new NumberKeyframeTrack('.position[x]', [0, 1], [0, 10]);
    const clip = new AnimationClip('walk', 1, [track]);
    const mixer = new AnimationMixer(root);
    return { root, mixer, group: new AnimGroup(mixer, clip) };
}

describe('AnimGroup', () => {
    it('exposes the clip name and duration', () => {
        const { group } = makeRig();
        expect(group.name).toBe('walk');
        expect(group.duration).toBe(1);
    });

    it('start(false) plays once and clamps on the final frame', () => {
        const { root, mixer, group } = makeRig();
        group.start(false);
        expect(group.isPlaying).toBe(true);
        mixer.update(0.5);
        expect(root.position.x).toBeCloseTo(5);
        mixer.update(1.0); // past the end
        expect(root.position.x).toBeCloseTo(10); // held, not reset
        expect(group.isPlaying).toBe(false);
    });

    it('start(true) loops', () => {
        const { root, mixer, group } = makeRig();
        group.start(true);
        mixer.update(1.25);
        expect(group.isPlaying).toBe(true);
        expect(root.position.x).toBeCloseTo(2.5);
    });

    it('fires onEnded exactly once per non-looping play', () => {
        const { mixer, group } = makeRig();
        let ended = 0;
        group.onEnded = () => ended++;
        group.start(false);
        mixer.update(1.5);
        mixer.update(0.5);
        expect(ended).toBe(1);
        group.start(false);
        mixer.update(1.5);
        expect(ended).toBe(2);
    });

    it('speedRatio scales playback', () => {
        const { root, mixer, group } = makeRig();
        group.speedRatio = 2;
        group.start(false);
        expect(group.speedRatio).toBe(2);
        mixer.update(0.25);
        expect(root.position.x).toBeCloseTo(5);
    });

    it('stop() halts playback; restart plays from the beginning', () => {
        const { root, mixer, group } = makeRig();
        group.start(false);
        mixer.update(0.5);
        group.stop();
        expect(group.isPlaying).toBe(false);
        group.start(false);
        mixer.update(0.1);
        expect(root.position.x).toBeCloseTo(1);
    });

    it('only its own action triggers onEnded (shared mixer)', () => {
        const root = new Object3D();
        const mixer = new AnimationMixer(root);
        const clipA = new AnimationClip('a', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])]);
        const clipB = new AnimationClip('b', 2, [new NumberKeyframeTrack('.position[y]', [0, 2], [0, 1])]);
        const groupA = new AnimGroup(mixer, clipA);
        const groupB = new AnimGroup(mixer, clipB);
        let aEnded = 0;
        let bEnded = 0;
        groupA.onEnded = () => aEnded++;
        groupB.onEnded = () => bEnded++;
        groupA.start(false);
        groupB.start(false);
        mixer.update(1.5); // a finished, b still going
        expect(aEnded).toBe(1);
        expect(bEnded).toBe(0);
    });

    it('dispose detaches the finished listener', () => {
        const { mixer, group } = makeRig();
        let ended = 0;
        group.onEnded = () => ended++;
        group.start(false);
        group.dispose();
        mixer.update(2);
        expect(ended).toBe(0);
    });
});
