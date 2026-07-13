/**
 * ParticleSystem - CPU-simulated point-sprite particles with the exact
 * field surface and simulation semantics of the Babylon ParticleSystem
 * usage in this codebase, rendered as one THREE.Points (one draw call per
 * system).
 *
 * Simulation-time parity: Babylon advances particles by
 * `updateSpeed * animationRatio` per frame where animationRatio is
 * dt / (1/60s). All tuned lifetimes/emit rates in gameplay code assume
 * that scale, so tick() uses simDt = updateSpeed * dtSeconds * 60 for
 * aging, emission accrual, integration, and gravity. Do not "fix" this to
 * plain seconds - it would silently retime every effect in the game.
 *
 * Spawn semantics (Babylon parity):
 *   - start color = random lerp between color1 and color2, then fades
 *     toward colorDead over the particle's life
 *   - size, lifetime, emit power, angular speed = uniform random in range
 *   - spawn position = emitter world position + per-axis random inside
 *     [minEmitBox, maxEmitBox] (world axes)
 *   - direction = per-axis random lerp of direction1..direction2,
 *     scaled by emit power
 *   - manualEmitCount > -1 emits that many on the next tick then resets
 *     to 0 (burst mode; -1 = rate mode)
 */

import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    NormalBlending,
    Object3D,
    Points,
    ShaderMaterial,
    Texture,
    Vector3,
} from 'three';
import { RGBA } from '../math';
import type { SceneHost, SceneParticleSystem } from '../SceneHost';

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aAngle;
uniform float uViewportHeight;
varying vec4 vColor;
varying float vAngle;
void main() {
    vColor = aColor;
    vAngle = aAngle;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float scale = uViewportHeight * projectionMatrix[1][1] * 0.5;
    bool ortho = projectionMatrix[3][3] == 1.0;
    gl_PointSize = aSize * scale / (ortho ? 1.0 : max(0.0001, -mv.z));
    gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTexture;
uniform float uUseTexture;
varying vec4 vColor;
varying float vAngle;
void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 uv = vec2(c * centered.x - s * centered.y, s * centered.x + c * centered.y) + 0.5;
    vec4 tex = mix(
        // untextured: soft round falloff (a hard square reads as an artifact)
        vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.15, length(centered))),
        texture2D(uTexture, uv),
        uUseTexture
    );
    gl_FragColor = vColor * tex;
    if (gl_FragColor.a < 0.003) discard;
}
`;

/**
 * Shared viewport-height uniform value; RendererHost updates it on resize.
 * Uniform objects are per-material but all reference this mutable holder.
 */
const viewportHeight = { value: 1080 };

export function setParticleViewportHeight(h: number): void {
    viewportHeight.value = h;
}

const scratchEmitterPos = new Vector3();

export class ParticleSystem implements SceneParticleSystem {
    public static readonly BLENDMODE_STANDARD = 0;
    public static readonly BLENDMODE_ONEONE = 1;

    public minSize = 1;
    public maxSize = 1;
    public minLifeTime = 1;
    public maxLifeTime = 1;
    public minEmitPower = 1;
    public maxEmitPower = 1;
    public emitRate = 10;
    public updateSpeed = 0.01;
    public manualEmitCount = -1;
    public minAngularSpeed = 0;
    public maxAngularSpeed = 0;
    public blendMode: number = ParticleSystem.BLENDMODE_ONEONE;

    public readonly direction1 = new Vector3(0, 1, 0);
    public readonly direction2 = new Vector3(0, 1, 0);
    public readonly minEmitBox = new Vector3(0, 0, 0);
    public readonly maxEmitBox = new Vector3(0, 0, 0);
    public readonly gravity = new Vector3(0, 0, 0);

    public color1 = new RGBA(1, 1, 1, 1);
    public color2 = new RGBA(1, 1, 1, 1);
    public colorDead = new RGBA(0, 0, 0, 0);

    public emitter: Vector3 | Object3D | null = null;

    public readonly points: Points;

    private readonly capacity: number;
    private readonly host: SceneHost;
    private readonly material: ShaderMaterial;
    private readonly geometry: BufferGeometry;

    private readonly positions: Float32Array;
    private readonly colors: Float32Array;
    private readonly sizes: Float32Array;
    private readonly angles: Float32Array;

    private readonly velX: Float32Array;
    private readonly velY: Float32Array;
    private readonly velZ: Float32Array;
    private readonly age: Float32Array;
    private readonly life: Float32Array;
    private readonly angularSpeed: Float32Array;
    private readonly startColor: RGBA[];

    private liveCount = 0;
    private emitAccumulator = 0;
    private started = false;
    private disposed = false;
    private texture: Texture | null = null;

    constructor(public readonly name: string, capacity: number, host: SceneHost) {
        this.capacity = Math.max(1, capacity | 0);
        this.host = host;

        this.positions = new Float32Array(this.capacity * 3);
        this.colors = new Float32Array(this.capacity * 4);
        this.sizes = new Float32Array(this.capacity);
        this.angles = new Float32Array(this.capacity);
        this.velX = new Float32Array(this.capacity);
        this.velY = new Float32Array(this.capacity);
        this.velZ = new Float32Array(this.capacity);
        this.age = new Float32Array(this.capacity);
        this.life = new Float32Array(this.capacity);
        this.angularSpeed = new Float32Array(this.capacity);
        this.startColor = Array.from({ length: this.capacity }, () => new RGBA());

        this.geometry = new BufferGeometry();
        this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('aColor', new BufferAttribute(this.colors, 4));
        this.geometry.setAttribute('aSize', new BufferAttribute(this.sizes, 1));
        this.geometry.setAttribute('aAngle', new BufferAttribute(this.angles, 1));
        this.geometry.setDrawRange(0, 0);

        this.material = new ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
                uViewportHeight: viewportHeight,
                uTexture: { value: null },
                uUseTexture: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
        });

        this.points = new Points(this.geometry, this.material);
        this.points.name = name;
        this.points.frustumCulled = false;
        this.points.visible = false;
        host.scene.add(this.points);
        host.registerParticleSystem(this);
    }

    public get particleTexture(): Texture | null {
        return this.texture;
    }

    public set particleTexture(tex: Texture | null) {
        this.texture = tex;
        this.material.uniforms.uTexture.value = tex;
        this.material.uniforms.uUseTexture.value = tex ? 1 : 0;
    }

    public start(): void {
        if (this.disposed) return;
        this.started = true;
        this.points.visible = true;
    }

    /** Stop emitting; live particles finish their lifetimes. */
    public stop(): void {
        this.started = false;
        this.emitAccumulator = 0;
    }

    public isStarted(): boolean {
        return this.started;
    }

    /** Kill all live particles immediately (Babylon ps.reset()). */
    public reset(): void {
        this.liveCount = 0;
        this.emitAccumulator = 0;
        this.geometry.setDrawRange(0, 0);
    }

    public getLiveCount(): number {
        return this.liveCount;
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.started = false;
        this.host.unregisterParticleSystem(this);
        this.points.removeFromParent();
        this.geometry.dispose();
        this.material.dispose(); // texture is caller-owned (usually shared) - never disposed here
        this.onDispose?.();
    }

    /** Optional teardown hook (Babylon onDisposeObservable stand-in). */
    public onDispose: (() => void) | null = null;

    public tick(dtSeconds: number): void {
        if (this.disposed) return;
        const simDt = this.updateSpeed * dtSeconds * 60;
        if (simDt <= 0) return;

        // Age + integrate, compacting with swap-remove.
        let i = 0;
        while (i < this.liveCount) {
            this.age[i] += simDt;
            if (this.age[i] >= this.life[i]) {
                this.removeAt(i);
                continue;
            }
            this.velX[i] += this.gravity.x * simDt;
            this.velY[i] += this.gravity.y * simDt;
            this.velZ[i] += this.gravity.z * simDt;
            const p = i * 3;
            this.positions[p] += this.velX[i] * simDt;
            this.positions[p + 1] += this.velY[i] * simDt;
            this.positions[p + 2] += this.velZ[i] * simDt;
            this.angles[i] += this.angularSpeed[i] * simDt;

            const t = this.age[i] / this.life[i];
            const start = this.startColor[i];
            const c = i * 4;
            this.colors[c] = start.r + (this.colorDead.r - start.r) * t;
            this.colors[c + 1] = start.g + (this.colorDead.g - start.g) * t;
            this.colors[c + 2] = start.b + (this.colorDead.b - start.b) * t;
            this.colors[c + 3] = start.a + (this.colorDead.a - start.a) * t;
            i++;
        }

        // Emit.
        if (this.started && this.emitter) {
            let spawnCount: number;
            if (this.manualEmitCount > -1) {
                spawnCount = this.manualEmitCount;
                this.manualEmitCount = 0;
            } else {
                this.emitAccumulator += this.emitRate * simDt;
                spawnCount = Math.floor(this.emitAccumulator);
                this.emitAccumulator -= spawnCount;
            }
            for (let n = 0; n < spawnCount && this.liveCount < this.capacity; n++) {
                this.spawn();
            }
        }

        this.material.blending =
            this.blendMode === ParticleSystem.BLENDMODE_ONEONE ? AdditiveBlending : NormalBlending;

        this.geometry.setDrawRange(0, this.liveCount);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.aColor.needsUpdate = true;
        this.geometry.attributes.aSize.needsUpdate = true;
        this.geometry.attributes.aAngle.needsUpdate = true;
        this.points.visible = this.liveCount > 0 || this.started;
    }

    private emitterWorldPos(out: Vector3): Vector3 {
        if (this.emitter instanceof Vector3) return out.copy(this.emitter);
        if (this.emitter) return this.emitter.getWorldPosition(out);
        return out.set(0, 0, 0);
    }

    private spawn(): void {
        const i = this.liveCount++;
        const base = this.emitterWorldPos(scratchEmitterPos);
        const p = i * 3;
        this.positions[p] = base.x + lerp(this.minEmitBox.x, this.maxEmitBox.x, Math.random());
        this.positions[p + 1] = base.y + lerp(this.minEmitBox.y, this.maxEmitBox.y, Math.random());
        this.positions[p + 2] = base.z + lerp(this.minEmitBox.z, this.maxEmitBox.z, Math.random());

        const power = lerp(this.minEmitPower, this.maxEmitPower, Math.random());
        this.velX[i] = lerp(this.direction1.x, this.direction2.x, Math.random()) * power;
        this.velY[i] = lerp(this.direction1.y, this.direction2.y, Math.random()) * power;
        this.velZ[i] = lerp(this.direction1.z, this.direction2.z, Math.random()) * power;

        this.age[i] = 0;
        this.life[i] = lerp(this.minLifeTime, this.maxLifeTime, Math.random());
        this.sizes[i] = lerp(this.minSize, this.maxSize, Math.random());
        this.angles[i] = 0;
        this.angularSpeed[i] = lerp(this.minAngularSpeed, this.maxAngularSpeed, Math.random());

        this.startColor[i].lerpColors(this.color1, this.color2, Math.random());
        const c = i * 4;
        this.colors[c] = this.startColor[i].r;
        this.colors[c + 1] = this.startColor[i].g;
        this.colors[c + 2] = this.startColor[i].b;
        this.colors[c + 3] = this.startColor[i].a;
    }

    private removeAt(i: number): void {
        const last = --this.liveCount;
        if (i !== last) {
            const pi = i * 3;
            const pl = last * 3;
            this.positions[pi] = this.positions[pl];
            this.positions[pi + 1] = this.positions[pl + 1];
            this.positions[pi + 2] = this.positions[pl + 2];
            const ci = i * 4;
            const cl = last * 4;
            this.colors[ci] = this.colors[cl];
            this.colors[ci + 1] = this.colors[cl + 1];
            this.colors[ci + 2] = this.colors[cl + 2];
            this.colors[ci + 3] = this.colors[cl + 3];
            this.sizes[i] = this.sizes[last];
            this.angles[i] = this.angles[last];
            this.velX[i] = this.velX[last];
            this.velY[i] = this.velY[last];
            this.velZ[i] = this.velZ[last];
            this.age[i] = this.age[last];
            this.life[i] = this.life[last];
            this.angularSpeed[i] = this.angularSpeed[last];
            this.startColor[i].copy(this.startColor[last]);
        }
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
