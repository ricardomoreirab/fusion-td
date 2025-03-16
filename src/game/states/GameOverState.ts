import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { PlayerStats } from '../gameplay/PlayerStats';

export class GameOverState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private playerWon: boolean = false;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering game over state');
        
        // Check if player won or lost
        const stateManager = this.game.getStateManager();
        const previousState = stateManager.getCurrentStateName();
        
        if (previousState === 'gameplay') {
            // Get player stats from gameplay state to determine win/loss
            const scene = this.game.getScene();
            const playerStats = scene.metadata?.playerStats as PlayerStats;
            if (playerStats) {
                this.playerWon = playerStats.hasWon();
            }
        }
        
        // Create UI
        this.createUI();
    }

    public exit(): void {
        console.log('Exiting game over state');
        
        // Dispose UI
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
    }

    public update(deltaTime: number): void {
        // Nothing to update in game over state
    }

    private createUI(): void {
        // Create fullscreen UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('gameOverUI', true, this.game.getScene());
        
        // Create background
        const background = new Rectangle();
        background.width = '100%';
        background.height = '100%';
        background.background = '#000000';
        background.alpha = 0.8;
        background.thickness = 0;
        this.ui.addControl(background);
        
        // Create title
        const titleText = new TextBlock('titleText');
        titleText.text = this.playerWon ? 'VICTORY!' : 'GAME OVER';
        titleText.color = this.playerWon ? '#4CAF50' : '#F44336';
        titleText.fontSize = 80;
        titleText.top = '-200px';
        titleText.fontFamily = 'Arial';
        titleText.shadowColor = 'black';
        titleText.shadowBlur = 5;
        titleText.shadowOffsetX = 3;
        titleText.shadowOffsetY = 3;
        this.ui.addControl(titleText);
        
        // Create message
        const messageText = new TextBlock('messageText');
        messageText.text = this.playerWon 
            ? 'Congratulations! You have successfully defended your base!'
            : 'Your base has been overrun by enemies!';
        messageText.color = 'white';
        messageText.fontSize = 24;
        messageText.top = '-100px';
        messageText.fontFamily = 'Arial';
        this.ui.addControl(messageText);
        
        // Create restart button with mobile-friendly dimensions
        const restartButton = Button.CreateSimpleButton('restartButton', 'PLAY AGAIN');
        restartButton.width = '220px';
        restartButton.height = '60px';
        restartButton.color = 'white';
        restartButton.background = '#4CAF50';
        restartButton.cornerRadius = 30;
        restartButton.thickness = 2;
        restartButton.fontFamily = 'Arial';
        restartButton.fontSize = 24;
        restartButton.fontWeight = 'bold';
        restartButton.top = '50px';
        restartButton.paddingLeft = '20px';
        restartButton.paddingRight = '20px';
        restartButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        restartButton.shadowBlur = 5;
        restartButton.shadowOffsetY = 2;
        restartButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('gameplay');
        });
        this.ui.addControl(restartButton);
        
        // Create menu button with mobile-friendly dimensions
        const menuButton = Button.CreateSimpleButton('menuButton', 'MAIN MENU');
        menuButton.width = '220px';
        menuButton.height = '60px';
        menuButton.color = 'white';
        menuButton.background = '#2196F3';
        menuButton.cornerRadius = 30;
        menuButton.thickness = 2;
        menuButton.fontFamily = 'Arial';
        menuButton.fontSize = 24;
        menuButton.fontWeight = 'bold';
        menuButton.top = '130px';
        menuButton.paddingLeft = '20px';
        menuButton.paddingRight = '20px';
        menuButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        menuButton.shadowBlur = 5;
        menuButton.shadowOffsetY = 2;
        menuButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('menu');
        });
        this.ui.addControl(menuButton);
    }
} 