import { Color, Mesh, MeshPhongMaterial, WebGLRenderer } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { createGround, disposeMesh } from '../../engine/three/primitives';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import {
    createProceduralGrassTexture,
    BakedGrassTexture,
} from '../../engine/rendering/ProceduralGrassTexture';
import { VISIBLE_TERRAIN_RADIUS } from './constants';
import { curveDrop } from './curvature';

const SUBDIVISIONS = 48;
/** Texture repeats across the cap — keeps the same texel density as the old
 *  25-radius disc (which used uScale = radius * 0.5 = 12.5 over 50 units). */
const TEX_TILES = VISIBLE_TERRAIN_RADIUS * 0.5;
/** Ground bake resolution — small; the blade layers cover most of it. */
const TEX_SIZE = 256;

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
    private grassTexture: BakedGrassTexture | null;
    private grassMaterial: MeshPhongMaterial;

    /** `renderer` drives the one-shot ground-texture bake (Babylon's
     *  GrassProceduralTexture replacement). Omit it (headless/no-GPU) and the
     *  cap falls back to a plain PALETTE.GROUND-coloured material. */
    constructor(host: SceneHost, renderer?: WebGLRenderer) {
        const size = VISIBLE_TERRAIN_RADIUS * 2;
        // Name must keep the 'arenaGround' prefix — applyRuinsAmbience's
        // receiveShadows loop and the resource-watchdog buckets match on it.
        const ground = createGround(
            'arenaGround', { width: size, height: size, subdivisions: SUBDIVISIONS }, host);
        ground.position.y = -0.01;

        // Bake the globe curvature into the geometry once: each vertex sinks by
        // curveDrop of its distance from the cap centre (where the hero stands).
        const pos = ground.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
            pos.setY(i, pos.getY(i) - curveDrop(pos.getX(i), pos.getZ(i)));
        }
        pos.needsUpdate = true;
        ground.geometry.computeVertexNormals(); // re-light the curved surface

        this.grassTexture = renderer
            ? createProceduralGrassTexture(renderer, { size: TEX_SIZE, tile: TEX_TILES })
            : null;

        this.grassMaterial = new MeshPhongMaterial({
            name: 'grassMat',
            map: this.grassTexture?.texture ?? null,
            color: this.grassTexture ? new Color(1, 1, 1) : PALETTE.GROUND.clone(),
            specular: new Color(0, 0, 0),
            // No emissive — emissive is unlit and masks shadows.
        });

        ground.receiveShadow = true;
        ground.material = this.grassMaterial;
        ground.frustumCulled = false;
        // The mesh moves every frame to follow the hero (matrixAutoUpdate
        // stays on — unlike the old static disc).
        this.ground = ground;
    }

    /** Per-frame: recentre the cap on the hero and counter-scroll the texture
     *  so the terrain pattern stays world-anchored (the ground "slides"). */
    public update(heroX: number, heroZ: number): void {
        this.ground.position.x = heroX;
        this.ground.position.z = heroZ;
        const tex = this.grassTexture?.texture;
        if (!tex) return;
        const size = VISIBLE_TERRAIN_RADIUS * 2;
        // createGround UVs: u spans +x, v spans -z across the mesh (the plane
        // is rotated flat from XY, which flips v relative to Babylon's ground).
        // Offset by the hero's world position in tile units so the texture is
        // stationary in world space. (If the texture visibly "swims" with the
        // hero instead of staying put, flip the sign of the offending axis.)
        tex.offset.x = (heroX / size) * TEX_TILES;
        tex.offset.y = -(heroZ / size) * TEX_TILES;
    }

    public dispose(): void {
        disposeMesh(this.ground);
        this.grassMaterial.dispose();
        this.grassTexture?.dispose();
        this.grassTexture = null;
    }
}
