import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { PlayerStats } from '../gameplay/PlayerStats';

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

        // Check if player won or lost
        const stateManager = this.game.getStateManager();
        const previousState = stateManager.getCurrentStateName();

        if (previousState === 'gameplay') {
            const scene = this.game.getScene();
            this.playerStats = scene.metadata?.playerStats as PlayerStats;
            if (this.playerStats) {
                this.playerWon = this.playerStats.hasWon();
            }
        }

        // Create UI
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
        // Nothing to update in game over state
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    private createUI(): void {
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('gameOverUI', true, this.game.getScene());

        // Dark overlay alpha 0.92
        const background = new Rectangle();
        background.width = '100%';
        background.height = '100%';
        background.background = '#000000';
        background.alpha = 0.92;
        background.thickness = 0;
        this.ui.addControl(background);

        // Title: "VICTORY" or "DEFEAT" with gold outline
        const titleText = new TextBlock('titleText');
        titleText.text = this.playerWon ? 'VICTORY' : 'DEFEAT';
        titleText.color = this.playerWon ? '#4CAF50' : '#E53935';
        titleText.fontSize = 72;
        titleText.top = '-220px';
        titleText.fontFamily = 'Arial';
        titleText.fontWeight = 'bold';
        titleText.shadowColor = 'rgba(0,0,0,0.8)';
        titleText.shadowBlur = 10;
        titleText.shadowOffsetX = 3;
        titleText.shadowOffsetY = 3;
        titleText.outlineWidth = 2;
        titleText.outlineColor = '#F5A623';
        this.ui.addControl(titleText);

        // Subtitle message
        const messageText = new TextBlock('messageText');
        messageText.text = this.playerWon
            ? 'Congratulations! You defended your base!'
            : 'Your base has been overrun!';
        messageText.color = '#B0B8C8';
        messageText.fontSize = 22;
        messageText.top = '-155px';
        messageText.fontFamily = 'Arial';
        this.ui.addControl(messageText);

        // Stats panel with dark background and cornerRadius: 12
        if (this.playerStats) {
            const statsPanel = new Rectangle('statsPanel');
            statsPanel.width = '380px';
            statsPanel.height = '240px';
            statsPanel.background = 'rgba(28, 32, 40, 0.95)';
            statsPanel.cornerRadius = 12;
            statsPanel.thickness = 1;
            statsPanel.color = '#3A3F4B';
            statsPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            statsPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            statsPanel.top = '-10px';
            this.ui.addControl(statsPanel);

            // Stats header
            const statsHeader = new TextBlock('statsHeader', 'BATTLE STATS');
            statsHeader.color = '#F5A623';
            statsHeader.fontSize = 22;
            statsHeader.fontWeight = 'bold';
            statsHeader.top = '-90px';
            statsHeader.fontFamily = 'Arial';
            statsPanel.addControl(statsHeader);

            // Build stats text - no emoji, text labels only
            const timePlayed = this.formatTime(this.playerStats.getTimePlayed());
            const kills = this.playerStats.getTotalKills();
            const moneyEarned = this.playerStats.getTotalMoneyEarned();
            const towersBuilt = this.playerStats.getTowersBuilt();
            const damageDealt = Math.round(this.playerStats.getTotalDamageDealt());

            const statsLines = [
                `Time:      ${timePlayed}`,
                `Kills:     ${kills}`,
                `Gold:      $${moneyEarned}`,
                `Towers:    ${towersBuilt}`,
                `Damage:    ${damageDealt}`
            ];

            const statsText = new TextBlock('statsText');
            statsText.text = statsLines.join('\n');
            statsText.color = '#FFFFFF';
            statsText.fontSize = 18;
            statsText.fontFamily = 'Arial';
            statsText.lineSpacing = '8px';
            statsText.top = '15px';
            statsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            statsText.paddingLeft = '40px';
            statsPanel.addControl(statsText);
        }

        // PLAY AGAIN button - 280px wide, pill shape, 60px height
        const restartButton = Button.CreateSimpleButton('restartButton', 'PLAY AGAIN');
        restartButton.width = '280px';
        restartButton.height = '60px';
        restartButton.color = '#FFFFFF';
        restartButton.background = '#4CAF50';
        restartButton.cornerRadius = 32;
        restartButton.thickness = 0;
        restartButton.fontFamily = 'Arial';
        restartButton.fontSize = 24;
        restartButton.fontWeight = 'bold';
        restartButton.top = '140px';
        restartButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        restartButton.shadowBlur = 5;
        restartButton.shadowOffsetY = 2;
        restartButton.onPointerEnterObservable.add(() => {
            restartButton.background = '#66BB6A';
            restartButton.scaleX = 1.05;
            restartButton.scaleY = 1.05;
        });
        restartButton.onPointerOutObservable.add(() => {
            restartButton.background = '#4CAF50';
            restartButton.scaleX = 1.0;
            restartButton.scaleY = 1.0;
        });
        restartButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('gameplay');
        });
        this.ui.addControl(restartButton);

        // MAIN MENU button - 280px wide, pill shape, 60px height
        const menuButton = Button.CreateSimpleButton('menuButton', 'MAIN MENU');
        menuButton.width = '280px';
        menuButton.height = '60px';
        menuButton.color = '#FFFFFF';
        menuButton.background = '#2196F3';
        menuButton.cornerRadius = 32;
        menuButton.thickness = 0;
        menuButton.fontFamily = 'Arial';
        menuButton.fontSize = 24;
        menuButton.fontWeight = 'bold';
        menuButton.top = '215px';
        menuButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        menuButton.shadowBlur = 5;
        menuButton.shadowOffsetY = 2;
        menuButton.onPointerEnterObservable.add(() => {
            menuButton.background = '#42A5F5';
            menuButton.scaleX = 1.05;
            menuButton.scaleY = 1.05;
        });
        menuButton.onPointerOutObservable.add(() => {
            menuButton.background = '#2196F3';
            menuButton.scaleX = 1.0;
            menuButton.scaleY = 1.0;
        });
        menuButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('menu');
        });
        this.ui.addControl(menuButton);
    }
}
