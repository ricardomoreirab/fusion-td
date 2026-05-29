import { Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle, InputText } from '@babylonjs/gui';
import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { PlayerStats } from '../survivors/PlayerStats';
import { makeFrame, addPressFeedback, tryHaptic, STYLE } from '../shared/ui/HudStyle';
import { GameSettings } from '../shared/GameSettings';
import { submitScore } from '../survivors/Leaderboard';
import { LeaderboardPanel } from '../shared/ui/LeaderboardPanel';

export interface SurvivorsRunSummary {
    waveReached: number;
    timeSurvivedSec: number;
    kills: number;
    goldCollected: number;
    finalLoadout: { name: string; level: number; icon: string; tier?: string }[];
    championType?: string;
}

export class GameOverState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private playerWon: boolean = false;
    private playerStats: PlayerStats | null = null;
    private survivorsSummary: SurvivorsRunSummary | null = null;
    private lbOpen = false;

    constructor(game: Game) {
        this.game = game;
    }

    public setSurvivorsSummary(summary: SurvivorsRunSummary): void {
        this.survivorsSummary = summary;
    }

    public enter(): void {
        console.log('Entering game over state');
        tryHaptic(20);

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

        // Dark overlay
        const background = new Rectangle();
        background.width = '100%';
        background.height = '100%';
        background.background = STYLE.backdropDim;
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

        // Stats panel — neon-glass with red border
        const panelWidthPx = isLandscape ? 300 : (isMobile ? 320 : 440);
        const panelHeightPx = isLandscape ? 150 : (isMobile ? 230 : 270);
        const statsPanel = makeFrame({ name: 'svStatsPanel', sizePx: panelWidthPx, color: '#c33', cornerRadius: 14 });
        statsPanel.width = `${panelWidthPx}px`;
        statsPanel.height = `${panelHeightPx}px`;
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
        const tierBadge = (t?: string) => (t === 'ultimate' ? '✪ ' : t === 'fusion' ? '✦ ' : '');
        const loadoutStr = s.finalLoadout.length > 0
            ? s.finalLoadout.map(p => `${tierBadge(p.tier)}${p.icon} ${p.name} Lv${p.level}`).join('  ')
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

        // Buttons — neon-glass frames with press feedback
        const btnWidthPx = isLandscape ? 180 : (isMobile ? 240 : 280);
        const btnHeightPx = isLandscape ? 36 : (isMobile ? 52 : 60);
        const btnFontSize = isLandscape ? 14 : (isMobile ? 20 : 24);

        const restartBtn = makeFrame({ name: 'svRestart', sizePx: btnWidthPx, color: '#888', cornerRadius: 10 });
        restartBtn.width = `${btnWidthPx}px`;
        restartBtn.height = `${btnHeightPx}px`;
        restartBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        restartBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        restartBtn.top = isLandscape ? '80px' : (isMobile ? '120px' : '155px');
        const restartLabel = new TextBlock('svRestartLabel', 'PLAY AGAIN');
        restartLabel.color = '#FFFFFF';
        restartLabel.fontSize = btnFontSize;
        restartLabel.fontWeight = 'bold';
        restartLabel.fontFamily = 'Arial';
        restartBtn.addControl(restartLabel);
        addPressFeedback(restartBtn, () => {
            this.game.getStateManager().changeState('survivors');
        });
        this.ui.addControl(restartBtn);

        const menuBtn = makeFrame({ name: 'svMenu', sizePx: btnWidthPx, color: '#888', cornerRadius: 10 });
        menuBtn.width = `${btnWidthPx}px`;
        menuBtn.height = `${btnHeightPx}px`;
        menuBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        menuBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        menuBtn.top = isLandscape ? '125px' : (isMobile ? '185px' : '230px');
        const menuLabel = new TextBlock('svMenuLabel', 'MAIN MENU');
        menuLabel.color = '#FFFFFF';
        menuLabel.fontSize = btnFontSize;
        menuLabel.fontWeight = 'bold';
        menuLabel.fontFamily = 'Arial';
        menuBtn.addControl(menuLabel);
        addPressFeedback(menuBtn, () => {
            this.game.getStateManager().changeState('menu');
        });
        this.ui.addControl(menuBtn);

        this.addLeaderboardSection(isMobile, isLandscape);
    }

    /**
     * Bottom-anchored leaderboard submit row: a name field (pre-filled from the
     * last-used name) + a submit button. On success the button becomes a
     * "RANKED #N — VIEW BOARD" action that opens the full panel. Anchored to the
     * screen bottom so it never collides with the centered stats/buttons stack.
     */
    private addLeaderboardSection(isMobile: boolean, isLandscape: boolean): void {
        if (!this.ui || !this.survivorsSummary) return;
        const summary = this.survivorsSummary;

        const fieldWidthPx = isLandscape ? 200 : (isMobile ? 240 : 280);
        const rowHeightPx = isLandscape ? 34 : (isMobile ? 44 : 48);
        const fontSize = isLandscape ? 14 : (isMobile ? 16 : 18);
        const nameTop = isLandscape ? -92 : (isMobile ? -150 : -172);
        const submitTop = isLandscape ? -50 : (isMobile ? -98 : -112);

        const nameInput = new InputText('lbName');
        nameInput.width = `${fieldWidthPx}px`;
        nameInput.height = `${rowHeightPx}px`;
        nameInput.text = GameSettings.getLeaderboardName();
        nameInput.placeholderText = 'Enter your name';
        nameInput.placeholderColor = '#888';
        nameInput.color = '#FFFFFF';
        nameInput.background = STYLE.panelBg;
        nameInput.focusedBackground = STYLE.panelBg;
        nameInput.fontSize = fontSize;
        nameInput.fontFamily = 'Arial';
        nameInput.thickness = 2;
        nameInput.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameInput.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        nameInput.top = `${nameTop}px`;
        this.ui.addControl(nameInput);

        const submitBtn = makeFrame({ name: 'lbSubmit', sizePx: fieldWidthPx, color: '#F5A623', cornerRadius: 10 });
        submitBtn.width = `${fieldWidthPx}px`;
        submitBtn.height = `${rowHeightPx}px`;
        submitBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        submitBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        submitBtn.top = `${submitTop}px`;
        const submitLabel = new TextBlock('lbSubmitLabel', '🏆 SUBMIT SCORE');
        submitLabel.color = '#FFFFFF';
        submitLabel.fontSize = fontSize;
        submitLabel.fontWeight = 'bold';
        submitLabel.fontFamily = 'Arial';
        submitBtn.addControl(submitLabel);
        this.ui.addControl(submitBtn);

        let submitted = false;
        addPressFeedback(submitBtn, () => {
            if (submitted) {
                this.openLeaderboard();
                return;
            }
            const name = nameInput.text.trim();
            if (name.length === 0) {
                submitLabel.text = 'ENTER A NAME FIRST';
                return;
            }
            GameSettings.setLeaderboardName(name);
            submitLabel.text = 'SUBMITTING…';
            submitBtn.isEnabled = false; // block double-taps from posting duplicate rows
            void submitScore(summary, name).then((result) => {
                if (!this.ui) return; // screen exited mid-submit — controls are disposed
                submitBtn.isEnabled = true;
                if (result) {
                    submitted = true;
                    submitLabel.text = `RANKED #${result.rank} — VIEW BOARD`;
                    nameInput.isVisible = false;
                } else {
                    submitLabel.text = 'FAILED — TAP TO RETRY';
                }
            });
        });
    }

    private openLeaderboard(): void {
        if (!this.ui || this.lbOpen) return; // guard against stacking panels on rapid taps
        this.lbOpen = true;
        const panel = new LeaderboardPanel(this.ui, () => { this.lbOpen = false; });
        void panel.open();
    }
}
