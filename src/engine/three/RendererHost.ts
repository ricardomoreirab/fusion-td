/**
 * RendererHost - the browser-side half of the engine: WebGLRenderer +
 * the postprocessing composer (FXAA + bloom + emissive-only selective
 * bloom = Babylon DefaultRenderingPipeline + GlowLayer parity).
 *
 * Owns nothing about the frame LOOP - Game keeps its single permanent
 * loop and calls render(dt). Context-loss events are surfaced as plain
 * callbacks for Game's recovery/watchdog wiring.
 *
 * Glow contract: meshes marked via markGlowing() (LowPolyMaterial) enable
 * GLOW_LAYER on their layer mask; the SelectiveBloomEffect blooms exactly
 * that layer, replicating Babylon GlowLayer's emissive-only glow.
 */

import { Camera, HalfFloatType, PCFShadowMap, Scene, WebGLRenderer } from 'three';
import {
    BloomEffect,
    EffectComposer,
    EffectPass,
    FXAAEffect,
    RenderPass,
    SelectiveBloomEffect,
    ToneMappingEffect,
    ToneMappingMode,
    VignetteEffect,
} from 'postprocessing';
import { setParticleViewportHeight } from './particles/ParticleSystem';

/** Layer index reserved for emissive-glow meshes (Babylon GlowLayer parity). */
export const GLOW_LAYER = 11;

export class RendererHost {
    public readonly renderer: WebGLRenderer;

    private readonly composer: EffectComposer;
    private readonly bloom: BloomEffect;
    private readonly glow: SelectiveBloomEffect;

    private baseBloomIntensity = 1;
    private baseGlowIntensity = 0.4;

    public onContextLost: (() => void) | null = null;
    public onContextRestored: (() => void) | null = null;

    constructor(
        public readonly canvas: HTMLCanvasElement,
        scene: Scene,
        camera: Camera,
    ) {
        // FXAA is the AA (Babylon ran samples=1 + FXAA), so no MSAA here.
        this.renderer = new WebGLRenderer({
            canvas,
            antialias: false,
            stencil: false,
            powerPreference: 'high-performance',
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFShadowMap;

        this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
        this.composer.addPass(new RenderPass(scene, camera));

        this.bloom = new BloomEffect({
            luminanceThreshold: 0.85,
            intensity: this.baseBloomIntensity,
            mipmapBlur: true,
        });
        this.glow = new SelectiveBloomEffect(scene, camera, {
            luminanceThreshold: 0,
            intensity: this.baseGlowIntensity,
            mipmapBlur: true,
        });
        this.glow.ignoreBackground = true;
        this.glow.selection.layer = GLOW_LAYER;

        // ACES filmic tone mapping: the HDR half-float chain would otherwise
        // hit the screen linearly, which reads flat and washed out (the
        // Babylon-era "full bright" look). ACES deepens shadow tones and rolls
        // off highlights so the warm key light actually models form. The
        // subtle vignette pulls focus to the hero without reading as an effect.
        const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
        // Kept subtle: at 0.55 the darkened corners formed a readable ellipse
        // over the bright survivors field — players saw "a circle on the UI".
        const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.35 });
        this.composer.addPass(new EffectPass(camera, this.bloom, this.glow, toneMapping, vignette, new FXAAEffect()));

        canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault(); // required by the WebGL spec for restoration
            this.onContextLost?.();
        });
        canvas.addEventListener('webglcontextrestored', () => {
            this.onContextRestored?.();
        });
    }

    /** Swap the active camera (menu ortho <-> gameplay perspective). */
    public setCamera(camera: Camera): void {
        this.composer.setMainCamera(camera);
    }

    public render(deltaSeconds: number): void {
        this.composer.render(deltaSeconds);
    }

    public resize(width: number, height: number): void {
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);
        setParticleViewportHeight(height);
    }

    /** Late-wave quality ratchet (Babylon setPostFxReduced parity). */
    public setPostFxReduced(reduced: boolean): void {
        this.bloom.intensity = reduced ? this.baseBloomIntensity * 0.5 : this.baseBloomIntensity;
        this.glow.intensity = reduced ? this.baseGlowIntensity * 0.5 : this.baseGlowIntensity;
    }

    public configureBloom(threshold: number, intensity: number): void {
        this.bloom.luminanceMaterial.threshold = threshold;
        this.baseBloomIntensity = intensity;
        this.bloom.intensity = intensity;
    }

    /** GPU-truth resource counters for the leak watchdog. */
    public get info(): { geometries: number; textures: number; programs: number; drawCalls: number } {
        const info = this.renderer.info;
        return {
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            programs: info.programs?.length ?? 0,
            drawCalls: info.render.calls,
        };
    }

    public isContextLost(): boolean {
        return this.renderer.getContext().isContextLost();
    }

    public dispose(): void {
        this.composer.dispose();
        this.renderer.dispose();
    }
}
