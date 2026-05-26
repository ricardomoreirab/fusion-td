import { Scene, Mesh, MeshBuilder, StandardMaterial, Texture } from '@babylonjs/core';
import { GrassProceduralTexture } from '@babylonjs/procedural-textures/grass/grassProceduralTexture';

/**
 * Minimal arena for survivors mode: a single flat circular ground disc.
 *
 * Replaces the heavyweight TD-era `Map` class — survivors doesn't need a
 * grid, paths, portals, river, decorations, or particles. The ground uses
 * Babylon's built-in `GrassProceduralTexture` for the surface — that's the
 * recommended way to render large procedural grass areas in Babylon.
 */
export class SurvivorsArena {
    public readonly radius: number;
    private ground: Mesh;
    private grassTexture: GrassProceduralTexture;
    private grassMaterial: StandardMaterial;

    constructor(scene: Scene, radius: number = 25) {
        this.radius = radius;

        const ground = MeshBuilder.CreateDisc('arenaGround', { radius, tessellation: 64 }, scene);
        ground.rotation.x = Math.PI / 2;
        ground.position.y = -0.01;

        // Babylon's built-in procedural grass texture — generates a tileable
        // grass pattern on the GPU. 256² is a good balance of detail vs. cost.
        this.grassTexture = new GrassProceduralTexture('grassTex', 256, scene);
        // Tile the grass texture across the large disc.
        this.grassTexture.uScale = radius * 0.5;
        this.grassTexture.vScale = radius * 0.5;
        this.grassTexture.wrapU = Texture.WRAP_ADDRESSMODE;
        this.grassTexture.wrapV = Texture.WRAP_ADDRESSMODE;

        this.grassMaterial = new StandardMaterial('grassMat', scene);
        this.grassMaterial.diffuseTexture = this.grassTexture;
        this.grassMaterial.specularColor.set(0, 0, 0);
        // No emissive — emissive is unlit and masks shadows. Brighten the
        // ambient contribution instead so the ground stays readable.
        this.grassMaterial.ambientColor.set(0.55, 0.55, 0.55);
        this.grassMaterial.maxSimultaneousLights = 8;

        // Set receiveShadows BEFORE the material is assigned/compiled. The
        // scene has blockMaterialDirtyMechanism = true (perf flag), so flipping
        // receiveShadows later wouldn't re-prepare the shader with shadow
        // includes — the ground would render shadow-blind.
        ground.receiveShadows = true;

        ground.material = this.grassMaterial;
        ground.alwaysSelectAsActiveMesh = true;
        ground.freezeWorldMatrix();
        this.ground = ground;
    }

    public getArenaRadius(): number {
        return this.radius;
    }

    public dispose(): void {
        this.ground.dispose();
        this.grassMaterial.dispose();
        this.grassTexture.dispose();
    }
}
