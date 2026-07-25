/**
 * RendererHost - the browser-side half of the engine: WebGLRenderer +
 * the postprocessing composer (bloom + ACES tone mapping + FXAA).
 *
 * Owns nothing about the frame LOOP - Game keeps its single permanent
 * loop and calls render(dt). Context-loss events are surfaced as plain
 * callbacks for Game's recovery/watchdog wiring.
 *
 * Glow contract: the chain is HDR (half-float) end to end, so anything whose
 * emissive pushes it past the bloom threshold blooms on its own. That is the
 * whole mechanism - there is no second, selective pass.
 *
 * There USED to be one: a SelectiveBloomEffect over GLOW_LAYER, ported from
 * Babylon's GlowLayer. It cost a FULL EXTRA SCENE RENDER every frame (the
 * effect re-renders the scene through a layer-filtered camera), which measured
 * at ~40% of all render-thread CPU once a horde was on the field - to make loot
 * orbs glow, the only thing that ever called markGlowing(). Emissive over the
 * bloom threshold gets the same read for free. Do not reintroduce it.
 */

import { Camera, HalfFloatType, PCFShadowMap, Scene, WebGLRenderer } from 'three';
import {
    BloomEffect,
    EffectComposer,
    EffectPass,
    FXAAEffect,
    RenderPass,
    ToneMappingEffect,
    ToneMappingMode,
} from 'postprocessing';

/** Layer index formerly blooms-only; kept so markGlowing() stays a meaningful
 *  tag for "this material is authored bright enough to bloom". */
export const GLOW_LAYER = 11;

export class RendererHost {
    public readonly renderer: WebGLRenderer;

    private readonly composer: EffectComposer;
    private readonly bloom: BloomEffect;

    private baseBloomIntensity = 1;
    private maxPixelRatio = 2;

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
        // ACES filmic tone mapping: the HDR half-float chain would otherwise
        // hit the screen linearly, which reads flat and washed out (the
        // Babylon-era "full bright" look). ACES deepens shadow tones and rolls
        // off highlights so the warm key light actually models form.
        // NO vignette: over the bright uniform survivors field even a subtle
        // screen-space corner darkening (tried 0.55, then 0.35) reads as a
        // "halo of shadow" ellipse stamped on top of the game, not as focus.
        const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
        this.composer.addPass(new EffectPass(camera, this.bloom, toneMapping, new FXAAEffect()));

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
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);
    }

    /** Late-wave quality ratchet (Babylon setPostFxReduced parity). */
    public setPostFxReduced(reduced: boolean): void {
        this.bloom.intensity = reduced ? this.baseBloomIntensity * 0.5 : this.baseBloomIntensity;
    }

    /**
     * Resolution scale for the whole chain. The post passes are per-pixel, so on
     * a HiDPI display the default ratio of 2 puts ~6.4 MP through the bloom
     * mip chain every frame; 1.5 is ~44% fewer pixels for a difference FXAA
     * largely absorbs. Clamped to something still legible.
     */
    public setResolutionScale(maxPixelRatio: number): void {
        this.maxPixelRatio = Math.max(0.75, Math.min(maxPixelRatio, 2));
        this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
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
