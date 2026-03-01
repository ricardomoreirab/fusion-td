import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, TextBlock } from '@babylonjs/gui';
import { Game } from '../Game';
import { PALETTE, FONTS, UI } from '../rendering/StyleConstants';

export class PauseScreen {
    private game: Game;
    private scene: Scene;
    private guiTexture: AdvancedDynamicTexture;
    private overlay!: Rectangle;
    private card!: Rectangle;
    private pauseText!: TextBlock;
    private hintText!: TextBlock;
    private resumeButton!: Button;
    private menuButton!: Button;
    private isVisible: boolean = false;
    private boundVisibilityHandler: EventListener;

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();

        this.guiTexture = AdvancedDynamicTexture.CreateFullscreenUI('pauseScreenUI', true, this.scene);
        this.guiTexture.renderAtIdealSize = true;
        this.guiTexture.layer!.layerMask = 0x10000000;

        this.createUI();

        this.isVisible = false;
        this.overlay.isVisible = false;

        this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    }

    private handleVisibilityChange(): void {
        console.log('Visibility changed, document.hidden:', document.hidden);
        if (document.hidden) {
            console.log('Tab hidden, pausing game');
            this.game.pause();
        }
    }

    private createUI(): void {
        // Dark overlay
        this.overlay = new Rectangle('pauseOverlay');
        this.overlay.width = 1;
        this.overlay.height = 1;
        this.overlay.background = 'rgba(13, 17, 23, 0.82)';
        this.overlay.alpha = 1;
        this.overlay.zIndex = 9000;
        this.overlay.isPointerBlocker = true;
        this.guiTexture.addControl(this.overlay);

        // Card container
        this.card = new Rectangle('pauseCard');
        this.card.width = '360px';
        this.card.height = '280px';
        this.card.background = PALETTE.UI_PANEL_SOLID;
        this.card.cornerRadius = UI.RADIUS_LG;
        this.card.thickness = 1;
        this.card.color = PALETTE.UI_PANEL_BORDER;
        this.card.zIndex = 9001;
        this.card.shadowColor = UI.SHADOW_LG;
        this.card.shadowBlur = UI.BLUR_XL;
        this.card.shadowOffsetY = 8;
        this.guiTexture.addControl(this.card);

        // Accent stripe at top
        const accent = new Rectangle('pauseAccent');
        accent.width = '100%';
        accent.height = '4px';
        accent.background = PALETTE.UI_ACCENT_GOLD;
        accent.thickness = 0;
        accent.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.card.addControl(accent);

        // "PAUSED" title
        this.pauseText = new TextBlock('pauseText');
        this.pauseText.text = 'PAUSED';
        this.pauseText.color = PALETTE.UI_ACCENT_GOLD_LIGHT;
        this.pauseText.fontSize = 36;
        this.pauseText.fontFamily = FONTS.TITLE;
        this.pauseText.fontWeight = '900';
        this.pauseText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.pauseText.top = '28px';
        this.pauseText.shadowColor = UI.SHADOW_GLOW_GOLD;
        this.pauseText.shadowBlur = 12;
        this.card.addControl(this.pauseText);

        // Subtitle hint
        this.hintText = new TextBlock('hintText');
        this.hintText.text = 'Press Escape or tap Resume to continue';
        this.hintText.color = PALETTE.UI_TEXT_TERTIARY;
        this.hintText.fontSize = 13;
        this.hintText.fontFamily = FONTS.UI;
        this.hintText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.hintText.top = '76px';
        this.card.addControl(this.hintText);

        // Divider
        const divider = new Rectangle('pauseDivider');
        divider.width = '80%';
        divider.height = '1px';
        divider.background = PALETTE.UI_DIVIDER;
        divider.thickness = 0;
        divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        divider.top = '104px';
        this.card.addControl(divider);

        // Resume button
        this.resumeButton = Button.CreateSimpleButton('resumeButton', 'RESUME');
        this.resumeButton.width = '260px';
        this.resumeButton.height = '50px';
        this.resumeButton.color = '#FFFFFF';
        this.resumeButton.background = PALETTE.UI_BUTTON_PRIMARY;
        this.resumeButton.cornerRadius = UI.RADIUS_LG;
        this.resumeButton.thickness = 0;
        this.resumeButton.fontFamily = FONTS.UI;
        this.resumeButton.fontSize = 18;
        this.resumeButton.fontWeight = '700';
        this.resumeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.resumeButton.top = '-68px';
        this.resumeButton.zIndex = 9002;
        this.resumeButton.shadowColor = UI.SHADOW_GLOW_GREEN;
        this.resumeButton.shadowBlur = UI.BLUR_MD;
        this.resumeButton.shadowOffsetY = 3;

        this.resumeButton.onPointerEnterObservable.add(() => {
            this.resumeButton.background = PALETTE.UI_BUTTON_PRIMARY_HOVER;
            this.resumeButton.scaleX = 1.03;
            this.resumeButton.scaleY = 1.03;
        });
        this.resumeButton.onPointerOutObservable.add(() => {
            this.resumeButton.background = PALETTE.UI_BUTTON_PRIMARY;
            this.resumeButton.scaleX = 1.0;
            this.resumeButton.scaleY = 1.0;
        });
        this.resumeButton.onPointerUpObservable.add(() => {
            this.game.resume();
        });
        this.card.addControl(this.resumeButton);

        // Main Menu button
        this.menuButton = Button.CreateSimpleButton('pauseMenuButton', 'MAIN MENU');
        this.menuButton.width = '260px';
        this.menuButton.height = '50px';
        this.menuButton.color = PALETTE.UI_TEXT_SECONDARY;
        this.menuButton.background = PALETTE.UI_BUTTON_MUTED;
        this.menuButton.cornerRadius = UI.RADIUS_LG;
        this.menuButton.thickness = 1;
        this.menuButton.fontFamily = FONTS.UI;
        this.menuButton.fontSize = 16;
        this.menuButton.fontWeight = '600';
        this.menuButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.menuButton.top = '-12px';
        this.menuButton.zIndex = 9002;

        this.menuButton.onPointerEnterObservable.add(() => {
            this.menuButton.background = PALETTE.UI_BUTTON_MUTED_HOVER;
        });
        this.menuButton.onPointerOutObservable.add(() => {
            this.menuButton.background = PALETTE.UI_BUTTON_MUTED;
        });
        this.menuButton.onPointerUpObservable.add(() => {
            this.game.resume();
            this.game.getStateManager().changeState('menu');
        });
        this.card.addControl(this.menuButton);
    }

    public show(): void {
        if (this.isVisible) return;

        console.log('Showing pause screen');
        this.isVisible = true;
        this.overlay.isVisible = true;

        this.guiTexture.markAsDirty();
    }

    public hide(): void {
        if (!this.isVisible) return;

        console.log('Hiding pause screen');
        this.isVisible = false;
        this.overlay.isVisible = false;
    }

    public dispose(): void {
        document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
        if (this.guiTexture) {
            this.guiTexture.dispose();
        }
    }
}
