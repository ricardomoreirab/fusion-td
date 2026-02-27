import { Scene, Vector3, ArcRotateCamera, HemisphericLight, RenderTargetTexture, Mesh, Color3, Color4 } from '@babylonjs/core';
import { Game } from '../Game';
import { BasicTower } from '../gameplay/towers/BasicTower';
import { FastTower } from '../gameplay/towers/FastTower';
import { HeavyTower } from '../gameplay/towers/HeavyTower';
import { SniperTower } from '../gameplay/towers/SniperTower';
import { AOETower } from '../gameplay/towers/AOETower';
import { FireTower } from '../gameplay/towers/FireTower';
import { WaterTower } from '../gameplay/towers/WaterTower';
import { WindTower } from '../gameplay/towers/WindTower';
import { EarthTower } from '../gameplay/towers/EarthTower';
import { Tower } from '../gameplay/towers/Tower';

const TOWER_CLASSES: Record<string, new (game: Game, position: Vector3) => Tower> = {
    basicTower: BasicTower,
    fastTower: FastTower,
    heavyTower: HeavyTower,
    sniperTower: SniperTower,
    aoeTower: AOETower,
    fireTower: FireTower,
    waterTower: WaterTower,
    windTower: WindTower,
    earthTower: EarthTower,
};

export class TowerPreviewRenderer {
    private game: Game;
    private scene: Scene;
    private previews: Map<string, string> = new Map();

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();
    }

    public async generateAll(): Promise<void> {
        const size = 128;

        // Create a dedicated camera for rendering previews
        const cam = new ArcRotateCamera('previewCam', -Math.PI / 4, 1.05, 8, Vector3.Zero(), this.scene);
        cam.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
        const orthoSize = 3.2;
        cam.orthoLeft = -orthoSize;
        cam.orthoRight = orthoSize;
        cam.orthoTop = orthoSize;
        cam.orthoBottom = -orthoSize;

        // Dedicated light
        const light = new HemisphericLight('previewLight', new Vector3(0.3, 1, 0.5), this.scene);
        light.intensity = 1.2;
        light.diffuse = new Color3(1.0, 0.95, 0.88);
        light.groundColor = new Color3(0.45, 0.38, 0.32);

        for (const [id, TowerClass] of Object.entries(TOWER_CLASSES)) {
            try {
                const dataUrl = await this.renderTowerPreview(id, TowerClass, cam, light, size);
                this.previews.set(id, dataUrl);
            } catch (e) {
                console.warn(`Failed to render preview for ${id}:`, e);
            }
        }

        // Cleanup
        light.dispose();
        cam.dispose();
    }

    private async renderTowerPreview(
        id: string,
        TowerClass: new (game: Game, position: Vector3) => Tower,
        cam: ArcRotateCamera,
        light: HemisphericLight,
        size: number
    ): Promise<string> {
        // Position tower at origin
        const tower = new TowerClass(this.game, new Vector3(0, 0, 0));
        const mesh = tower.getMesh();

        // Collect all descendant meshes for the RTT render list
        const renderMeshes: Mesh[] = [];
        if (mesh) {
            renderMeshes.push(mesh);
            mesh.getChildMeshes(false).forEach(child => {
                if (child instanceof Mesh) {
                    renderMeshes.push(child);
                }
            });
        }

        // Create RTT
        const rtt = new RenderTargetTexture(`rtt_${id}`, size, this.scene, false, true);
        rtt.activeCamera = cam;
        rtt.clearColor = new Color4(0, 0, 0, 0);
        renderMeshes.forEach(m => rtt.renderList!.push(m));

        // Render one frame
        rtt.render();

        // Read pixels
        const dataUrl = await new Promise<string>((resolve) => {
            rtt.readPixels(undefined, undefined, undefined, false)!.then((pixels) => {
                // Create canvas for conversion
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d')!;
                const imageData = ctx.createImageData(size, size);

                // RTT pixels are RGBA bottom-to-top; flip vertically
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

        // Cleanup
        rtt.dispose();
        tower.dispose();

        return dataUrl;
    }

    public getDataUrl(towerId: string): string | undefined {
        return this.previews.get(towerId);
    }
}
