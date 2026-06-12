import { AdvancedDynamicTexture, Rectangle } from '@babylonjs/gui';
import { Scene, Vector3, Matrix, Camera, Viewport } from '@babylonjs/core';
import { Enemy } from '../enemies/Enemy';
import { BossEnemy } from '../enemies/BossEnemy';

const ELEMENT_HEX: Record<string, string> = {
    fire:     '#ff5500',
    ice:      '#33aaff',
    arcane:   '#cc55ff',
    physical: '#cccccc',
    storm:    '#bbbbff',
};

export class OffscreenEnemyIndicators {
    private ui: AdvancedDynamicTexture;
    private scene: Scene;
    private camera: Camera;
    private getEnemies: () => Enemy[];
    /** Map from enemy → its screen-edge indicator dot */
    private active: Map<Enemy, Rectangle> = new Map();
    /** Reused per-frame set to avoid allocating a new Set every update */
    private _seen: Set<Enemy> = new Set<Enemy>();
    /** Scratch buffers reused per call to Vector3.ProjectToRef so the projection
     *  doesn't allocate a fresh Vector3 + Viewport per enemy per frame. */
    private _scratchProject: Vector3 = new Vector3();
    private _scratchViewport: Viewport = new Viewport(0, 0, 1, 1);
    private _identityMat: Matrix = Matrix.Identity();

    constructor(
        ui: AdvancedDynamicTexture,
        scene: Scene,
        camera: Camera,
        getEnemies: () => Enemy[],
    ) {
        this.ui = ui;
        this.scene = scene;
        this.camera = camera;
        this.getEnemies = getEnemies;
    }

    public update(): void {
        const enemies = this.getEnemies();
        const engine  = this.scene.getEngine();
        const sw      = engine.getRenderWidth();
        const sh      = engine.getRenderHeight();
        this._seen.clear();
        const seen    = this._seen;

        const transformMat = this.scene.getTransformMatrix();
        // Compute the screen-space viewport once into the scratch instance
        // (toGlobalToRef avoids the per-call Viewport allocation that
        // viewport.toGlobal returns).
        const vp = this._scratchViewport;
        this.camera.viewport.toGlobalToRef(sw, sh, vp);
        const sp = this._scratchProject;

        for (const e of enemies) {
            if (!e.isAlive()) continue;
            seen.add(e);

            // Project world → screen into the shared scratch Vector3.
            Vector3.ProjectToRef(e.getPosition(), this._identityMat, transformMat, vp, sp);

            // sp.z < 0 means the point is behind the camera
            const onScreen =
                sp.z > 0 &&
                sp.x >= 0 && sp.x <= sw &&
                sp.y >= 0 && sp.y <= sh;

            if (onScreen) {
                // Remove the indicator if the enemy came back on screen
                if (this.active.has(e)) {
                    this.active.get(e)!.dispose();
                    this.active.delete(e);
                }
                continue;
            }

            // Tier detection (boss first so a hypothetical boss+elite stays boss)
            const isBoss  = e instanceof BossEnemy;
            const isElite = !isBoss && e.isElite;

            const size   = isBoss ? 18 : isElite ? 12 : 6;
            const border = isBoss || isElite ? 2 : 0;
            const bg     = isBoss
                ? '#ff3333'
                : isElite
                    ? (ELEMENT_HEX[e.eliteDropElement ?? ''] ?? '#ffffff')
                    : '#aaaaaa';
            const margin = size / 2 + 4;

            // Compute the clamped screen-edge position
            // ADT uses center-origin; convert from top-left screen space.
            const cx = sw / 2;
            const cy = sh / 2;
            const dx = sp.z > 0 ? sp.x - cx : cx - sp.x;  // flip when behind camera
            const dy = sp.z > 0 ? sp.y - cy : cy - sp.y;
            const ang = Math.atan2(dy, dx);
            const ex = cx + Math.cos(ang) * (cx - margin);
            const ey = cy + Math.sin(ang) * (cy - margin);

            const styleKey = `${size}|${border}|${bg}`;
            let dot = this.active.get(e);
            if (!dot) {
                dot = new Rectangle(`offscreenEnemyDot_${e.id}`);
                // Size/background MUST be set before addControl. A Rectangle
                // added at its default 100%/transparent state never recovers
                // visibility when those props are set later in the same frame.
                dot.color        = '#ffffff';
                dot.metadata     = styleKey;
                dot.width        = `${size}px`;
                dot.height       = `${size}px`;
                dot.thickness    = border;
                dot.background   = bg;
                dot.cornerRadius = size / 2;
                this.ui.addControl(dot);
                this.active.set(e, dot);
            } else if (dot.metadata !== styleKey) {
                // Re-style only when the tier styling actually changed (e.g.
                // EliteSpawner promoting a regular spawn to elite) — not every
                // frame. The style key is stashed on the control's metadata.
                dot.metadata     = styleKey;
                dot.width        = `${size}px`;
                dot.height       = `${size}px`;
                dot.thickness    = border;
                dot.background   = bg;
                dot.cornerRadius = size / 2;
            }
            // Position in ADT space (center-origin) as percentages — px values
            // get scaled by idealWidth and land off-screen at non-800 viewports.
            dot.left = `${((ex - cx) / sw) * 100}%`;
            dot.top  = `${((ey - cy) / sh) * 100}%`;
        }

        // Clean up stale entries (dead enemies)
        for (const [e, dot] of this.active) {
            if (!seen.has(e)) {
                dot.dispose();
                this.active.delete(e);
            }
        }
    }

    public dispose(): void {
        for (const dot of this.active.values()) {
            dot.dispose();
        }
        this.active.clear();
    }
}
