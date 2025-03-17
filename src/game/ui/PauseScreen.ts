import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock } from '@babylonjs/gui';
import { Game } from '../Game';

export class PauseScreen {
    private game: Game;
    private scene: Scene;
    private guiTexture: AdvancedDynamicTexture;
    private overlay!: Rectangle;
    private pauseText!: TextBlock;
    private instructionText!: TextBlock;
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
        
        // Initially hide UI elements
        this.isVisible = false;
        this.overlay.isVisible = false;
        this.pauseText.isVisible = false;
        this.instructionText.isVisible = false;
        
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
        this.overlay.alpha = 0.8; // Increased opacity for better visibility
        this.overlay.zIndex = 9000; // Very high z-index to ensure it's on top
        this.overlay.isPointerBlocker = true;
        this.guiTexture.addControl(this.overlay);
    }

    private createPauseText(): void {
        this.pauseText = new TextBlock('pauseText');
        this.pauseText.text = 'GAME PAUSED';
        this.pauseText.color = 'white';
        this.pauseText.fontSize = 60; // Larger font size
        this.pauseText.fontWeight = 'bold';
        this.pauseText.top = '-120px';
        this.pauseText.zIndex = 9001;
        this.pauseText.outlineWidth = 2; // Thicker outline
        this.pauseText.outlineColor = "black";
        this.pauseText.shadowColor = "rgba(0,0,0,0.5)";
        this.pauseText.shadowBlur = 10;
        this.pauseText.shadowOffsetX = 3;
        this.pauseText.shadowOffsetY = 3;
        this.guiTexture.addControl(this.pauseText);
    }

    private createInstructionText(): void {
        this.instructionText = new TextBlock('instructionText');
        this.instructionText.text = 'Click the ▶️ button in the top right to resume';
        this.instructionText.color = 'white';
        this.instructionText.fontSize = 24;
        this.instructionText.fontWeight = 'bold';
        this.instructionText.top = '60px';
        this.instructionText.zIndex = 9001;
        this.instructionText.outlineWidth = 1;
        this.instructionText.outlineColor = "black";
        this.guiTexture.addControl(this.instructionText);
    }

    public show(): void {
        if (this.isVisible) return;
        
        console.log('Showing pause screen');
        this.isVisible = true;
        this.overlay.isVisible = true;
        this.pauseText.isVisible = true;
        this.instructionText.isVisible = true;
        
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