/**
 * ParticleEffect - thin SceneHost-aware wrapper around
 * @newkrok/three-particles' createParticleSystem, replacing the old
 * hand-rolled ParticleSystem class.
 *
 * The library drives its own simulation off a caller-supplied millisecond
 * clock (externalNow at creation, then `now` on every update() call - NOT
 * Date.now()). Each ParticleEffect owns a synthetic clock seeded at
 * creation and advanced by tick(dt) so headless SceneHost.tick(dt) drives
 * it deterministically, exactly like the rest of the engine/three layer.
 */

import { AdditiveBlending, DataTexture, NormalBlending, type Object3D, RGBAFormat, Texture, Vector3 } from 'three';
import {
    createParticleSystem,
    type ParticleSystemConfig,
    type ParticleSystem as LibParticleSystem,
    type Renderer as LibRenderer,
} from '@newkrok/three-particles';
import type { SceneHost, SceneParticleSystem } from '../SceneHost';

/**
 * Converts a world-unit particle size to the library's point-size scale.
 * The lib shader computes gl_PointSize = size * 100 / distance; the game
 * camera (fov 0.55 rad, ~1080p) needs ~x19 to reproduce the former
 * world-unit sizing used by the old ParticleSystem class.
 */
export function fxSize(worldUnits: number): number {
    return worldUnits * 19;
}

/** Full Renderer config for either blend mode; all 7 base fields are required by the lib's type. */
export function fxRenderer(blending: 'additive' | 'normal'): LibRenderer {
    return {
        blending: blending === 'additive' ? AdditiveBlending : NormalBlending,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        discardBackgroundColor: false,
        backgroundColorTolerance: 1,
        backgroundColor: { r: 0, g: 0, b: 0 },
    };
}

let softParticleTexture: Texture | null = null;

/** Shared soft-circle sprite texture (cached, never disposed). Headless-safe: no document -> 1x1 DataTexture. */
export function getSoftParticleTexture(): Texture {
    if (softParticleTexture) return softParticleTexture;

    if (typeof document === 'undefined') {
        const data = new Uint8Array([255, 255, 255, 255]);
        const tex = new DataTexture(data, 1, 1, RGBAFormat);
        tex.needsUpdate = true;
        softParticleTexture = tex;
        return softParticleTexture;
    }

    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        const data = new Uint8Array([255, 255, 255, 255]);
        const tex = new DataTexture(data, 1, 1, RGBAFormat);
        tex.needsUpdate = true;
        softParticleTexture = tex;
        return softParticleTexture;
    }
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const tex = new Texture(canvas);
    tex.needsUpdate = true;
    softParticleTexture = tex;
    return softParticleTexture;
}

export interface ParticleEffectOptions {
    /** Parent object the instance is added under. Defaults to the scene root. */
    parent?: Object3D;
    /**
     * Track this object's WORLD POSITION each tick without parenting (old
     * `ps.emitter = mesh` semantics). Use instead of `parent` for emitters
     * inside scaled/rotated hierarchies (GLB rigs, elite-scaled enemies) -
     * the lib multiplies emission offsets by the emitter's world scale, so
     * parenting there inflates the whole effect.
     */
    follow?: Object3D;
    /** Dispose automatically once a non-looping system completes its iteration. */
    autoDispose?: boolean;
    /** Create with the emitter paused; call start() to resume. */
    startPaused?: boolean;
}

export class ParticleEffect implements SceneParticleSystem {
    /** The library's THREE.Points/Mesh instance - exposed for positioning and scene queries. */
    public readonly object: Object3D;

    /** Optional teardown hook (parity with the old ParticleSystem.onDispose). */
    public onDispose: (() => void) | null = null;

    private readonly host: SceneHost;
    private readonly handle: LibParticleSystem;
    private readonly autoDispose: boolean;
    private readonly follow: Object3D | null;
    private readonly followOffset: Vector3 | null;

    private nowMs = 1;
    private elapsed = 0;
    private completed = false;
    private disposed = false;

    constructor(
        public readonly name: string,
        host: SceneHost,
        config: ParticleSystemConfig,
        opts: ParticleEffectOptions = {}
    ) {
        this.host = host;
        this.autoDispose = opts.autoDispose ?? false;

        config.map ??= getSoftParticleTexture();
        const userOnComplete = config.onComplete;
        config.onComplete = () => {
            if (this.autoDispose) this.completed = true;
            userOnComplete?.();
        };

        this.handle = createParticleSystem(config, this.nowMs);
        this.object = this.handle.instance;
        this.object.name = name;
        this.follow = opts.follow ?? null;
        this.followOffset = this.follow ? this.object.position.clone() : null;
        (opts.parent ?? host.scene).add(this.object);
        if (this.follow) this.syncFollow();
        host.registerParticleSystem(this);

        if (opts.startPaused) this.handle.pauseEmitter();
    }

    /** Resumes emission after stop() (old ps.start() restart semantics). */
    public start(): void {
        if (this.disposed) return;
        this.handle.resumeEmitter();
    }

    /** Stops emission; live particles finish their lifetimes. Safe after dispose(). */
    public stop(): void {
        if (this.disposed) return;
        this.handle.pauseEmitter();
    }

    public tick(dtSeconds: number): void {
        if (this.disposed) return;
        if (this.completed) {
            this.dispose();
            return;
        }
        if (this.follow) this.syncFollow();
        this.nowMs += dtSeconds * 1000;
        this.elapsed += dtSeconds;
        this.handle.update({ now: this.nowMs, delta: dtSeconds, elapsed: this.elapsed });
    }

    private syncFollow(): void {
        this.follow!.getWorldPosition(this.object.position);
        if (this.followOffset) this.object.position.add(this.followOffset);
        this.object.updateMatrix();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.host.unregisterParticleSystem(this);
        this.handle.dispose();
        this.onDispose?.();
    }
}
