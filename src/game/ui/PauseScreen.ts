import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, TextBlock } from '@babylonjs/gui';
import { Game } from '../Game';

export class PauseScreen {
    private game: Game;
    private scene: Scene;
    private guiTexture: AdvancedDynamicTexture;
    private overlay!: Rectangle;
    private pauseText!: TextBlock;
    private instructionText!: TextBlock;
    private resumeButton!: Button;
    private isVisible: boolean = false;
    private boundVisibilityHandler: EventListener;

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();

        // Create a standalone fullscreen UI for the pause screen to ensure it's on top
        this.guiTexture = AdvancedDynamicTexture.CreateFullscreenUI('pauseScreenUI', true, this.scene);
        this.guiTexture.renderAtIdealSize = true;
        this.guiTexture.layer!.layerMask = 0x10000000; // High layer mask to ensure it renders on top

        // Create UI elements
        this.createOverlay();
        this.createPauseText();
        this.createInstructionText();
        this.createResumeButton();

        // Initially hide UI elements
        this.isVisible = false;
        this.overlay.isVisible = false;
        this.pauseText.isVisible = false;
        this.instructionText.isVisible = false;
        this.resumeButton.isVisible = false;

        // Bind the handler once to maintain the same reference
        this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);

        // Add tab visibility listener
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);
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
        this.overlay.background = 'black';
        this.overlay.alpha = 0.8;
        this.overlay.zIndex = 9000;
        this.overlay.isPointerBlocker = true;
        this.guiTexture.addControl(this.overlay);
    }

    private createPauseText(): void {
        this.pauseText = new TextBlock('pauseText');
        this.pauseText.text = 'GAME PAUSED';
        this.pauseText.color = '#FFFFFF';
        this.pauseText.fontSize = 60;
        this.pauseText.fontWeight = 'bold';
        this.pauseText.top = '-120px';
        this.pauseText.zIndex = 9001;
        this.pauseText.outlineWidth = 2;
        this.pauseText.outlineColor = "black";
        this.pauseText.shadowColor = "rgba(0,0,0,0.5)";
        this.pauseText.shadowBlur = 10;
        this.pauseText.shadowOffsetX = 3;
        this.pauseText.shadowOffsetY = 3;
        this.guiTexture.addControl(this.pauseText);
    }

    private createInstructionText(): void {
        this.instructionText = new TextBlock('instructionText');
        this.instructionText.text = 'Press Escape or click Resume to continue';
        this.instructionText.color = '#B0B8C8';
        this.instructionText.fontSize = 22;
        this.instructionText.fontWeight = 'bold';
        this.instructionText.top = '20px';
        this.instructionText.zIndex = 9001;
        this.instructionText.outlineWidth = 1;
        this.instructionText.outlineColor = "black";
        this.guiTexture.addControl(this.instructionText);
    }

    private createResumeButton(): void {
        this.resumeButton = Button.CreateSimpleButton('resumeButton', 'RESUME');
        this.resumeButton.width = '200px';
        this.resumeButton.height = '50px';
        this.resumeButton.color = '#FFFFFF';
        this.resumeButton.background = '#4CAF50';
        this.resumeButton.cornerRadius = 32;
        this.resumeButton.thickness = 0;
        this.resumeButton.fontFamily = 'Arial';
        this.resumeButton.fontSize = 22;
        this.resumeButton.fontWeight = 'bold';
        this.resumeButton.top = '80px';
        this.resumeButton.zIndex = 9002;
        this.resumeButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        this.resumeButton.shadowBlur = 5;
        this.resumeButton.shadowOffsetY = 2;
        this.resumeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.resumeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

        this.resumeButton.onPointerEnterObservable.add(() => {
            this.resumeButton.background = '#66BB6A';
            this.resumeButton.scaleX = 1.05;
            this.resumeButton.scaleY = 1.05;
        });
        this.resumeButton.onPointerOutObservable.add(() => {
            this.resumeButton.background = '#4CAF50';
            this.resumeButton.scaleX = 1.0;
            this.resumeButton.scaleY = 1.0;
        });
        this.resumeButton.onPointerUpObservable.add(() => {
            this.game.resume();
        });

        this.guiTexture.addControl(this.resumeButton);
    }

    public show(): void {
        if (this.isVisible) return;

        console.log('Showing pause screen');
        this.isVisible = true;
        this.overlay.isVisible = true;
        this.pauseText.isVisible = true;
        this.instructionText.isVisible = true;
        this.resumeButton.isVisible = true;

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
