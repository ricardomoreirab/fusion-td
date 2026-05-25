import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Control, Rectangle, TextBlock } from '@babylonjs/gui';
import { Game } from '../Game';
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';

export class PauseScreen {
    private game: Game;
    private scene: Scene;
    private guiTexture: AdvancedDynamicTexture;
    private overlay!: Rectangle;
    private pauseText!: TextBlock;
    private instructionText!: TextBlock;
    private resumeButton!: Rectangle;
    private restartButton!: Rectangle;
    private menuButton!: Rectangle;
    private isVisible: boolean = false;
    private boundVisibilityHandler: EventListener;

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();

        // Create a standalone fullscreen UI for the pause screen to ensure it's on top
        this.guiTexture = AdvancedDynamicTexture.CreateFullscreenUI('pauseScreenUI', true, this.scene);
        this.guiTexture.renderAtIdealSize = true;
        this.guiTexture.layer!.layerMask = 0x10000000; // High layer mask to ensure it renders on top

        // Apply mobile scaling
        if (this.isMobileDevice()) {
            this.guiTexture.idealWidth = 600;
            this.guiTexture.useSmallestIdeal = true;
        }

        // Create UI elements
        this.createOverlay();
        this.createPauseText();
        this.createInstructionText();
        this.createResumeButton();
        this.createRestartButton();
        this.createMenuButton();

        // Initially hide UI elements
        this.isVisible = false;
        this.overlay.isVisible = false;
        this.pauseText.isVisible = false;
        this.instructionText.isVisible = false;
        this.resumeButton.isVisible = false;
        this.restartButton.isVisible = false;
        this.menuButton.isVisible = false;

        // Bind the handler once to maintain the same reference
        this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);

        // Add tab visibility listener
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    }

    private isMobileDevice(): boolean {
        return ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
               window.innerWidth < 1024;
    }

    private handleVisibilityChange(): void {
        console.log('Visibility changed, document.hidden:', document.hidden);
        if (document.hidden) {
            console.log('Tab hidden, pausing game');
            // Call game.pause() directly
            this.game.pause();
        }
    }

    private createOverlay(): void {
        this.overlay = new Rectangle('pauseOverlay');
        this.overlay.width = 1;
        this.overlay.height = 1;
        this.overlay.background = STYLE.backdropDim;
        this.overlay.thickness = 0;
        this.overlay.zIndex = 9000;
        this.overlay.isPointerBlocker = true;
        this.guiTexture.addControl(this.overlay);
    }

    private createPauseText(): void {
        const isMobile = this.isMobileDevice();
        const isLandscape = isMobile && window.innerWidth > window.innerHeight;

        this.pauseText = new TextBlock('pauseText');
        this.pauseText.text = 'GAME PAUSED';
        this.pauseText.color = '#FFFFFF';
        this.pauseText.fontSize = isLandscape ? 28 : (isMobile ? 40 : 60);
        this.pauseText.fontWeight = 'bold';
        this.pauseText.top = isLandscape ? '-55px' : (isMobile ? '-80px' : '-120px');
        this.pauseText.zIndex = 9001;
        this.pauseText.outlineWidth = 2;
        this.pauseText.outlineColor = "black";
        this.pauseText.shadowColor = "rgba(0,0,0,0.5)";
        this.pauseText.shadowBlur = isMobile ? 6 : 10;
        this.pauseText.shadowOffsetX = isMobile ? 2 : 3;
        this.pauseText.shadowOffsetY = isMobile ? 2 : 3;
        this.guiTexture.addControl(this.pauseText);
    }

    private createInstructionText(): void {
        const isMobile = this.isMobileDevice();
        const isLandscape = isMobile && window.innerWidth > window.innerHeight;

        this.instructionText = new TextBlock('instructionText');
        this.instructionText.text = isMobile
            ? 'Tap Resume to continue'
            : 'Press Escape or click Resume to continue';
        this.instructionText.color = '#B0B8C8';
        this.instructionText.fontSize = isLandscape ? 12 : (isMobile ? 16 : 22);
        this.instructionText.fontWeight = 'bold';
        this.instructionText.top = isLandscape ? '5px' : (isMobile ? '10px' : '20px');
        this.instructionText.zIndex = 9001;
        this.instructionText.outlineWidth = 1;
        this.instructionText.outlineColor = "black";
        this.guiTexture.addControl(this.instructionText);
    }

    private createResumeButton(): void {
        const isMobile = this.isMobileDevice();
        const isLandscape = isMobile && window.innerWidth > window.innerHeight;

        const width = isLandscape ? 160 : 200;
        const height = isLandscape ? '36px' : (isMobile ? '48px' : '50px');

        this.resumeButton = makeFrame({ name: 'resumeButton', sizePx: width, color: '#ffe040', cornerRadius: 10 });
        this.resumeButton.height = height;
        this.resumeButton.top = isLandscape ? '42px' : (isMobile ? '65px' : '80px');
        this.resumeButton.zIndex = 9002;
        this.resumeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.resumeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

        const label = new TextBlock('resumeLabel', 'RESUME');
        label.color = '#ffe040';
        label.fontSize = isLandscape ? 14 : (isMobile ? 18 : 22);
        label.fontWeight = 'bold';
        label.fontFamily = 'Arial';
        label.shadowColor = STYLE.textShadowColor;
        label.shadowBlur = STYLE.textShadowBlur;
        this.resumeButton.addControl(label);

        addPressFeedback(this.resumeButton, () => {
            this.game.resume();
        });

        this.guiTexture.addControl(this.resumeButton);
    }

    private createRestartButton(): void {
        const isMobile = this.isMobileDevice();
        const isLandscape = isMobile && window.innerWidth > window.innerHeight;

        const width = isLandscape ? 160 : 200;
        const height = isLandscape ? '36px' : (isMobile ? '48px' : '50px');
        const topOffset = isLandscape ? '86px' : (isMobile ? '123px' : '145px');

        this.restartButton = makeFrame({ name: 'restartButton', sizePx: width, color: '#888', cornerRadius: 10 });
        this.restartButton.height = height;
        this.restartButton.top = topOffset;
        this.restartButton.zIndex = 9002;
        this.restartButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.restartButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

        const label = new TextBlock('restartLabel', 'RESTART');
        label.color = '#cccccc';
        label.fontSize = isLandscape ? 14 : (isMobile ? 18 : 22);
        label.fontWeight = 'bold';
        label.fontFamily = 'Arial';
        label.shadowColor = STYLE.textShadowColor;
        label.shadowBlur = STYLE.textShadowBlur;
        this.restartButton.addControl(label);

        addPressFeedback(this.restartButton, () => {
            this.game.resume();
            this.game.getStateManager().changeState('survivors');
        });

        this.guiTexture.addControl(this.restartButton);
    }

    private createMenuButton(): void {
        const isMobile = this.isMobileDevice();
        const isLandscape = isMobile && window.innerWidth > window.innerHeight;

        const width = isLandscape ? 160 : 200;
        const height = isLandscape ? '36px' : (isMobile ? '48px' : '50px');
        const topOffset = isLandscape ? '130px' : (isMobile ? '181px' : '210px');

        this.menuButton = makeFrame({ name: 'menuButton', sizePx: width, color: '#888', cornerRadius: 10 });
        this.menuButton.height = height;
        this.menuButton.top = topOffset;
        this.menuButton.zIndex = 9002;
        this.menuButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.menuButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

        const label = new TextBlock('menuLabel', 'MAIN MENU');
        label.color = '#cccccc';
        label.fontSize = isLandscape ? 14 : (isMobile ? 18 : 22);
        label.fontWeight = 'bold';
        label.fontFamily = 'Arial';
        label.shadowColor = STYLE.textShadowColor;
        label.shadowBlur = STYLE.textShadowBlur;
        this.menuButton.addControl(label);

        addPressFeedback(this.menuButton, () => {
            this.game.resume();
            this.game.getStateManager().changeState('menu');
        });

        this.guiTexture.addControl(this.menuButton);
    }

    public show(): void {
        if (this.isVisible) return;

        console.log('Showing pause screen');
        this.isVisible = true;
        this.overlay.isVisible = true;
        this.pauseText.isVisible = true;
        this.instructionText.isVisible = true;
        this.resumeButton.isVisible = true;
        this.restartButton.isVisible = true;
        this.menuButton.isVisible = true;

        // Force the screen to be dirty to ensure it renders
        this.guiTexture.markAsDirty();
    }

    public hide(): void {
        if (!this.isVisible) return;

        console.log('Hiding pause screen');
        this.isVisible = false;
        this.overlay.isVisible = false;
        this.pauseText.isVisible = false;
        this.instructionText.isVisible = false;
        this.resumeButton.isVisible = false;
        this.restartButton.isVisible = false;
        this.menuButton.isVisible = false;
    }

    public dispose(): void {
        // Remove event listener when disposed
        document.removeEventListener('visibilitychange', this.boundVisibilityHandler);

        // Safely dispose the texture
        if (this.guiTexture) {
            this.guiTexture.dispose();
        }
    }
}
