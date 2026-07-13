/**
 * tween.ts - minimal duration tweens on the SceneHost animation bus,
 * replacing every `new Animation(...)` + `scene.beginAnimation(...)` site
 * (all of which are simple expand/fade/rise property ramps).
 *
 * Runs on onAnimUpdate, so tweens freeze while animationsEnabled is false
 * (Babylon animatable pause parity). The update callback receives eased
 * t in [0, 1]; the call site applies it to whatever properties it likes.
 * Babylon frame counts convert as seconds = frames / 30.
 */

import type { SceneHost, UpdateToken } from './SceneHost';

export interface TweenOptions {
    onEnd?: () => void;
    loop?: boolean;
    /** Easing applied to linear progress; default linear. */
    ease?: (t: number) => number;
}

export interface TweenHandle {
    /** Cancel without firing onEnd. */
    stop(): void;
}

export function tween(
    host: SceneHost,
    durationSeconds: number,
    onUpdate: (t: number) => void,
    opts: TweenOptions = {},
): TweenHandle {
    let elapsed = 0;
    let token: UpdateToken | null = null;

    const finish = (): void => {
        host.onAnimUpdate.remove(token);
        token = null;
    };

    if (durationSeconds <= 0) {
        onUpdate(1);
        opts.onEnd?.();
        return { stop: () => undefined };
    }

    token = host.onAnimUpdate.add(() => {
        elapsed += host.deltaSeconds;
        let t = elapsed / durationSeconds;
        if (t >= 1) {
            if (opts.loop) {
                elapsed = elapsed % durationSeconds;
                t = elapsed / durationSeconds;
            } else {
                onUpdate(opts.ease ? opts.ease(1) : 1);
                finish();
                opts.onEnd?.();
                return;
            }
        }
        onUpdate(opts.ease ? opts.ease(t) : t);
    });

    return { stop: finish };
}
