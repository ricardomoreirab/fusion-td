import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { PlayerStats } from '../gameplay/PlayerStats';

export interface SurvivorsRunSummary {
    waveReached: number;
    timeSurvivedSec: number;
    kills: number;
    goldCollected: number;
    finalLoadout: { name: string; level: number; icon: string }[];
}

export class GameOverState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private playerWon: boolean = false;
    private playerStats: PlayerStats | null = null;
    private survivorsSummary: SurvivorsRunSummary | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public setSurvivorsSummary(summary: SurvivorsRunSummary): void {
        this.survivorsSummary = summary;
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
        this.survivorsSummary = null;
    }

    public update(deltaTime: number): void {
        // Nothing to update in game over state
    }

    private isMobileDevice(): boolean {
        return ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
               window.innerWidth < 1024;
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    private createUI(): void {
        const isMobile = this.isMobileDevice();
        const isLandscape = isMobile && window.innerWidth > window.innerHeight;

        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('gameOverUI', true, this.game.getScene());

        if (isMobile) {
            this.ui.idealWidth = 600;
            this.ui.useSmallestIdeal = true;
        }

        // Dark overlay alpha 0.92
        const background = new Rectangle();
        background.width = '100%';
        background.height = '100%';
        background.background = '#000000';
        background.alpha = 0.92;
        background.thickness = 0;
        background.isPointerBlocker = true;
        this.ui.addControl(background);

        // If we have a survivors run summary, render it instead of the TD stats
        if (this.survivorsSummary) {
            this.createSurvivorsUI(isMobile, isLandscape);
            return;
        }

        // Title: "VICTORY" or "DEFEAT" with gold outline - responsive
        const titleText = new TextBlock('titleText');
        titleText.text = this.playerWon ? 'VICTORY' : 'DEFEAT';
        titleText.color = this.playerWon ? '#4CAF50' : '#E53935';
        titleText.fontSize = isLandscape ? 32 : (isMobile ? 48 : 72);
        titleText.top = isLandscape ? '-100px' : (isMobile ? '-160px' : '-220px');
        titleText.fontFamily = 'Arial';
        titleText.fontWeight = 'bold';
        titleText.shadowColor = 'rgba(0,0,0,0.8)';
        titleText.shadowBlur = isMobile ? 6 : 10;
        titleText.shadowOffsetX = isMobile ? 2 : 3;
        titleText.shadowOffsetY = isMobile ? 2 : 3;
        titleText.outlineWidth = 2;
        titleText.outlineColor = '#F5A623';
        this.ui.addControl(titleText);

        // Subtitle message - responsive
        const messageText = new TextBlock('messageText');
        messageText.text = this.playerWon
            ? 'Congratulations! You defended your base!'
            : 'Your base has been overrun!';
        messageText.color = '#B0B8C8';
        messageText.fontSize = isLandscape ? 12 : (isMobile ? 18 : 22);
        messageText.top = isLandscape ? '-72px' : (isMobile ? '-110px' : '-155px');
        messageText.fontFamily = 'Arial';
        this.ui.addControl(messageText);

        // Stats panel - responsive
        if (this.playerStats) {
            const statsPanel = new Rectangle('statsPanel');
            statsPanel.width = isLandscape ? '240px' : (isMobile ? '280px' : '380px');
            statsPanel.height = isLandscape ? '130px' : (isMobile ? '200px' : '240px');
            statsPanel.background = 'rgba(28, 32, 40, 0.95)';
            statsPanel.cornerRadius = 12;
            statsPanel.thickness = 1;
            statsPanel.color = '#3A3F4B';
            statsPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            statsPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            statsPanel.top = isLandscape ? '-5px' : (isMobile ? '-10px' : '-10px');
            this.ui.addControl(statsPanel);

            // Stats header
            const statsHeader = new TextBlock('statsHeader', 'BATTLE STATS');
            statsHeader.color = '#F5A623';
            statsHeader.fontSize = isLandscape ? 13 : (isMobile ? 18 : 22);
            statsHeader.fontWeight = 'bold';
            statsHeader.top = isLandscape ? '-46px' : (isMobile ? '-65px' : '-90px');
            statsHeader.fontFamily = 'Arial';
            statsPanel.addControl(statsHeader);

            // Build stats text
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
            statsText.fontSize = isLandscape ? 10 : (isMobile ? 14 : 18);
            statsText.fontFamily = 'Arial';
            statsText.lineSpacing = isLandscape ? '2px' : (isMobile ? '6px' : '8px');
            statsText.top = isLandscape ? '6px' : (isMobile ? '10px' : '15px');
            statsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            statsText.paddingLeft = isLandscape ? '20px' : (isMobile ? '24px' : '40px');
            statsPanel.addControl(statsText);
        }

        // Responsive button sizes
        const btnWidth = isLandscape ? '180px' : (isMobile ? '240px' : '280px');
        const btnHeight = isLandscape ? '36px' : (isMobile ? '52px' : '60px');
        const btnFontSize = isLandscape ? 14 : (isMobile ? 20 : 24);

        // PLAY AGAIN button
        const restartButton = Button.CreateSimpleButton('restartButton', 'PLAY AGAIN');
        restartButton.width = btnWidth;
        restartButton.height = btnHeight;
        restartButton.color = '#FFFFFF';
        restartButton.background = '#4CAF50';
        restartButton.cornerRadius = 32;
        restartButton.thickness = 0;
        restartButton.fontFamily = 'Arial';
        restartButton.fontSize = btnFontSize;
        restartButton.fontWeight = 'bold';
        restartButton.top = isLandscape ? '72px' : (isMobile ? '105px' : '140px');
        restartButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        restartButton.shadowBlur = 5;
        restartButton.shadowOffsetY = 2;
        if (!isMobile) {
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
        }
        restartButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('survivors');
        });
        this.ui.addControl(restartButton);

        // MAIN MENU button
        const menuButton = Button.CreateSimpleButton('menuButton', 'MAIN MENU');
        menuButton.width = btnWidth;
        menuButton.height = btnHeight;
        menuButton.color = '#FFFFFF';
        menuButton.background = '#2196F3';
        menuButton.cornerRadius = 32;
        menuButton.thickness = 0;
        menuButton.fontFamily = 'Arial';
        menuButton.fontSize = btnFontSize;
        menuButton.fontWeight = 'bold';
        menuButton.top = isLandscape ? '115px' : (isMobile ? '170px' : '215px');
        menuButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        menuButton.shadowBlur = 5;
        menuButton.shadowOffsetY = 2;
        if (!isMobile) {
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
        }
        menuButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('menu');
        });
        this.ui.addControl(menuButton);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Survivors-mode game-over screen
    // ─────────────────────────────────────────────────────────────────────────

    private createSurvivorsUI(isMobile: boolean, isLandscape: boolean): void {
        if (!this.ui || !this.survivorsSummary) return;
        const s = this.survivorsSummary;

        // "DEFEAT" title
        const titleText = new TextBlock('svTitleText', 'DEFEATED');
        titleText.color = '#E53935';
        titleText.fontSize = isLandscape ? 32 : (isMobile ? 48 : 72);
        titleText.top = isLandscape ? '-130px' : (isMobile ? '-175px' : '-230px');
        titleText.fontFamily = 'Arial';
        titleText.fontWeight = 'bold';
        titleText.outlineWidth = 2;
        titleText.outlineColor = '#F5A623';
        this.ui.addControl(titleText);

        const subtitleText = new TextBlock('svSubtitle', 'Your run has ended');
        subtitleText.color = '#888';
        subtitleText.fontSize = isLandscape ? 12 : (isMobile ? 16 : 20);
        subtitleText.top = isLandscape ? '-92px' : (isMobile ? '-128px' : '-175px');
        subtitleText.fontFamily = 'Arial';
        this.ui.addControl(subtitleText);

        // Stats panel
        const statsPanel = new Rectangle('svStatsPanel');
        statsPanel.width = isLandscape ? '300px' : (isMobile ? '320px' : '440px');
        statsPanel.height = isLandscape ? '150px' : (isMobile ? '230px' : '270px');
        statsPanel.background = 'rgba(20, 24, 36, 0.97)';
        statsPanel.cornerRadius = 14;
        statsPanel.thickness = 1;
        statsPanel.color = '#3A3F4B';
        statsPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        statsPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        statsPanel.top = isLandscape ? '-15px' : (isMobile ? '-10px' : '-15px');
        this.ui.addControl(statsPanel);

        const statsHeader = new TextBlock('svStatsHeader', 'RUN SUMMARY');
        statsHeader.color = '#F5A623';
        statsHeader.fontSize = isLandscape ? 14 : (isMobile ? 18 : 22);
        statsHeader.fontWeight = 'bold';
        statsHeader.top = isLandscape ? '-52px' : (isMobile ? '-80px' : '-95px');
        statsHeader.fontFamily = 'Arial';
        statsPanel.addControl(statsHeader);

        const mins = Math.floor(s.timeSurvivedSec / 60);
        const secs = Math.floor(s.timeSurvivedSec % 60);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        const loadoutStr = s.finalLoadout.length > 0
            ? s.finalLoadout.map(p => `${p.icon} ${p.name} Lv${p.level}`).join('  ')
            : '(no powers)';

        const statsLines = [
            `Wave Reached:   ${s.waveReached}`,
            `Time Survived:  ${timeStr}`,
            `Enemies Slain:  ${s.kills}`,
            `Gold Collected: ${s.goldCollected}`,
            `Powers:  ${loadoutStr}`,
        ];

        const statsText = new TextBlock('svStatsText');
        statsText.text = statsLines.join('\n');
        statsText.color = '#FFFFFF';
        statsText.fontSize = isLandscape ? 10 : (isMobile ? 13 : 17);
        statsText.fontFamily = 'Arial';
        statsText.lineSpacing = isLandscape ? '2px' : (isMobile ? '5px' : '8px');
        statsText.top = isLandscape ? '8px' : (isMobile ? '12px' : '15px');
        statsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsText.paddingLeft = isLandscape ? '16px' : (isMobile ? '20px' : '30px');
        statsText.textWrapping = true;
        statsPanel.addControl(statsText);

        // Buttons
        const btnWidth = isLandscape ? '180px' : (isMobile ? '240px' : '280px');
        const btnHeight = isLandscape ? '36px' : (isMobile ? '52px' : '60px');
        const btnFontSize = isLandscape ? 14 : (isMobile ? 20 : 24);

        const restartBtn = Button.CreateSimpleButton('svRestart', 'PLAY AGAIN');
        restartBtn.width = btnWidth;
        restartBtn.height = btnHeight;
        restartBtn.color = '#FFFFFF';
        restartBtn.background = '#4CAF50';
        restartBtn.cornerRadius = 32;
        restartBtn.thickness = 0;
        restartBtn.fontFamily = 'Arial';
        restartBtn.fontSize = btnFontSize;
        restartBtn.fontWeight = 'bold';
        restartBtn.top = isLandscape ? '80px' : (isMobile ? '120px' : '155px');
        restartBtn.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('survivors');
        });
        this.ui.addControl(restartBtn);

        const menuBtn = Button.CreateSimpleButton('svMenu', 'MAIN MENU');
        menuBtn.width = btnWidth;
        menuBtn.height = btnHeight;
        menuBtn.color = '#FFFFFF';
        menuBtn.background = '#2196F3';
        menuBtn.cornerRadius = 32;
        menuBtn.thickness = 0;
        menuBtn.fontFamily = 'Arial';
        menuBtn.fontSize = btnFontSize;
        menuBtn.fontWeight = 'bold';
        menuBtn.top = isLandscape ? '125px' : (isMobile ? '185px' : '230px');
        menuBtn.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('menu');
        });
        this.ui.addControl(menuBtn);
    }
}
