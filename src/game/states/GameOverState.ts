import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle, Grid } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { PlayerStats } from '../gameplay/PlayerStats';
import { PALETTE, FONTS, UI } from '../rendering/StyleConstants';

export class GameOverState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private playerWon: boolean = false;
    private playerStats: PlayerStats | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering game over state');

        const stateManager = this.game.getStateManager();
        const previousState = stateManager.getCurrentStateName();

        if (previousState === 'gameplay') {
            const scene = this.game.getScene();
            this.playerStats = scene.metadata?.playerStats as PlayerStats;
            if (this.playerStats) {
                this.playerWon = this.playerStats.hasWon();
            }
        }

        this.createUI();
    }

    public exit(): void {
        console.log('Exiting game over state');
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
        this.playerStats = null;
    }

    public update(deltaTime: number): void {
        // Nothing to update
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    private createUI(): void {
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('gameOverUI', true, this.game.getScene());

        // Dark overlay
        const background = new Rectangle('bg');
        background.width = '100%';
        background.height = '100%';
        background.background = 'rgba(13, 17, 23, 0.95)';
        background.thickness = 0;
        this.ui.addControl(background);

        // Main card container
        const card = new Rectangle('gameOverCard');
        card.width = '440px';
        card.height = '520px';
        card.background = PALETTE.UI_PANEL_SOLID;
        card.cornerRadius = UI.RADIUS_LG;
        card.thickness = 1;
        card.color = PALETTE.UI_PANEL_BORDER;
        card.shadowColor = UI.SHADOW_LG;
        card.shadowBlur = UI.BLUR_XL;
        card.shadowOffsetY = 8;
        card.top = '-10px';
        this.ui.addControl(card);

        // Accent stripe at top of card
        const accentStripe = new Rectangle('accentStripe');
        accentStripe.width = '100%';
        accentStripe.height = '4px';
        accentStripe.background = this.playerWon ? PALETTE.UI_BUTTON_PRIMARY : PALETTE.UI_BUTTON_DANGER;
        accentStripe.thickness = 0;
        accentStripe.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        card.addControl(accentStripe);

        // Title: "VICTORY" or "DEFEAT"
        const titleText = new TextBlock('titleText');
        titleText.text = this.playerWon ? 'VICTORY' : 'DEFEAT';
        titleText.color = this.playerWon ? PALETTE.UI_BUTTON_PRIMARY_HOVER : PALETTE.UI_BUTTON_DANGER_HOVER;
        titleText.fontSize = 56;
        titleText.fontFamily = FONTS.TITLE;
        titleText.fontWeight = '900';
        titleText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        titleText.top = '28px';
        titleText.shadowColor = this.playerWon ? UI.SHADOW_GLOW_GREEN : UI.SHADOW_GLOW_RED;
        titleText.shadowBlur = 20;
        card.addControl(titleText);

        // Subtitle message
        const messageText = new TextBlock('messageText');
        messageText.text = this.playerWon
            ? 'Congratulations! You defended your base!'
            : 'Your base has been overrun!';
        messageText.color = PALETTE.UI_TEXT_SECONDARY;
        messageText.fontSize = 15;
        messageText.fontFamily = FONTS.UI;
        messageText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        messageText.top = '92px';
        card.addControl(messageText);

        // Decorative line
        const line = new Rectangle('line');
        line.width = '80%';
        line.height = '1px';
        line.background = PALETTE.UI_DIVIDER;
        line.thickness = 0;
        line.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        line.top = '120px';
        card.addControl(line);

        // Stats section
        if (this.playerStats) {
            // Section label
            const statsLabel = new TextBlock('statsLabel', 'BATTLE STATS');
            statsLabel.color = PALETTE.UI_ACCENT_GOLD;
            statsLabel.fontSize = 14;
            statsLabel.fontFamily = FONTS.UI;
            statsLabel.fontWeight = '700';
            statsLabel.text = 'B A T T L E   S T A T S';
            statsLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            statsLabel.top = '136px';
            card.addControl(statsLabel);

            // Stats grid
            const statsGrid = new Grid('statsGrid');
            statsGrid.addColumnDefinition(0.5);
            statsGrid.addColumnDefinition(0.5);
            statsGrid.addRowDefinition(1/3);
            statsGrid.addRowDefinition(1/3);
            statsGrid.addRowDefinition(1/3);
            statsGrid.width = '85%';
            statsGrid.height = '170px';
            statsGrid.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            statsGrid.top = '168px';
            card.addControl(statsGrid);

            const timePlayed = this.formatTime(this.playerStats.getTimePlayed());
            const kills = this.playerStats.getTotalKills();
            const moneyEarned = this.playerStats.getTotalMoneyEarned();
            const towersBuilt = this.playerStats.getTowersBuilt();
            const damageDealt = Math.round(this.playerStats.getTotalDamageDealt());
            const wavesCompleted = this.playerStats.getWavesCompleted();

            const stats = [
                { label: 'TIME', value: timePlayed, color: PALETTE.UI_TEXT_PRIMARY },
                { label: 'KILLS', value: `${kills}`, color: PALETTE.UI_BUTTON_DANGER_HOVER },
                { label: 'GOLD EARNED', value: `$${moneyEarned}`, color: PALETTE.UI_ACCENT_GOLD },
                { label: 'TOWERS', value: `${towersBuilt}`, color: PALETTE.UI_BUTTON_SECONDARY_HOVER },
                { label: 'DAMAGE', value: `${damageDealt}`, color: PALETTE.UI_BUTTON_DANGER_HOVER },
                { label: 'WAVES', value: `${wavesCompleted}`, color: PALETTE.UI_WAVE },
            ];

            stats.forEach((stat, i) => {
                const row = Math.floor(i / 2);
                const col = i % 2;

                const cell = new Rectangle(`statCell${i}`);
                cell.thickness = 0;
                cell.background = 'transparent';
                statsGrid.addControl(cell, row, col);

                const lbl = new TextBlock(`statLbl${i}`, stat.label);
                lbl.color = PALETTE.UI_TEXT_TERTIARY;
                lbl.fontSize = 10;
                lbl.fontFamily = FONTS.UI;
                lbl.fontWeight = '600';
                // No letterSpacing in Babylon GUI - using uppercase labels naturally
                lbl.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                lbl.top = '6px';
                cell.addControl(lbl);

                const val = new TextBlock(`statVal${i}`, stat.value);
                val.color = stat.color;
                val.fontSize = 22;
                val.fontFamily = FONTS.UI;
                val.fontWeight = '800';
                val.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                val.top = '-4px';
                cell.addControl(val);
            });
        }

        // Bottom line
        const line2 = new Rectangle('line2');
        line2.width = '80%';
        line2.height = '1px';
        line2.background = PALETTE.UI_DIVIDER;
        line2.thickness = 0;
        line2.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        line2.top = '-110px';
        card.addControl(line2);

        // PLAY AGAIN button
        const restartButton = Button.CreateSimpleButton('restartButton', 'PLAY AGAIN');
        restartButton.width = '280px';
        restartButton.height = '52px';
        restartButton.color = '#FFFFFF';
        restartButton.background = PALETTE.UI_BUTTON_PRIMARY;
        restartButton.cornerRadius = UI.RADIUS_LG;
        restartButton.thickness = 0;
        restartButton.fontFamily = FONTS.UI;
        restartButton.fontSize = 18;
        restartButton.fontWeight = '700';
        restartButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        restartButton.top = '-58px';
        restartButton.shadowColor = UI.SHADOW_GLOW_GREEN;
        restartButton.shadowBlur = UI.BLUR_MD;
        restartButton.shadowOffsetY = 3;

        restartButton.onPointerEnterObservable.add(() => {
            restartButton.background = PALETTE.UI_BUTTON_PRIMARY_HOVER;
            restartButton.scaleX = 1.03;
            restartButton.scaleY = 1.03;
            restartButton.shadowBlur = UI.BLUR_LG;
        });
        restartButton.onPointerOutObservable.add(() => {
            restartButton.background = PALETTE.UI_BUTTON_PRIMARY;
            restartButton.scaleX = 1.0;
            restartButton.scaleY = 1.0;
            restartButton.shadowBlur = UI.BLUR_MD;
        });
        restartButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('gameplay');
        });
        card.addControl(restartButton);

        // MAIN MENU button
        const menuButton = Button.CreateSimpleButton('menuButton', 'MAIN MENU');
        menuButton.width = '280px';
        menuButton.height = '52px';
        menuButton.color = '#FFFFFF';
        menuButton.background = PALETTE.UI_BUTTON_MUTED;
        menuButton.cornerRadius = UI.RADIUS_LG;
        menuButton.thickness = 1;
        menuButton.fontFamily = FONTS.UI;
        menuButton.fontSize = 18;
        menuButton.fontWeight = '700';
        menuButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        menuButton.top = '-6px';

        menuButton.onPointerEnterObservable.add(() => {
            menuButton.background = PALETTE.UI_BUTTON_MUTED_HOVER;
            menuButton.scaleX = 1.03;
            menuButton.scaleY = 1.03;
        });
        menuButton.onPointerOutObservable.add(() => {
            menuButton.background = PALETTE.UI_BUTTON_MUTED;
            menuButton.scaleX = 1.0;
            menuButton.scaleY = 1.0;
        });
        menuButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('menu');
        });
        card.addControl(menuButton);
    }
}
