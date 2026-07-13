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
        this.action.play();
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

    /** Seconds duration of the underlying clip. */
    public get duration(): number {
        return this.clip.duration;
    }

    public dispose(): void {
        this.mixer.removeEventListener('finished', this.finishListener as never);
        this.action.stop();
    }
}
