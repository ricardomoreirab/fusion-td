import {
    Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshBasicMaterial,
    PlaneGeometry, DoubleSide,
} from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import type { BiomeDef } from './Biomes';
import { ISO_CLIP_DISTANCE } from './isoProjection';
import { MIST_EXTENT, MIST_HEIGHT } from './WorldConstants';

/**
 * Scenario lighting, fog, and ground mist — everything atmospheric that is not
 * geometry.
 *
 * ── Why there is no sky ──────────────────────────────────────────────────────
 * Under true orthographic projection an infinite ground plane covers the entire
 * frame: a horizon is a perspective artefact (parallel lines converging at a
 * vanishing point) and parallel projection has none. The terrain quad is always
 * larger than the frustum, so no ray ever escapes to the sky. A sky dome here
 * would render zero pixels.
 *
 * The renderer clear colour is still set per biome — not as an art surface, but
 * as a diagnostic: if it ever becomes visible, the terrain failed to draw.
 *
 * ── Why fog offsets, not distances ───────────────────────────────────────────
 * THREE.Fog runs on view-space depth. The iso camera sits ISO_CLIP_DISTANCE back
 * along its view axis purely so nothing clips, which means every fragment is
 * ~220 units deep. Absolute near/far values would put the whole scene past
 * `far` and render flat fog colour. Biome fog is therefore authored as offsets
 * from the hero's focal plane and rebased here.
 */

/** Key-light direction, chosen so shadows fall across the isometric grain
 *  rather than along it — shadows that run parallel to a projected axis read as
 *  smearing rather than as form. */
const KEY_DIR = { x: -0.55, y: 0.78, z: -0.30 };
const FILL_DIR = { x: 0.62, y: 0.35, z: 0.55 };

/** Ortho shadow frustum half-extent. Must cover the visible ground plus the
 *  tallest prop's cast distance. */
const SHADOW_EXTENT = 42;

export class Atmosphere {
    private readonly host: SceneHost;
    public readonly key: DirectionalLight;
    private readonly fill: DirectionalLight;
    private readonly hemi: HemisphereLight;
    private readonly fog: Fog;
    private readonly mist: Mesh;
    private readonly mistMaterial: MeshBasicMaterial;
    private readonly mistGeometry: PlaneGeometry;

    private readonly _cA = new Color();
    private readonly _cB = new Color();

    /** Previous scene fog/background, restored on dispose so leaving the state
     *  cannot leak this biome grade into the menu. */
    private readonly prevFog: SceneHost['scene']['fog'];
    private readonly prevBackground: SceneHost['scene']['background'];

    private shadowFrame = 0;
    private shadowInterval = 2;

    constructor(host: SceneHost, shadowsEnabled: boolean) {
        this.host = host;
        this.prevFog = host.scene.fog;
        this.prevBackground = host.scene.background;

        this.key = new DirectionalLight(0xffffff, 1.35);
        this.key.name = 'worldKey';
        this.key.castShadow = shadowsEnabled;
        this.key.shadow.mapSize.set(1024, 1024);
        const sc = this.key.shadow.camera;
        sc.left = -SHADOW_EXTENT;
        sc.right = SHADOW_EXTENT;
        sc.top = SHADOW_EXTENT;
        sc.bottom = -SHADOW_EXTENT;
        sc.near = 1;
        sc.far = 160;
        sc.updateProjectionMatrix();
        this.key.shadow.bias = -0.0009;
        this.key.shadow.normalBias = 0.02;
        // Throttled refresh: the camera never rotates and the world is a
        // treadmill, so a every-other-frame shadow map is imperceptible and
        // roughly halves shadow cost.
        this.key.shadow.autoUpdate = false;
        this.key.shadow.needsUpdate = true;
        host.scene.add(this.key);
        host.scene.add(this.key.target);

        this.fill = new DirectionalLight(0xffffff, 0.85);
        this.fill.name = 'worldFill';
        this.fill.castShadow = false;
        host.scene.add(this.fill);
        host.scene.add(this.fill.target);

        this.hemi = new HemisphereLight(0xffffff, 0x000000, 0.95);
        this.hemi.name = 'worldHemi';
        host.scene.add(this.hemi);

        this.fog = new Fog(0x000000, 1, 100);
        host.scene.fog = this.fog;

        // Ground mist: a single horizontal card just above the surface. Capped
        // at MIST_HEIGHT by the readability promise so it can tint the floor
        // without ever swallowing an enemy's silhouette.
        this.mistGeometry = new PlaneGeometry(MIST_EXTENT, MIST_EXTENT, 1, 1);
        this.mistGeometry.rotateX(-Math.PI / 2);
        this.mistMaterial = new MeshBasicMaterial({
            name: 'worldMist',
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: DoubleSide,
            fog: true,
        });
        this.mist = new Mesh(this.mistGeometry, this.mistMaterial);
        this.mist.name = 'worldMist';
        this.mist.position.y = MIST_HEIGHT;
        this.mist.frustumCulled = false;
        this.mist.renderOrder = 5;
        this.mist.visible = false;
        host.scene.add(this.mist);
    }

    /** Under a perf trim the shadow map refreshes less often. */
    public setShadowInterval(frames: number): void {
        this.shadowInterval = Math.max(1, frames);
    }

    public update(heroX: number, heroZ: number, a: BiomeDef, b: BiomeDef, t: number): void {
        const lerpN = (x: number, y: number) => x + (y - x) * t;

        // ── Lights ──────────────────────────────────────────────────────────
        this._cA.setRGB(a.lighting.keyColor[0], a.lighting.keyColor[1], a.lighting.keyColor[2]);
        this._cB.setRGB(b.lighting.keyColor[0], b.lighting.keyColor[1], b.lighting.keyColor[2]);
        this.key.color.copy(this._cA).lerp(this._cB, t);
        this.key.intensity = lerpN(a.lighting.keyIntensity, b.lighting.keyIntensity);

        this._cA.setRGB(a.lighting.fillColor[0], a.lighting.fillColor[1], a.lighting.fillColor[2]);
        this._cB.setRGB(b.lighting.fillColor[0], b.lighting.fillColor[1], b.lighting.fillColor[2]);
        this.fill.color.copy(this._cA).lerp(this._cB, t);
        this.fill.intensity = lerpN(a.lighting.fillIntensity, b.lighting.fillIntensity);

        this._cA.setRGB(a.lighting.hemiSky[0], a.lighting.hemiSky[1], a.lighting.hemiSky[2]);
        this._cB.setRGB(b.lighting.hemiSky[0], b.lighting.hemiSky[1], b.lighting.hemiSky[2]);
        this.hemi.color.copy(this._cA).lerp(this._cB, t);
        this._cA.setRGB(a.lighting.hemiGround[0], a.lighting.hemiGround[1], a.lighting.hemiGround[2]);
        this._cB.setRGB(b.lighting.hemiGround[0], b.lighting.hemiGround[1], b.lighting.hemiGround[2]);
        this.hemi.groundColor.copy(this._cA).lerp(this._cB, t);
        this.hemi.intensity = lerpN(a.lighting.hemiIntensity, b.lighting.hemiIntensity);

        // Lights ride the hero: the world is a treadmill, so a world-anchored
        // light would walk out of its own shadow frustum.
        this.key.position.set(heroX + KEY_DIR.x * 60, KEY_DIR.y * 60, heroZ + KEY_DIR.z * 60);
        this.key.target.position.set(heroX, 0, heroZ);
        this.key.target.updateMatrixWorld();
        this.fill.position.set(heroX + FILL_DIR.x * 50, FILL_DIR.y * 50, heroZ + FILL_DIR.z * 50);
        this.fill.target.position.set(heroX, 0, heroZ);
        this.fill.target.updateMatrixWorld();

        if (this.key.castShadow) {
            this.shadowFrame++;
            if (this.shadowFrame >= this.shadowInterval) {
                this.shadowFrame = 0;
                this.key.shadow.needsUpdate = true;
            }
        }

        // ── Fog ─────────────────────────────────────────────────────────────
        this._cA.setRGB(a.atmosphere.fogColor[0], a.atmosphere.fogColor[1], a.atmosphere.fogColor[2]);
        this._cB.setRGB(b.atmosphere.fogColor[0], b.atmosphere.fogColor[1], b.atmosphere.fogColor[2]);
        this.fog.color.copy(this._cA).lerp(this._cB, t);
        this.fog.near = ISO_CLIP_DISTANCE + lerpN(a.atmosphere.fogNearOffset, b.atmosphere.fogNearOffset);
        this.fog.far = ISO_CLIP_DISTANCE + lerpN(a.atmosphere.fogFarOffset, b.atmosphere.fogFarOffset);

        // ── Clear colour (diagnostic only — see the class note) ─────────────
        this._cA.setRGB(a.atmosphere.clearColor[0], a.atmosphere.clearColor[1], a.atmosphere.clearColor[2]);
        this._cB.setRGB(b.atmosphere.clearColor[0], b.atmosphere.clearColor[1], b.atmosphere.clearColor[2]);
        if (!this.host.scene.background || (this.host.scene.background as Color).isColor) {
            if (!this.host.scene.background) this.host.scene.background = new Color();
            (this.host.scene.background as Color).copy(this._cA).lerp(this._cB, t);
        }

        // ── Ground mist ─────────────────────────────────────────────────────
        const mistAmount = lerpN(a.atmosphere.mist, b.atmosphere.mist);
        if (mistAmount <= 0.002) {
            this.mist.visible = false;
        } else {
            this.mist.visible = true;
            this._cA.setRGB(a.atmosphere.mistColor[0], a.atmosphere.mistColor[1], a.atmosphere.mistColor[2]);
            this._cB.setRGB(b.atmosphere.mistColor[0], b.atmosphere.mistColor[1], b.atmosphere.mistColor[2]);
            this.mistMaterial.color.copy(this._cA).lerp(this._cB, t);
            this.mistMaterial.opacity = mistAmount;
            this.mist.position.x = heroX;
            this.mist.position.z = heroZ;
        }
    }

    public dispose(): void {
        this.host.scene.fog = this.prevFog;
        this.host.scene.background = this.prevBackground;

        this.key.removeFromParent();
        this.key.target.removeFromParent();
        this.key.dispose();
        this.fill.removeFromParent();
        this.fill.target.removeFromParent();
        this.fill.dispose();
        this.hemi.removeFromParent();
        this.hemi.dispose();

        this.mist.removeFromParent();
        this.mistGeometry.dispose();
        this.mistMaterial.dispose();
    }
}
