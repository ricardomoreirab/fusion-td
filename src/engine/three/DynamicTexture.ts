/**
 * DynamicTexture - canvas-backed texture with Babylon DynamicTexture's
 * used surface (getContext / update / dispose). Callers draw with the 2D
 * context and call update() to upload. Browser-only (needs a canvas).
 */

import { CanvasTexture, SRGBColorSpace } from 'three';

export class DynamicTexture {
    public readonly canvas: HTMLCanvasElement;
    public readonly texture: CanvasTexture;

    constructor(public readonly name: string, size: { width: number; height: number }) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = size.width;
        this.canvas.height = size.height;
        this.texture = new CanvasTexture(this.canvas);
        this.texture.colorSpace = SRGBColorSpace;
        this.texture.name = name;
    }

    public getContext(): CanvasRenderingContext2D {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error(`DynamicTexture ${this.name}: 2d context unavailable`);
        return ctx;
    }

    public get width(): number {
        return this.canvas.width;
    }

    public get height(): number {
        return this.canvas.height;
    }

    /** Upload the current canvas contents to the GPU on next use. */
    public update(): void {
        this.texture.needsUpdate = true;
    }

    public dispose(): void {
        this.texture.dispose();
    }
}
