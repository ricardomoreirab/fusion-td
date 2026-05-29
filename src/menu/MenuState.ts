import { Color4, ParticleSystem, Mesh } from '@babylonjs/core';
import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { GameSettings, GraphicsQuality } from '../shared/GameSettings';
import { GameUI } from '../ui/GameUI';
import { el } from '../ui/dom';
import { onTap } from '../ui/interaction';
import { makeButton } from '../ui/primitives/Button';

export class MenuState implements GameState {
    private game: Game;
    private gameUI: GameUI | null = null;
    private sceneObjects: Mesh[] = [];
    private particleSystems: ParticleSystem[] = [];
    private animationCallback: (() => void) | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering menu state');

        // Create animated 3D background
        this.createBackground();

        // Create UI
        this.createUI();

        // Play background music
        this.game.getAssetManager().playSound('bgMusic');
    }

    public exit(): void {
        console.log('Exiting menu state');

        // Remove animation callback
        if (this.animationCallback) {
            this.game.getScene().unregisterBeforeRender(this.animationCallback);
            this.animationCallback = null;
        }

        // Dispose particle systems
        for (const ps of this.particleSystems) {
            ps.stop();
            ps.dispose();
        }
        this.particleSystems = [];

        // Dispose scene objects
        for (const mesh of this.sceneObjects) {
            mesh.dispose();
        }
        this.sceneObjects = [];

        // Dispose UI
        this.gameUI?.dispose();
        this.gameUI = null;
    }

    public update(_deltaTime: number): void {
        // Background animation is handled via registerBeforeRender
    }

    private createBackground(): void {
        const scene = this.game.getScene();

        // Solid dark backdrop — the themed UI rectangle in createUI() draws on top.
        // No 3D objects, no enemies, no particles. Clean start screen.
        scene.clearColor = new Color4(0.027, 0.020, 0.039, 1.0); // matches #07050a
    }

    private createUI(): void {
        this.gameUI = new GameUI();
        const overlay = this.gameUI.layer('overlay');

        // ── Full-screen container ────────────────────────────────────────
        const screen = el('div', { class: 'screen interactive' });

        // Title
        screen.appendChild(el('div', { class: 'screen__title', text: 'KTG' }));

        // Subtitle
        screen.appendChild(el('div', { class: 'screen__subtitle', text: 'KILL THE GOBLINS' }));

        // Start button
        const startBtn = makeButton({
            label: 'Begin the Hunt',
            variant: 'forged',
            onClick: () => this.game.getStateManager().changeState('survivors'),
        });
        screen.appendChild(startBtn);

        // ── Graphics preset selector ─────────────────────────────────────
        const gfxLabel = el('div', { class: 'screen__label', text: 'Graphics' });
        screen.appendChild(gfxLabel);

        const levels: GraphicsQuality[] = ['low', 'medium', 'high'];
        const labels = ['LOW', 'MEDIUM', 'HIGH'];
        const gfxBtns: HTMLDivElement[] = [];

        const refresh = () => {
            const current = GameSettings.getGraphicsQuality();
            for (let i = 0; i < levels.length; i++) {
                if (levels[i] === current) {
                    gfxBtns[i].classList.add('gfx-btn--active');
                } else {
                    gfxBtns[i].classList.remove('gfx-btn--active');
                }
            }
        };

        const row = el('div', { class: 'screen__row' });
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const btn = el('div', { class: 'gfx-btn', text: labels[i] });
            onTap(btn, () => {
                GameSettings.setGraphicsQuality(level);
                refresh();
            });
            gfxBtns.push(btn);
            row.appendChild(btn);
        }
        screen.appendChild(row);

        // Apply initial active state
        refresh();

        overlay.appendChild(screen);
    }
}
