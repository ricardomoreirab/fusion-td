/**
 * AnimGroup - Babylon AnimationGroup's used surface (start(loop) / stop /
 * reset / isPlaying / speedRatio / onEnded) over a THREE.AnimationAction.
 *
 * One AnimGroup per clip per model instance, all sharing the instance's
 * AnimationMixer (owned by the ContainerInstance from assets.ts, which
 * also drives mixer.update on the SceneHost animation bus - so groups
 * freeze when animationsEnabled is false, like Babylon animatables).
 *
 * Non-looping playback clamps on the final frame (Babylon behavior the
 * death animations rely on).
 */

import { AnimationAction, AnimationClip, AnimationMixer, LoopOnce, LoopRepeat } from 'three';

export class AnimGroup {
    public readonly name: string;
    private readonly action: AnimationAction;

    /** Fired once each time a non-looping play reaches its end. */
    public onEnded: (() => void) | null = null;

    private readonly finishListener: (e: { action: AnimationAction }) => void;

    constructor(
        private readonly mixer: AnimationMixer,
        public readonly clip: AnimationClip,
    ) {
        this.name = clip.name;
        this.action = mixer.clipAction(clip);
        this.finishListener = e => {
            if (e.action === this.action) this.onEnded?.();
        };
        mixer.addEventListener('finished', this.finishListener as never);
    }

    public start(loop: boolean): void {
        this.action.reset();
        this.action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
        this.action.clampWhenFinished = !loop;
        this.action.paused = false;
        this.action.setEffectiveWeight(1);
        this.action.play();
    }

    /** Start this clip from frame 0 cross-fading from `prev` over `fadeSec`
     *  (both actions share the instance's mixer, so THREE blends the poses).
     *  `prev === null`, `prev === this`, or a stopped `prev` → hard start,
     *  same as start(). Replaces the stop()-then-start() hard cut for
     *  locomotion/attack/cast transitions. */
    public crossFrom(prev: AnimGroup | null, fadeSec: number, loop: boolean): void {
        this.action.reset();
        this.action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
        this.action.clampWhenFinished = !loop;
        this.action.paused = false;
        this.action.enabled = true;
        this.action.setEffectiveWeight(1);
        this.action.play();
        if (prev && prev !== this && prev.action.isRunning()) {
            // Fades prev's weight 1→0 and this action's 0→1 over fadeSec.
            this.action.crossFadeFrom(prev.action, fadeSec, false);
        }
    }

    public stop(): void {
        this.action.stop();
    }

    /** Rewind to the first frame without changing play state (Babylon reset()). */
    public reset(): void {
        this.action.time = 0;
    }

    public get isPlaying(): boolean {
        return this.action.isRunning();
    }

    public get speedRatio(): number {
        return this.action.timeScale;
    }

    public set speedRatio(v: number) {
        this.action.timeScale = v;
    }

    /** Blend weight of this clip in the mixer's pose sum (0 = contributes nothing).
     *  Reading it returns the EFFECTIVE weight, so a clip mid-cross-fade reports
     *  its current partial contribution rather than its target. */
    public get weight(): number {
        return this.action.getEffectiveWeight();
    }

    /** Pin the blend weight, cancelling any in-flight fade. Without stopFading()
     *  THREE's fade interpolant overwrites the weight again on the next mixer
     *  update, so a plain setEffectiveWeight() during a cross-fade is a no-op. */
    public set weight(v: number) {
        this.action.stopFading();
        this.action.setEffectiveWeight(v);
    }

    /** Resume playback WITHOUT rewinding to frame 0 — used to bring a clip that
     *  faded out back into the blend mid-cycle (start()/crossFrom() both reset
     *  time, which would restart a locomotion cycle from the same pose forever). */
    public resume(loop: boolean): void {
        this.action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
        this.action.clampWhenFinished = !loop;
        this.action.paused = false;
        this.action.enabled = true;
        this.action.play();
    }

    /** Seconds duration of the underlying clip. */
    public get duration(): number {
        return this.clip.duration;
    }

    public dispose(): void {
        this.mixer.removeEventListener('finished', this.finishListener as never);
        this.action.stop();
    }
}
