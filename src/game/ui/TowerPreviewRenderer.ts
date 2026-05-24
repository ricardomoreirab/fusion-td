import { Scene, Vector3, ArcRotateCamera, HemisphericLight, RenderTargetTexture, Mesh, Color3, Color4 } from '@babylonjs/core';
import { Game } from '../Game';
import { Tower } from '../gameplay/towers/Tower';
import { getBaseTowers, getTowerDefinition, TowerDefinition } from '../gameplay/towers/TowerDefinitions';
import { TowerVisualBuilder } from '../gameplay/towers/TowerVisualBuilder';

export class TowerPreviewRenderer {
    private game: Game;
    private scene: Scene;
    private previews: Map<string, string> = new Map();
    private visualBuilder: TowerVisualBuilder;

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();
        this.visualBuilder = new TowerVisualBuilder(this.scene);
    }

    public async generateAll(): Promise<void> {
        const size = 128;

        const cam = new ArcRotateCamera('previewCam', -Math.PI / 4, 1.05, 8, Vector3.Zero(), this.scene);
        cam.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
        const orthoSize = 3.2;
        cam.orthoLeft = -orthoSize;
        cam.orthoRight = orthoSize;
        cam.orthoTop = orthoSize;
        cam.orthoBottom = -orthoSize;

        const light = new HemisphericLight('previewLight', new Vector3(0.3, 1, 0.5), this.scene);
        light.intensity = 1.2;
        light.diffuse = new Color3(1.0, 0.95, 0.88);
        light.groundColor = new Color3(0.45, 0.38, 0.32);

        // Generate previews for base towers
        const baseTowers = getBaseTowers();
        for (const def of baseTowers) {
            try {
                const dataUrl = await this.renderDefinitionPreview(def, cam, light, size);
                this.previews.set(def.id, dataUrl);
            } catch (e) {
                console.warn(`Failed to render preview for ${def.id}:`, e);
            }
        }

        light.dispose();
        cam.dispose();
    }

    /**
     * Generate a preview for a specific tower definition (for upgrade UI).
     */
    public async generatePreview(definitionId: string): Promise<string | undefined> {
        if (this.previews.has(definitionId)) {
            return this.previews.get(definitionId);
        }

        const def = getTowerDefinition(definitionId);
        if (!def) return undefined;

        const size = 128;
        const cam = new ArcRotateCamera('previewCam', -Math.PI / 4, 1.05, 8, Vector3.Zero(), this.scene);
        cam.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
        const orthoSize = 3.2;
        cam.orthoLeft = -orthoSize;
        cam.orthoRight = orthoSize;
        cam.orthoTop = orthoSize;
        cam.orthoBottom = -orthoSize;

        const light = new HemisphericLight('previewLight', new Vector3(0.3, 1, 0.5), this.scene);
        light.intensity = 1.2;

        try {
            const dataUrl = await this.renderDefinitionPreview(def, cam, light, size);
            this.previews.set(def.id, dataUrl);
            return dataUrl;
        } catch (e) {
            console.warn(`Failed to render preview for ${def.id}:`, e);
            return undefined;
        } finally {
            light.dispose();
            cam.dispose();
        }
    }

    private async renderDefinitionPreview(
        def: TowerDefinition,
        cam: ArcRotateCamera,
        light: HemisphericLight,
        size: number
    ): Promise<string> {
        // Build the tower mesh at origin using the visual builder
        const mesh = this.visualBuilder.build(def.visual, Vector3.Zero(), `preview_${def.id}`);

        const renderMeshes: Mesh[] = [];
        renderMeshes.push(mesh);
        mesh.getChildMeshes(false).forEach(child => {
            if (child instanceof Mesh) {
                renderMeshes.push(child);
            }
        });

        const rtt = new RenderTargetTexture(`rtt_${def.id}`, size, this.scene, false, true);
        rtt.activeCamera = cam;
        rtt.clearColor = new Color4(0, 0, 0, 0);
        renderMeshes.forEach(m => rtt.renderList!.push(m));

        rtt.render();

        const dataUrl = await new Promise<string>((resolve) => {
            rtt.readPixels(undefined, undefined, undefined, false)!.then((pixels) => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d')!;
                const imageData = ctx.createImageData(size, size);

                const buf = pixels as unknown as Uint8Array;
                for (let y = 0; y < size; y++) {
                    const srcRow = (size - 1 - y) * size * 4;
                    const dstRow = y * size * 4;
                    for (let x = 0; x < size * 4; x++) {
                        imageData.data[dstRow + x] = buf[srcRow + x];
                    }
                }

                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            });
        });

        rtt.dispose();
        mesh.dispose();

        return dataUrl;
    }

    public getDataUrl(towerId: string): string | undefined {
        return this.previews.get(towerId);
    }
}
