import { Color4, ParticleSystem, Mesh } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, TextBlock, Rectangle } from '@babylonjs/gui';
import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { GameSettings, GraphicsQuality } from '../shared/GameSettings';

export class MenuState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
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
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
    }

    public update(deltaTime: number): void {
        // Background animation is handled via registerBeforeRender
    }

    private isMobileDevice(): boolean {
        return ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
               window.innerWidth < 1024;
    }

    private createBackground(): void {
        const scene = this.game.getScene();

        // Solid dark backdrop — the themed UI rectangle in createUI() draws on top.
        // No 3D objects, no enemies, no particles. Clean start screen.
        scene.clearColor = new Color4(0.027, 0.020, 0.039, 1.0); // matches #07050a
    }

    private createUI(): void {
        const isMobile = this.isMobileDevice();
        const isLandscape = isMobile && window.innerWidth > window.innerHeight;

        // Create fullscreen UI with proper scaling for mobile
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('menuUI', true, this.game.getScene());

        if (isMobile) {
            this.ui.idealWidth = 600;
            this.ui.useSmallestIdeal = true;
        }

        // Themed full-screen background — matches the loading screen palette.
        // Outer: very dark base. Inner: a layered red radial glow + faint green hint.
        const touchBlocker = new Rectangle('menuTouchBlocker');
        touchBlocker.width = '100%';
        touchBlocker.height = '100%';
        touchBlocker.thickness = 0;
        touchBlocker.background = '#07050a';
        touchBlocker.isPointerBlocker = true;
        this.ui.addControl(touchBlocker);

        // Soft red center glow (large faint rectangle with alpha)
        const redGlow = new Rectangle('menuRedGlow');
        redGlow.width = '800px';
        redGlow.height = '800px';
        redGlow.thickness = 0;
        redGlow.background = 'rgba(120, 30, 20, 0.18)';
        redGlow.cornerRadius = 400; // pill-circle look
        touchBlocker.addControl(redGlow);

        // Faint green wash near the top to hint at "goblin" tone
        const greenWash = new Rectangle('menuGreenWash');
        greenWash.width = '600px';
        greenWash.height = '300px';
        greenWash.thickness = 0;
        greenWash.background = 'rgba(60, 100, 30, 0.10)';
        greenWash.cornerRadius = 300;
        greenWash.top = '-280px';
        touchBlocker.addControl(greenWash);

        // Title "KTG" + "KILL THE GOBLINS" subtitle - responsive sizing
        const titleText = new TextBlock('titleText');
        titleText.text = 'KTG';
        titleText.color = '#C8302A';
        titleText.fontSize = isLandscape ? 56 : (isMobile ? 84 : 128);
        titleText.top = isLandscape ? '-95px' : (isMobile ? '-160px' : '-230px');
        titleText.fontFamily = 'Georgia';
        titleText.fontWeight = 'bold';
        titleText.shadowColor = 'rgba(0,0,0,0.85)';
        titleText.shadowBlur = isMobile ? 8 : 14;
        titleText.shadowOffsetX = isMobile ? 2 : 4;
        titleText.shadowOffsetY = isMobile ? 3 : 6;
        titleText.outlineWidth = 2;
        titleText.outlineColor = '#4A0E08';
        touchBlocker.addControl(titleText);

        const subtitleText = new TextBlock('subtitleText');
        subtitleText.text = 'KILL THE GOBLINS';
        subtitleText.color = '#88A070';
        subtitleText.fontSize = isLandscape ? 14 : (isMobile ? 18 : 24);
        subtitleText.top = isLandscape ? '-55px' : (isMobile ? '-95px' : '-145px');
        subtitleText.fontFamily = 'Georgia';
        subtitleText.fontWeight = 'bold';
        subtitleText.outlineWidth = 1;
        subtitleText.outlineColor = '#000000';
        touchBlocker.addControl(subtitleText);

        // START GAME button - responsive pill shape
        const btnWidth = isLandscape ? '200px' : (isMobile ? '240px' : '280px');
        const btnHeight = isLandscape ? '40px' : (isMobile ? '54px' : '60px');
        const btnFontSize = isLandscape ? 16 : (isMobile ? 20 : 24);

        const startButton = Button.CreateSimpleButton('startButton', 'BEGIN THE HUNT');
        startButton.width = btnWidth;
        startButton.height = btnHeight;
        startButton.color = '#C8302A';            // border color (Button extends Rectangle)
        startButton.background = '#8A1812';
        startButton.cornerRadius = 6;
        startButton.thickness = 2;
        startButton.fontFamily = 'Georgia';
        startButton.fontSize = btnFontSize;
        startButton.fontWeight = 'bold';
        startButton.top = isLandscape ? '-5px' : (isMobile ? '-15px' : '-20px');
        startButton.shadowColor = 'rgba(0, 0, 0, 0.7)';
        startButton.shadowBlur = 10;
        startButton.shadowOffsetY = 4;
        // Force the inner text label to white (Button's text child)
        if (startButton.textBlock) startButton.textBlock.color = '#FFFFFF';
        if (!isMobile) {
            startButton.onPointerEnterObservable.add(() => {
                startButton.background = '#C8302A';
                startButton.scaleX = 1.05;
                startButton.scaleY = 1.05;
            });
            startButton.onPointerOutObservable.add(() => {
                startButton.background = '#8A1812';
                startButton.scaleX = 1.0;
                startButton.scaleY = 1.0;
            });
        }
        startButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('survivors');
        });
        touchBlocker.addControl(startButton);

        // ─── Graphics preset selector ────────────────────────────────────
        // Three buttons (LOW / MEDIUM / HIGH); the active one renders brighter.
        // Click persists the choice — applied at next run start.
        const gfxLabel = new TextBlock('gfxLabel', 'GRAPHICS');
        gfxLabel.color = '#88A070';
        gfxLabel.fontSize = isLandscape ? 11 : (isMobile ? 13 : 15);
        gfxLabel.fontFamily = 'Georgia';
        gfxLabel.fontWeight = 'bold';
        gfxLabel.top = isLandscape ? '40px' : (isMobile ? '40px' : '50px');
        gfxLabel.height = '20px';
        gfxLabel.outlineWidth = 1;
        gfxLabel.outlineColor = '#000000';
        touchBlocker.addControl(gfxLabel);

        const levels: GraphicsQuality[] = ['low', 'medium', 'high'];
        const labels = ['LOW', 'MEDIUM', 'HIGH'];
        const gfxBtnW = isLandscape ? 72 : (isMobile ? 78 : 88);
        const gfxBtnH = isLandscape ? 26 : (isMobile ? 32 : 36);
        const gfxGap = isLandscape ? 4 : 6;
        const gfxTop = isLandscape ? '70px' : (isMobile ? '72px' : '85px');
        const gfxButtons: Button[] = [];

        const refreshGfx = () => {
            const current = GameSettings.getGraphicsQuality();
            for (let i = 0; i < levels.length; i++) {
                const active = levels[i] === current;
                gfxButtons[i].color = active ? '#ffe040' : '#5a5a66';
                gfxButtons[i].background = active ? '#4a3a18' : '#1a1822';
                gfxButtons[i].thickness = active ? 3 : 2;
                if (gfxButtons[i].textBlock) {
                    gfxButtons[i].textBlock!.color = active ? '#ffe040' : '#9a9aae';
                }
            }
        };

        for (let i = 0; i < levels.length; i++) {
            const btn = Button.CreateSimpleButton(`gfxBtn_${levels[i]}`, labels[i]);
            btn.width = `${gfxBtnW}px`;
            btn.height = `${gfxBtnH}px`;
            btn.cornerRadius = 6;
            btn.top = gfxTop;
            btn.left = `${(i - 1) * (gfxBtnW + gfxGap)}px`;
            btn.thickness = 2;
            btn.fontSize = isLandscape ? 12 : (isMobile ? 14 : 15);
            btn.fontWeight = 'bold';
            btn.fontFamily = 'Arial';

            const idx = i;
            btn.onPointerUpObservable.add(() => {
                GameSettings.setGraphicsQuality(levels[idx]);
                refreshGfx();
            });

            gfxButtons.push(btn);
            touchBlocker.addControl(btn);
        }

        refreshGfx();
    }

}
