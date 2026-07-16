import { Camera, Vector3 } from 'three';
import { Enemy } from '../enemies/Enemy';
import { BossEnemy } from '../enemies/BossEnemy';

const ELEMENT_HEX: Record<string, string> = {
    fire:     '#ff5500',
    ice:      '#33aaff',
    arcane:   '#cc55ff',
    physical: '#cccccc',
    storm:    '#bbbbff',
};

/**
 * Screen-edge dots for off-screen enemies (DOM port of the old Babylon-GUI
 * version). One absolutely-positioned circular div per off-screen enemy,
 * pooled per enemy in `active` exactly like the old Rectangle pool.
 *
 * The camera is threaded as a direct reference (same as the Babylon version,
 * which received heroController.getCamera()). Render size comes from
 * canvas.clientWidth/Height.
 */
export class OffscreenEnemyIndicators {
    private canvas: HTMLCanvasElement;
    private camera: Camera;
    private getEnemies: () => Enemy[];
    /** Layer the dots mount into — pointer-events: none, viewport-covering. */
    private layer: HTMLElement;
    /** Map from enemy → its screen-edge indicator dot */
    private active: Map<Enemy, HTMLDivElement> = new Map();
    /** Reused per-frame set to avoid allocating a new Set every update */
    private _seen: Set<Enemy> = new Set<Enemy>();
    /** Scratch vector reused per enemy per frame so the projection allocates nothing. */
    private _scratchProject: Vector3 = new Vector3();

    constructor(
        canvas: HTMLCanvasElement,
        camera: Camera,
        getEnemies: () => Enemy[],
        parent?: HTMLElement,
    ) {
        this.canvas = canvas;
        this.camera = camera;
        this.getEnemies = getEnemies;
        this.layer = parent ?? document.getElementById('ui-root') ?? document.body;
    }

    public update(): void {
        const enemies = this.getEnemies();
        const sw = this.canvas.clientWidth;
        const sh = this.canvas.clientHeight;
        if (sw === 0 || sh === 0) return;
        this._seen.clear();
        const seen = this._seen;

        // Camera.updateMatrixWorld also refreshes matrixWorldInverse, so the
        // projection below is correct even before the first rendered frame.
        this.camera.updateMatrixWorld();
        const sp = this._scratchProject;

        for (const e of enemies) {
            if (!e.isAlive()) continue;
            seen.add(e);

            // Project world → screen via the shared scratch Vector3. View space
            // first: the camera looks down -Z, so viewZ > 0 means behind it
            // (Babylon's sp.z < 0 case).
            sp.copy(e.getPosition()).applyMatrix4(this.camera.matrixWorldInverse);
            const inFront = sp.z < 0;
            sp.applyMatrix4(this.camera.projectionMatrix); // NDC (perspective divide)
            const sx = (sp.x * 0.5 + 0.5) * sw;
            const sy = (-sp.y * 0.5 + 0.5) * sh;

            const onScreen =
                inFront &&
                sx >= 0 && sx <= sw &&
                sy >= 0 && sy <= sh;

            if (onScreen) {
                // Remove the indicator if the enemy came back on screen
                const dot = this.active.get(e);
                if (dot) {
                    dot.remove();
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

            // Compute the clamped screen-edge position (top-left screen space;
            // the behind-camera perspective divide flips signs, so mirror the
            // direction through the centre exactly like the Babylon version).
            const cx = sw / 2;
            const cy = sh / 2;
            const dx = inFront ? sx - cx : cx - sx;  // flip when behind camera
            const dy = inFront ? sy - cy : cy - sy;
            const ang = Math.atan2(dy, dx);
            const ex = cx + Math.cos(ang) * (cx - margin);
            const ey = cy + Math.sin(ang) * (cy - margin);

            const styleKey = `${size}|${border}|${bg}`;
            let dot = this.active.get(e);
            if (!dot) {
                dot = document.createElement('div');
                dot.style.position = 'absolute';
                dot.style.pointerEvents = 'none';
                // Centre the dot on its (left, top) point, like the old
                // centre-aligned ADT control.
                dot.style.transform = 'translate(-50%, -50%)';
                this.applyStyle(dot, size, border, bg, styleKey);
                this.layer.appendChild(dot);
                this.active.set(e, dot);
            } else if (dot.dataset.styleKey !== styleKey) {
                // Re-style only when the tier styling actually changed (e.g.
                // EliteSpawner promoting a regular spawn to elite) — not every
                // frame. The style key is stashed on the element's dataset.
                this.applyStyle(dot, size, border, bg, styleKey);
            }
            dot.style.left = `${ex}px`;
            dot.style.top  = `${ey}px`;
        }

        // Clean up stale entries (dead enemies)
        for (const [e, dot] of this.active) {
            if (!seen.has(e)) {
                dot.remove();
                this.active.delete(e);
            }
        }
    }

    private applyStyle(dot: HTMLDivElement, size: number, border: number, bg: string, styleKey: string): void {
        dot.dataset.styleKey = styleKey;
        dot.style.width        = `${size}px`;
        dot.style.height       = `${size}px`;
        dot.style.boxSizing    = 'border-box';
        dot.style.border       = border > 0 ? `${border}px solid #ffffff` : 'none';
        dot.style.background   = bg;
        dot.style.borderRadius = '50%';
    }

    public dispose(): void {
        for (const dot of this.active.values()) {
            dot.remove();
        }
        this.active.clear();
    }
}
