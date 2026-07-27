import { Camera, Vector3 } from 'three';
import { Enemy } from '../enemies/Enemy';
import { BossEnemy } from '../enemies/BossEnemy';
import { observeCanvasSize, type CanvasSize } from '../../engine/canvasSize';

const ELEMENT_HEX: Record<string, string> = {
    fire:     '#ff5500',
    ice:      '#33aaff',
    arcane:   '#cc55ff',
    physical: '#cccccc',
    storm:    '#bbbbff',
};

/** Elite-dot colours indexed by ELEMENT_ORDER, so the per-frame style identity is
 *  a small int instead of a composed `${size}|${border}|${bg}` string. */
const ELEMENT_ORDER = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** One live indicator dot plus the state needed to skip redundant DOM writes. */
interface Dot {
    el: HTMLDivElement;
    /** tier * 8 + (elite element index + 1); -1 = never styled. */
    styleCode: number;
    left: number;
    top: number;
}


/**
 * Screen-edge dots for off-screen enemies (DOM port of the old Babylon-GUI
 * version). One absolutely-positioned circular div per off-screen enemy,
 * pooled per enemy in `active` exactly like the old Rectangle pool.
 *
 * The camera is threaded as a direct reference (same as the Babylon version,
 * which received heroController.getCamera()). Render size comes from the
 * observed canvas size rather than a direct `clientWidth` read: this pass runs
 * right after the HUD's per-frame style writes, so measuring here forced a
 * synchronous layout of the whole document — including every dot — once a frame.
 *
 * Dots are placed with `transform`, not `left`/`top`. A streaming horde puts
 * 60-80% of its enemies off screen, so this moves ~150 absolutely-positioned
 * elements per frame, and `left`/`top` dirties layout for every one of them.
 * Centring is a negative margin rather than the `translate(-50%, -50%)` the
 * Babylon port used: the dot's box is a fixed pixel size, so the two are
 * identical on screen, and it keeps the per-frame transform down to one short
 * translate instead of a two-function string with percentages to resolve.
 * Measured over 150 dots: left/top 664us, percentage transform 604us,
 * margin-centred transform 454us per frame.
 */
export class OffscreenEnemyIndicators {
    private camera: Camera;
    private getEnemies: () => Enemy[];
    /** Layer the dots mount into — pointer-events: none, viewport-covering. */
    private layer: HTMLElement;
    /** Map from enemy → its screen-edge indicator dot */
    private active: Map<Enemy, Dot> = new Map();
    /** Reused per-frame set to avoid allocating a new Set every update */
    private _seen: Set<Enemy> = new Set<Enemy>();
    /** Scratch vector reused per enemy per frame so the projection allocates nothing. */
    private _scratchProject: Vector3 = new Vector3();
    /** Layout-free canvas size (see the class comment). */
    private viewport: CanvasSize;

    constructor(
        canvas: HTMLCanvasElement,
        camera: Camera,
        getEnemies: () => Enemy[],
        parent?: HTMLElement,
    ) {
        this.camera = camera;
        this.getEnemies = getEnemies;
        this.layer = parent ?? document.getElementById('ui-root') ?? document.body;
        this.viewport = observeCanvasSize(canvas);
    }

    public update(): void {
        const enemies = this.getEnemies();
        const sw = this.viewport.width;
        const sh = this.viewport.height;
        if (sw === 0 || sh === 0) return;
        this._seen.clear();
        const seen = this._seen;

        // Camera.updateMatrixWorld also refreshes matrixWorldInverse, so the
        // projection below is correct even before the first rendered frame.
        this.camera.updateMatrixWorld();
        const sp = this._scratchProject;

        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (!e.alive) continue;
            seen.add(e);

            // Project world → screen via the shared scratch Vector3. View space
            // first: the camera looks down -Z, so viewZ > 0 means behind it
            // (Babylon's sp.z < 0 case).
            sp.copy(e.position).applyMatrix4(this.camera.matrixWorldInverse);
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
                    dot.el.remove();
                    this.active.delete(e);
                }
                continue;
            }

            // Tier detection (boss first so a hypothetical boss+elite stays boss)
            const isBoss  = e instanceof BossEnemy;
            const isElite = !isBoss && e.isElite;
            const tier    = isBoss ? 2 : isElite ? 1 : 0;
            const elemIdx = isElite ? ELEMENT_ORDER.indexOf(e.eliteDropElement ?? '') + 1 : 0;
            // Small int identity for the styling — a composed template string per
            // off-screen enemy per frame was pure garbage for a value only compared.
            const styleCode = tier * 8 + elemIdx;

            const size   = isBoss ? 18 : isElite ? 12 : 6;
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

            let dot = this.active.get(e);
            if (!dot) {
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.pointerEvents = 'none';
                // Anchor at the layer origin once; the per-frame position rides
                // the transform, which keeps it off the layout path.
                el.style.left = '0';
                el.style.top = '0';
                el.style.boxSizing = 'border-box';
                el.style.borderRadius = '50%';
                dot = { el, styleCode: -1, left: Number.NaN, top: Number.NaN };
                this.layer.appendChild(el);
                this.active.set(e, dot);
            }
            if (dot.styleCode !== styleCode) {
                // Re-style only when the tier styling actually changed (e.g.
                // EliteSpawner promoting a regular spawn to elite) — not every frame.
                dot.styleCode = styleCode;
                this.applyStyle(dot.el, size, tier, elemIdx);
            }
            // Sub-pixel churn is invisible but each write costs a style recalc, so
            // round and dirty-check both offsets. One transform carries both, so a
            // dot that moved on either axis costs a single write.
            const left = Math.round(ex);
            const top  = Math.round(ey);
            if (left !== dot.left || top !== dot.top) {
                dot.left = left;
                dot.top = top;
                dot.el.style.transform = `translate(${left}px,${top}px)`;
            }
        }

        // Clean up stale entries (dead enemies)
        for (const [e, dot] of this.active) {
            if (!seen.has(e)) {
                dot.el.remove();
                this.active.delete(e);
            }
        }
    }

    private applyStyle(el: HTMLDivElement, size: number, tier: number, elemIdx: number): void {
        el.style.width      = `${size}px`;
        el.style.height     = `${size}px`;
        // Half the (border-box) size, so the transform target lands on the dot's
        // centre. Re-applied with the size because the tiers differ.
        el.style.marginLeft = `${-size / 2}px`;
        el.style.marginTop  = `${-size / 2}px`;
        el.style.border     = tier > 0 ? '2px solid #ffffff' : 'none';
        el.style.background = tier === 2
            ? '#ff3333'
            : tier === 1
                ? (ELEMENT_HEX[ELEMENT_ORDER[elemIdx - 1]] ?? '#ffffff')
                : '#aaaaaa';
    }

    public dispose(): void {
        for (const dot of this.active.values()) {
            dot.el.remove();
        }
        this.active.clear();
        this.viewport.dispose();
    }
}
