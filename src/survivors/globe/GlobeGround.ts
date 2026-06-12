import { Scene, Mesh, MeshBuilder, StandardMaterial, Texture, VertexBuffer } from '@babylonjs/core';
import { GrassProceduralTexture } from '@babylonjs/procedural-textures/grass/grassProceduralTexture';
import { VISIBLE_TERRAIN_RADIUS } from './constants';
import { curveDrop } from './curvature';

const SUBDIVISIONS = 48;
/** Texture repeats across the cap — keeps the same texel density as the old
 *  25-radius disc (which used uScale = radius * 0.5 = 12.5 over 50 units). */
const TEX_TILES = VISIBLE_TERRAIN_RADIUS * 0.5;

/**
 * Infinite-map ground: a square cap, pre-curved so the terrain bends down
 * toward the horizon (globe illusion), that follows the hero every frame.
 * The curve is radially symmetric, so the cap never rotates or re-bakes —
 * the texture UV-scrolls by hero position so the terrain appears to slide
 * underneath while the cap itself stays centred on screen.
 *
 * Replaces the bounded SurvivorsArena disc (deleted with the infinite-map
 * feature — see docs/superpowers/specs/2026-06-12-infinite-globe-map-design.md).
 */
export class GlobeGround {
    private ground: Mesh;
    private grassTexture: GrassProceduralTexture;
    private grassMaterial: StandardMaterial;

    constructor(scene: Scene) {
        const size = VISIBLE_TERRAIN_RADIUS * 2;
        // Name must keep the 'arenaGround' prefix — applyRuinsAmbience's
        // receiveShadows loop and the resource-watchdog buckets match on it.
        const ground = MeshBuilder.CreateGround(
            'arenaGround', { width: size, height: size, subdivisions: SUBDIVISIONS }, scene);
        ground.position.y = -0.01;

        // Bake the globe curvature into the geometry once: each vertex sinks by
        // curveDrop of its distance from the cap centre (where the hero stands).
        const pos = ground.getVerticesData(VertexBuffer.PositionKind)!.slice();
        for (let i = 0; i < pos.length; i += 3) {
            pos[i + 1] -= curveDrop(pos[i], pos[i + 2]);
        }
        ground.updateVerticesData(VertexBuffer.PositionKind, pos);
        ground.createNormals(false); // re-light the curved surface

        this.grassTexture = new GrassProceduralTexture('grassTex', 256, scene);
        this.grassTexture.uScale = TEX_TILES;
        this.grassTexture.vScale = TEX_TILES;
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
        // NO freezeWorldMatrix — unlike the old static disc, this mesh moves
        // every frame to follow the hero.
        this.ground = ground;
    }

    /** Per-frame: recentre the cap on the hero and counter-scroll the texture
     *  so the terrain pattern stays world-anchored (the ground "slides"). */
    public update(heroX: number, heroZ: number): void {
        this.ground.position.x = heroX;
        this.ground.position.z = heroZ;
        const size = VISIBLE_TERRAIN_RADIUS * 2;
        // CreateGround UVs: u spans +x, v spans +z across the mesh. Offset by
        // the hero's world position in tile units so the texture is stationary
        // in world space. (If the texture visibly "swims" with the hero instead
        // of staying put, flip the sign of the offending axis.)
        this.grassTexture.uOffset = (heroX / size) * TEX_TILES;
        this.grassTexture.vOffset = (heroZ / size) * TEX_TILES;
    }

    public dispose(): void {
        this.ground.dispose();
        this.grassMaterial.dispose();
        this.grassTexture.dispose();
    }
}
