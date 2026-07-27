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

    it('crossFrom(null) hard-starts from frame 0', () => {
        const { root, mixer, group } = makeRig();
        group.crossFrom(null, 0.2, false);
        expect(group.isPlaying).toBe(true);
        mixer.update(0.5);
        expect(root.position.x).toBeCloseTo(5);
    });

    it('crossFrom blends: both actions run during the fade, blend resolves to the new clip', () => {
        const root = new Object3D();
        const mixer = new AnimationMixer(root);
        // Clip A holds x at 10; clip B holds x at 0 — the blended value exposes the weights.
        const clipA = new AnimationClip('a', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [10, 10])]);
        const clipB = new AnimationClip('b', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
        const groupA = new AnimGroup(mixer, clipA);
        const groupB = new AnimGroup(mixer, clipB);
        groupA.start(true);
        mixer.update(0.1);
        expect(root.position.x).toBeCloseTo(10);

        groupB.crossFrom(groupA, 0.2, true);
        mixer.update(0.1); // mid-fade: both contribute
        expect(groupA.isPlaying).toBe(true);
        expect(groupB.isPlaying).toBe(true);
        expect(root.position.x).toBeGreaterThan(0.5);
        expect(root.position.x).toBeLessThan(9.5);

        mixer.update(0.3); // fade complete
        expect(root.position.x).toBeCloseTo(0, 1); // fully the new clip
    });

    it('crossFrom from a stopped prev still starts cleanly', () => {
        const { root, mixer, group } = makeRig();
        const other = makeRig();
        other.group.stop();
        group.crossFrom(other.group, 0.2, false);
        mixer.update(0.5);
        expect(root.position.x).toBeCloseTo(5);
    });

    it('crossFrom(self) restarts the clip from frame 0', () => {
        const { root, mixer, group } = makeRig();
        group.start(false);
        mixer.update(0.8);
        group.crossFrom(group, 0.2, false);
        mixer.update(0.1);
        expect(root.position.x).toBeCloseTo(1);
    });

    it('crossFrom non-looping still clamps and fires onEnded', () => {
        const { mixer, group } = makeRig();
        let ended = 0;
        group.onEnded = () => ended++;
        group.crossFrom(null, 0.1, false);
        mixer.update(1.5);
        expect(ended).toBe(1);
        expect(group.isPlaying).toBe(false);
    });

    it('weight = 0 mutes a clip but keeps it ticking', () => {
        const { root, mixer, group } = makeRig();
        group.start(true);
        group.weight = 0;
        mixer.update(0.5);
        expect(root.position.x).toBe(0); // contributed nothing
        group.weight = 1;
        mixer.update(0); // no time passes — read the pose it was silently holding
        expect(root.position.x).toBeCloseTo(5);
    });

    it('crossFrom rewinds the incoming clip to frame 0', () => {
        // Documented because it is the trap behind the champion's shuffling run:
        // the rig hands locomotion between the full run clip and its lower-body
        // half twice per swing, and each hand-off restarted the stride.
        const { root, mixer, group } = makeRig();
        const other = makeRig();
        group.start(true);
        mixer.update(0.8);
        expect(group.time).toBeCloseTo(0.8);
        group.crossFrom(other.group, 0.1, true);
        expect(group.time).toBe(0);
        mixer.update(0.1);
        expect(root.position.x).toBeCloseTo(1); // 0.1s in, not 0.9s in
    });

    it('time is writable, so a cycle can be handed to an equivalent clip in phase', () => {
        const root = new Object3D();
        const mixer = new AnimationMixer(root);
        // Two representations of ONE cycle: same duration, same curve.
        const full = new AnimationClip('run', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 10])]);
        const half = new AnimationClip('run__lower', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 10])]);
        const a = new AnimGroup(mixer, full);
        const b = new AnimGroup(mixer, half);
        a.start(true);
        mixer.update(0.7);
        expect(a.time).toBeCloseTo(0.7);

        const phase = a.time;
        b.crossFrom(a, 0, true);
        b.time = phase; // the hand-off: carry the stride's phase across
        expect(b.time).toBeCloseTo(0.7);
        mixer.update(0.1);
        expect(b.time).toBeCloseTo(0.8); // continued the stride, did not restart it
    });

    it('two clips at weight 1 on the same track AVERAGE — why combat layers must be disjoint', () => {
        // The bug behind the champion's half-height stride: the full-body attack
        // and the lower-body run both drove the legs, so the stride came out at
        // half amplitude. There is no bone mask to prevent this; the only fix is
        // for one of the two to leave the blend.
        const root = new Object3D();
        const mixer = new AnimationMixer(root);
        const stride = new AnimationClip('stride', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [10, 10])]);
        const rooted = new AnimationClip('rooted', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
        const legs = new AnimGroup(mixer, stride);
        const swing = new AnimGroup(mixer, rooted);
        legs.start(true);
        swing.start(true);
        mixer.update(0.1);
        expect(root.position.x).toBeCloseTo(5); // half stride, not 10

        swing.weight = 0; // the fix: the full-body copy leaves the blend
        mixer.update(0.1);
        expect(root.position.x).toBeCloseTo(10);
    });

    it('negative speedRatio runs a looping clip backwards', () => {
        // The backpedal: no rig ships a reverse-run clip, so the locomotion cycle
        // is time-scaled negative instead.
        const { root, mixer, group } = makeRig();
        group.start(true);
        mixer.update(0.5);
        expect(root.position.x).toBeCloseTo(5);
        group.speedRatio = -1;
        mixer.update(0.2);
        expect(root.position.x).toBeCloseTo(3);
        mixer.update(0.5); // wraps past 0 back around the loop
        expect(group.isPlaying).toBe(true);
        expect(root.position.x).toBeCloseTo(8);
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
