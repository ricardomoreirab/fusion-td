import { Engine, Scene, Vector3, Color3, Color4, ArcRotateCamera, HemisphericLight, DirectionalLight, PointLight, ShadowGenerator, MeshBuilder, StandardMaterial, Texture, KeyboardEventTypes, Mesh, LinesMesh, Matrix, PointerEventTypes, PointerInfo, AbstractMesh, ParticleSystem } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, TextBlock, Image, Grid, StackPanel } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { TowerManager } from '../gameplay/TowerManager';
import { EnemyManager } from '../gameplay/EnemyManager';
import { WaveManager } from '../gameplay/WaveManager';
import { PlayerStats } from '../gameplay/PlayerStats';
import { Tower, ElementType } from '../gameplay/towers/Tower';
import { WaveStatus } from '../gameplay/WaveStatus';
import { DamageNumberManager } from '../gameplay/DamageNumberManager';

export class GameplayState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private map: Map | null = null;
    private towerManager: TowerManager | null = null;
    private enemyManager: EnemyManager | null = null;
    private waveManager: WaveManager | null = null;
    private playerStats: PlayerStats | null = null;
    private isPaused: boolean = false;
    private selectedTowerType: string | null = null;
    private towerPreview: Mesh | null = null;
    private squareOutline: LinesMesh | null = null;
    private confirmationButtons: { container: Rectangle | null, position: Vector3 | null } = { container: null, position: null };
    private placementState: 'selecting' | 'confirming' = 'selecting';
    private scene: Scene | null = null;
    private selectedTower: Tower | null = null;
    private sellButton: Rectangle | null = null;
    private upgradeButton: Rectangle | null = null;
    private towerInfoPanel: Rectangle | null = null;
    private iconCache: { [key: number]: string } = {};
    private fontLoaded: boolean = false;
    private maxRetries: number = 3;
    private retryDelay: number = 500; // milliseconds
    private selectedPosition: Vector3 | null = null;
    private towerSelectorPanel: Rectangle | null = null;
    private placementOutline: Mesh | null = null;
    private placementPlane: Mesh | null = null;
    private towerTypeText: TextBlock | null = null;
    private towerLevelText: TextBlock | null = null;
    private towerDamageText: TextBlock | null = null;
    private towerRangeText: TextBlock | null = null;
    private towerRateText: TextBlock | null = null;
    private playerHealth: number = 100;
    private playerMoney: number = 200;
    private damageNumberManager: DamageNumberManager | null = null;
    private damageEventHandler: ((e: Event) => void) | null = null;
    private towerTooltip: Rectangle | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log("Entering gameplay state");
        this.game.cleanupScene();

        this.scene = this.game.getScene();
        if (!this.scene) {
            console.error("Scene is null in GameplayState.enter()");
            return;
        }

        // Reset camera to gameplay view (fixed isometric, auto-fit to screen)
        const camera = this.scene.activeCamera as ArcRotateCamera;
        if (camera) {
            camera.target = new Vector3(20, 0, 20);
            camera.alpha = -Math.PI / 4;
            camera.metadata = { ...camera.metadata, orthoZoom: null };
            this.game.updateOrthoBounds();
        }

        // Reset all state variables to ensure a clean start
        this.ui = null;
        this.map = null;
        this.towerManager = null;
        this.enemyManager = null;
        this.waveManager = null;
        this.playerStats = null;
        this.isPaused = false;
        this.selectedTowerType = null;
        this.towerPreview = null;
        this.squareOutline = null;
        this.confirmationButtons = { container: null, position: null };
        this.placementState = 'selecting';
        this.selectedTower = null;
        this.sellButton = null;
        this.upgradeButton = null;
        this.towerInfoPanel = null;
        this.selectedPosition = null;
        this.towerSelectorPanel = null;
        this.placementOutline = null;
        this.placementPlane = null;
        this.towerTypeText = null;
        this.towerLevelText = null;
        this.towerDamageText = null;
        this.towerRangeText = null;
        this.towerRateText = null;

        // Setup the map
        this.map = new Map(this.game);

        // Initialize the map
        this.map.initialize();

        // Create enemy manager
        this.enemyManager = new EnemyManager(this.game, this.map);

        // Create player stats (initial values: health, money)
        this.playerStats = new PlayerStats(100, 200);

        // Set player stats in enemy manager for rewards
        this.enemyManager.setPlayerStats(this.playerStats);

        // Create tower manager
        this.towerManager = new TowerManager(this.game, this.map);

        // Connect managers for targeting
        this.towerManager.setEnemyManager(this.enemyManager);

        // Connect managers for tower destruction (new)
        this.enemyManager.setTowerManager(this.towerManager);

        // Create wave manager
        this.waveManager = new WaveManager(this.enemyManager, this.playerStats);

        // Create UI
        this.createUI();

        // Setup input handling
        this.setupInputHandling();

        // Initialize damage number manager
        this.damageNumberManager = new DamageNumberManager(this.game);

        // Listen for tower damage events
        this.damageEventHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (this.damageNumberManager) {
                this.damageNumberManager.showDamage(detail.position, detail.damage, detail.elementType);
            }
            if (this.playerStats) {
                this.playerStats.addDamageDealt(detail.damage);
            }
        };
        document.addEventListener('towerDamage', this.damageEventHandler);

        // Reset time scale
        this.game.setTimeScale(1);

        // Store player stats reference in scene metadata for access by game over state
        this.game.getScene().metadata = {
            playerStats: this.playerStats
        };

        console.log('Gameplay state initialized with fresh state');
    }

    public exit(): void {
        console.log('Exiting gameplay state');

        // Dispose UI
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }

        // Dispose game components
        this.map?.dispose();
        this.towerManager?.dispose();
        this.enemyManager?.dispose();
        this.waveManager?.dispose();

        // Dispose preview meshes
        if (this.towerPreview) {
            this.towerPreview.dispose();
            this.towerPreview = null;
        }
        if (this.squareOutline) {
            this.squareOutline.dispose();
            this.squareOutline = null;
        }

        // Clean up damage number manager
        if (this.damageNumberManager) {
            this.damageNumberManager.dispose();
            this.damageNumberManager = null;
        }

        // Remove damage event listener
        if (this.damageEventHandler) {
            document.removeEventListener('towerDamage', this.damageEventHandler);
            this.damageEventHandler = null;
        }

        // Reset time scale
        this.game.setTimeScale(1);

        // Clear references
        this.map = null;
        this.towerManager = null;
        this.enemyManager = null;
        this.waveManager = null;
        this.playerStats = null;
        this.confirmationButtons.container = null;
        this.confirmationButtons.position = null;
    }

    public update(deltaTime: number): void {
        if (this.isPaused) return;

        // Apply time scale
        const scaledDelta = deltaTime * this.game.getTimeScale();

        // Update game components
        this.towerManager?.update(scaledDelta);
        this.enemyManager?.update(scaledDelta);
        this.waveManager?.update(scaledDelta);

        // Update damage numbers (use real deltaTime for smooth animation)
        this.damageNumberManager?.update(deltaTime);

        // Check for game over condition
        if (this.playerStats && this.playerStats.getHealth() <= 0) {
            this.game.getStateManager().changeState('gameOver');
        }

        // Check for win condition
        if (this.waveManager?.isAllWavesCompleted() && this.enemyManager?.getEnemyCount() === 0) {
            // Player won
            this.playerStats?.setWon(true);
            this.game.getStateManager().changeState('gameOver');
        }

        // Update UI
        this.updateUI();
    }

    // ========================================================================
    // UI CREATION
    // ========================================================================

    private createUI(): void {
        // Create the UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI("gameplayUI", true, this.scene!);

        // Detect if we're on a mobile device
        const isMobile = this.isMobileDevice();

        // Apply device-specific UI scaling
        if (isMobile) {
            this.ui.idealWidth = 1024;
            this.ui.useSmallestIdeal = true;
            this.ui.renderScale = 1.5;
        }

        // --- Stats panel (top-left): Dark rounded panel ---
        const statsPanel = new Rectangle('statsContainer');
        statsPanel.width = '200px';
        statsPanel.height = '180px';
        statsPanel.background = 'rgba(28, 32, 40, 0.88)';
        statsPanel.cornerRadius = 12;
        statsPanel.thickness = 1;
        statsPanel.color = '#3A3F4B';
        statsPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        statsPanel.left = '10px';
        statsPanel.top = '10px';
        this.ui.addControl(statsPanel);

        // Health row: red dot + number
        const healthContainer = new Rectangle('healthContainer');
        healthContainer.width = '180px';
        healthContainer.height = '34px';
        healthContainer.background = 'transparent';
        healthContainer.thickness = 0;
        healthContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        healthContainer.top = '10px';
        healthContainer.left = '10px';
        statsPanel.addControl(healthContainer);

        const healthDot = new Rectangle('healthDot');
        healthDot.width = '12px';
        healthDot.height = '12px';
        healthDot.cornerRadius = 6;
        healthDot.background = '#E53935';
        healthDot.thickness = 0;
        healthDot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthDot.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        healthDot.left = '0px';
        healthContainer.addControl(healthDot);

        const healthText = new TextBlock('healthText');
        healthText.text = '100';
        healthText.color = '#FFFFFF';
        healthText.fontSize = 20;
        healthText.fontFamily = 'Arial';
        healthText.fontWeight = 'bold';
        healthText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthText.left = '20px';
        healthContainer.addControl(healthText);

        // Gold row: gold dot + number
        const moneyContainer = new Rectangle('moneyContainer');
        moneyContainer.width = '180px';
        moneyContainer.height = '34px';
        moneyContainer.background = 'transparent';
        moneyContainer.thickness = 0;
        moneyContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        moneyContainer.top = '44px';
        moneyContainer.left = '10px';
        statsPanel.addControl(moneyContainer);

        const moneyDot = new Rectangle('moneyDot');
        moneyDot.width = '12px';
        moneyDot.height = '12px';
        moneyDot.cornerRadius = 6;
        moneyDot.background = '#F5A623';
        moneyDot.thickness = 0;
        moneyDot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyDot.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        moneyDot.left = '0px';
        moneyContainer.addControl(moneyDot);

        const moneyText = new TextBlock('moneyText');
        moneyText.text = '200';
        moneyText.color = '#FFFFFF';
        moneyText.fontSize = 20;
        moneyText.fontFamily = 'Arial';
        moneyText.fontWeight = 'bold';
        moneyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyText.left = '20px';
        moneyContainer.addControl(moneyText);

        // Wave row: blue dot + number
        const waveContainer = new Rectangle('waveContainer');
        waveContainer.width = '180px';
        waveContainer.height = '34px';
        waveContainer.background = 'transparent';
        waveContainer.thickness = 0;
        waveContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveContainer.top = '78px';
        waveContainer.left = '10px';
        statsPanel.addControl(waveContainer);

        const waveDot = new Rectangle('waveDot');
        waveDot.width = '12px';
        waveDot.height = '12px';
        waveDot.cornerRadius = 6;
        waveDot.background = '#42A5F5';
        waveDot.thickness = 0;
        waveDot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveDot.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        waveDot.left = '0px';
        waveContainer.addControl(waveDot);

        const waveText = new TextBlock('waveText');
        waveText.text = '1';
        waveText.color = '#FFFFFF';
        waveText.fontSize = 20;
        waveText.fontFamily = 'Arial';
        waveText.fontWeight = 'bold';
        waveText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveText.left = '20px';
        waveContainer.addControl(waveText);

        // Kill row: text label + number
        const killContainer = new Rectangle('killContainer');
        killContainer.width = '180px';
        killContainer.height = '34px';
        killContainer.background = 'transparent';
        killContainer.thickness = 0;
        killContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        killContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        killContainer.top = '112px';
        killContainer.left = '10px';
        statsPanel.addControl(killContainer);

        const killLabel = new TextBlock('killLabel');
        killLabel.text = 'Kills';
        killLabel.color = '#B0B8C8';
        killLabel.fontSize = 14;
        killLabel.fontFamily = 'Arial';
        killLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        killLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        killLabel.left = '0px';
        killContainer.addControl(killLabel);

        const killText = new TextBlock('killText');
        killText.text = '0';
        killText.color = '#FFFFFF';
        killText.fontSize = 20;
        killText.fontFamily = 'Arial';
        killText.fontWeight = 'bold';
        killText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        killText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        killText.left = '45px';
        killContainer.addControl(killText);

        // --- Wave info section below stats panel ---
        const waveInfoContainer = new Rectangle('waveInfoContainer');
        waveInfoContainer.width = '200px';
        waveInfoContainer.height = '60px';
        waveInfoContainer.background = 'rgba(28, 32, 40, 0.88)';
        waveInfoContainer.cornerRadius = 12;
        waveInfoContainer.thickness = 1;
        waveInfoContainer.color = '#3A3F4B';
        waveInfoContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveInfoContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveInfoContainer.left = '10px';
        waveInfoContainer.top = '200px';
        this.ui.addControl(waveInfoContainer);

        const countdownText = new TextBlock('countdownText');
        countdownText.text = '';
        countdownText.color = '#F5A623';
        countdownText.fontSize = 16;
        countdownText.fontFamily = 'Arial';
        countdownText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        countdownText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        countdownText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        countdownText.left = '12px';
        countdownText.top = '8px';
        waveInfoContainer.addControl(countdownText);

        const enemiesText = new TextBlock('enemiesText');
        enemiesText.text = '';
        enemiesText.color = '#B0B8C8';
        enemiesText.fontSize = 16;
        enemiesText.fontFamily = 'Arial';
        enemiesText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        enemiesText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        enemiesText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        enemiesText.left = '12px';
        enemiesText.top = '32px';
        waveInfoContainer.addControl(enemiesText);

        // --- Controls panel (top-right): dark panel with text buttons ---
        const controlsPanel = new Rectangle('controlsPanel');
        controlsPanel.width = '160px';
        controlsPanel.height = '50px';
        controlsPanel.background = 'rgba(28, 32, 40, 0.88)';
        controlsPanel.cornerRadius = 12;
        controlsPanel.thickness = 1;
        controlsPanel.color = '#3A3F4B';
        controlsPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        controlsPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        controlsPanel.top = '10px';
        controlsPanel.left = '-10px';
        this.ui.addControl(controlsPanel);

        // Pause button - text "II" instead of emoji
        const pauseButton = Button.CreateSimpleButton('pauseButton', 'II');
        pauseButton.width = '40px';
        pauseButton.height = '36px';
        pauseButton.color = '#FFFFFF';
        pauseButton.background = '#2196F3';
        pauseButton.cornerRadius = 18;
        pauseButton.thickness = 0;
        pauseButton.fontFamily = 'Arial';
        pauseButton.fontSize = 16;
        pauseButton.fontWeight = 'bold';
        pauseButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        pauseButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        pauseButton.left = '8px';
        pauseButton.zIndex = 100;

        pauseButton.onPointerEnterObservable.add(() => {
            pauseButton.background = '#42A5F5';
        });
        pauseButton.onPointerOutObservable.add(() => {
            const isPaused = this.game.getIsPaused();
            pauseButton.background = isPaused ? '#4CAF50' : '#2196F3';
        });
        pauseButton.onPointerClickObservable.add(() => {
            this.game.togglePause();
        });
        controlsPanel.addControl(pauseButton);

        // Register button to update its state when the game pauses/resumes
        this.registerPauseButtonUpdate(pauseButton);

        // Next wave button - text ">" instead of emoji
        const waveButton = Button.CreateSimpleButton('waveButton', '>');
        waveButton.width = '40px';
        waveButton.height = '36px';
        waveButton.color = '#FFFFFF';
        waveButton.background = '#E53935';
        waveButton.cornerRadius = 18;
        waveButton.thickness = 0;
        waveButton.fontFamily = 'Arial';
        waveButton.fontSize = 18;
        waveButton.fontWeight = 'bold';
        waveButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        waveButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        waveButton.zIndex = 100;

        waveButton.onPointerEnterObservable.add(() => {
            waveButton.background = '#EF5350';
        });
        waveButton.onPointerOutObservable.add(() => {
            waveButton.background = '#E53935';
        });

        waveButton.onPointerUpObservable.add(() => {
            if (this.waveManager) {
                if (this.waveManager.isWaveInProgress()) {
                    const currentWave = this.waveManager.getCurrentWave();
                    const enemies = [];

                    enemies.push({ type: 'basic', count: 5 + Math.floor(currentWave / 2), delay: 1.0 });

                    if (currentWave > 2) {
                        enemies.push({ type: 'fast', count: 3 + Math.floor((currentWave - 2) / 2), delay: 0.8 });
                    }

                    if (currentWave > 4) {
                        enemies.push({ type: 'tank', count: 1 + Math.floor((currentWave - 4) / 3), delay: 2.0 });
                    }

                    if (currentWave % 10 === 0 && currentWave > 0) {
                        enemies.push({ type: 'boss', count: 1, delay: 0 });
                    }

                    const reward = 25 + currentWave * 10;

                    this.waveManager.incrementWaveCounter();

                    this.waveManager.createParallelWave(enemies, reward);

                    console.log(`Created parallel wave with ${enemies.length} enemy types as wave ${this.waveManager.getCurrentWave()}`);
                } else {
                    this.waveManager.startNextWave();
                }
            }
        });
        controlsPanel.addControl(waveButton);

        // Register wave button to update its state
        this.registerWaveButtonUpdate(waveButton);

        // === Speed Control Buttons ===
        const speedPanel = new Rectangle('speedPanel');
        speedPanel.width = '140px';
        speedPanel.height = '40px';
        speedPanel.background = 'rgba(28, 32, 40, 0.88)';
        speedPanel.cornerRadius = 12;
        speedPanel.thickness = 1;
        speedPanel.color = '#3A3F4B';
        speedPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        speedPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        speedPanel.top = '70px';
        speedPanel.left = '-10px';
        this.ui.addControl(speedPanel);

        const speeds = [1, 2, 3];
        speeds.forEach((speed, index) => {
            const speedBtn = Button.CreateSimpleButton(`speed${speed}Btn`, `${speed}x`);
            speedBtn.width = '38px';
            speedBtn.height = '30px';
            speedBtn.color = '#FFFFFF';
            speedBtn.background = speed === 1 ? '#4CAF50' : '#3A3F4B';
            speedBtn.cornerRadius = 15;
            speedBtn.thickness = 0;
            speedBtn.fontSize = 14;
            speedBtn.fontFamily = 'Arial';
            speedBtn.fontWeight = 'bold';
            speedBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            speedBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            speedBtn.left = `${8 + index * 44}px`;
            speedBtn.zIndex = 100;

            speedBtn.onPointerUpObservable.add(() => {
                this.game.setTimeScale(speed);
                // Update all speed button colors
                speeds.forEach(s => {
                    const btn = this.ui?.getControlByName(`speed${s}Btn`) as Button;
                    if (btn) {
                        btn.background = s === speed ? '#4CAF50' : '#3A3F4B';
                    }
                });
            });

            speedPanel.addControl(speedBtn);
        });
    }

    private createResponsiveTowerButton(id: string, name: string, cost: string, color: string, width: string, left: string, parent: Rectangle, hidden: boolean = false): void {
        const button = new Rectangle(id);
        button.width = width;
        button.height = '40px';
        button.background = color;
        button.cornerRadius = 4;
        button.thickness = 2;
        button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        button.left = left;
        button.isVisible = !hidden;
        button.isPointerBlocker = true;
        button.shadowColor = "rgba(0, 0, 0, 0.4)";
        button.shadowBlur = 5;
        button.shadowOffsetY = 2;

        // Create a container for the text to ensure proper alignment
        const textContainer = new Rectangle(`${id}_textContainer`);
        textContainer.width = '100%';
        textContainer.height = '100%';
        textContainer.thickness = 0;
        textContainer.background = 'transparent';
        button.addControl(textContainer);

        // Name text at the top
        const nameText = new TextBlock(`${id}_name`);
        nameText.text = name;
        nameText.color = 'white';
        nameText.fontSize = 13;
        nameText.fontFamily = 'Arial';
        nameText.fontWeight = 'bold';
        nameText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        nameText.top = '4px';
        textContainer.addControl(nameText);

        // Cost text at the bottom
        const costText = new TextBlock(`${id}_cost`);
        costText.text = cost;
        costText.color = 'white';
        costText.fontSize = 13;
        costText.fontFamily = 'Arial';
        costText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        costText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        costText.top = '-4px';
        textContainer.addControl(costText);

        button.onPointerEnterObservable.add(() => {
            button.alpha = 0.8;
            button.thickness = 3;
            button.shadowOffsetY = 4;
        });

        button.onPointerOutObservable.add(() => {
            button.alpha = 1;
            button.thickness = 2;
            button.shadowOffsetY = 2;
        });

        button.onPointerDownObservable.add(() => {
            button.alpha = 0.6;
        });

        button.onPointerUpObservable.add(() => {
            button.alpha = 0.8;
            this.selectTowerType(id);
        });

        parent.addControl(button);
    }

    // ========================================================================
    // UI UPDATE
    // ========================================================================

    private updateUI(): void {
        if (!this.ui || !this.playerStats || !this.waveManager) return;

        // Get references to UI elements
        const healthText = this.ui.getControlByName('healthText') as TextBlock;
        const moneyText = this.ui.getControlByName('moneyText') as TextBlock;
        const waveText = this.ui.getControlByName('waveText') as TextBlock;
        const countdownText = this.ui.getControlByName('countdownText') as TextBlock;
        const enemiesText = this.ui.getControlByName('enemiesText') as TextBlock;
        const killText = this.ui.getControlByName('killText') as TextBlock;
        const healthDot = this.ui.getControlByName('healthDot') as Rectangle;

        if (!healthText || !moneyText || !waveText) return;

        // Update health display (number only, dot provides color context)
        const health = this.playerStats.getHealth();
        healthText.text = `${health}`;

        // Change health text and dot color based on health
        if (health <= 25) {
            healthText.color = '#E53935';
            if (healthDot) healthDot.background = '#E53935';
        } else if (health <= 50) {
            healthText.color = '#FF9800';
            if (healthDot) healthDot.background = '#FF9800';
        } else {
            healthText.color = '#FFFFFF';
            if (healthDot) healthDot.background = '#E53935';
        }

        // Update money display (number only)
        moneyText.text = `${this.playerStats.getMoney()}`;

        // Update wave display - simplified, no emoji
        const currentWave = this.waveManager.getCurrentWave();
        let waveDisplay = `${currentWave}`;

        // Show the effective difficulty
        const difficulty = this.waveManager.getDifficultyMultiplier().toFixed(1);
        waveDisplay += ` (x${difficulty})`;

        waveText.text = waveDisplay;

        // Update wave countdown timer
        if (countdownText) {
            const timeRemaining = this.waveManager.getAutoWaveTimeRemaining();
            if (timeRemaining > 0) {
                countdownText.text = `Next wave: ${timeRemaining.toFixed(1)}s`;
                countdownText.color = '#F5A623';
            } else if (this.waveManager.isWaveInProgress()) {
                countdownText.text = 'Wave in progress';
                countdownText.color = '#E53935';
            } else if (this.waveManager.getCurrentWave() <= 1) {
                countdownText.text = 'Press > to start';
                countdownText.color = '#66BB6A';
            } else {
                countdownText.text = '';
            }
        }

        // Update enemies remaining
        if (enemiesText) {
            if (this.waveManager.isWaveInProgress() && this.enemyManager) {
                const remaining = this.waveManager.getRemainingEnemiesInWave();
                enemiesText.text = `Enemies: ${remaining}`;
            } else {
                enemiesText.text = '';
            }
        }

        // Update kill counter (number only)
        if (killText) {
            killText.text = `${this.playerStats.getTotalKills()}`;
        }
    }

    /**
     * Get a color based on difficulty level
     */
    private getDifficultyColor(difficulty: number): string {
        const normalizedDifficulty = Math.min((difficulty - 1) / 9, 1);
        const red = 255;
        const green = Math.floor(255 * (1 - normalizedDifficulty * 0.8));
        const redHex = red.toString(16).padStart(2, '0');
        const greenHex = green.toString(16).padStart(2, '0');
        return `#${redHex}${greenHex}00`;
    }

    // ========================================================================
    // INPUT HANDLING (preserved exactly)
    // ========================================================================

    private setupInputHandling(): void {
        this.scene = this.game.getScene();
        if (!this.scene) return;

        this.scene.onPointerDown = (evt) => {
            if (evt.button !== 0 || !this.scene) return;

            // Check if we're clicking on UI elements
            const pickInfo = this.scene.pick(
                this.scene.pointerX,
                this.scene.pointerY
            );

            // Don't process clicks on GUI elements
            if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                return;
            }

            // If we have an open tower selector, check if the click is outside it
            // and close it if so
            if (this.towerSelectorPanel) {
                // First hide the tower selector to handle "clicking outside"
                this.hideTowerSelector();
                this.hidePlacementOutline();
                return; // Return here to prevent immediate selection on the next click
            }

            // We'll detect clicks outside of towers and handle UI cleanup below

            // First check if we're clicking on a tower
            const pickResult = this.scene.pick(
                this.scene.pointerX,
                this.scene.pointerY,
                (mesh) => {
                    // Only pick meshes that aren't UI or range indicators
                    return !mesh.name.includes('GUI') &&
                           !mesh.name.includes('rangeIndicator') &&
                           !mesh.name.includes('rangeRing');
                }
            );

            if (pickResult.hit && pickResult.pickedMesh) {
                const clickedTower = this.findTowerByMesh(pickResult.pickedMesh);

                if (clickedTower) {
                    // If we already have this tower selected, do nothing (allows clicking range indicator)
                    if (this.selectedTower === clickedTower) {
                        return;
                    }

                    // Otherwise, select the new tower
                    this.selectTower(clickedTower);
                    // Hide any existing placement UI when selecting a tower
                    this.hidePlacementOutline();
                    this.hideTowerSelector();
                    return;
                }
            }

            // If click wasn't on a tower, deselect any selected tower
            if (this.selectedTower) {
                this.deselectTower();
            }

            // If we're not clicking on a tower, check if we're clicking on the ground
            const groundPickResult = this.scene.pick(
                this.scene.pointerX,
                this.scene.pointerY,
                (mesh) => {
                    return mesh.name.startsWith('ground_');
                }
            );

            if (groundPickResult.hit && groundPickResult.pickedPoint) {
                const position = groundPickResult.pickedPoint;
                if (this.map) {
                    const gridPosition = this.map.worldToGrid(position);
                    if (this.map.canPlaceTower(gridPosition.x, gridPosition.y)) {
                        // Hide any existing placement UI before showing new ones
                        this.hidePlacementOutline();
                        this.hideTowerSelector();

                        // Store the selected position and show tower selector
                        this.selectedPosition = position;
                        this.showPlacementOutline(position);
                        this.showTowerSelector();
                    }
                }
            } else {
                this.deselectTower();
                this.hidePlacementOutline();
                this.hideTowerSelector();
            }
        };

        this.scene.onPointerMove = (evt) => {
            if (this.selectedTowerType && this.towerPreview && this.scene) {
                const pickInfo = this.scene.pick(
                    this.scene.pointerX,
                    this.scene.pointerY
                );

                if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                    return;
                }

                const pickResult = this.scene.pick(
                    this.scene.pointerX,
                    this.scene.pointerY,
                    (mesh) => {
                        return mesh.name.startsWith('ground_');
                    }
                );

                if (pickResult.hit && pickResult.pickedPoint) {
                    this.updateTowerPreview(pickResult.pickedPoint);
                }
            }
        };

        this.scene.onKeyboardObservable.add((kbInfo) => {
            switch (kbInfo.type) {
                case KeyboardEventTypes.KEYDOWN:
                    // Check if Escape is pressed to cancel tower placement
                    if (kbInfo.event.key === 'Escape') {
                        if (this.selectedTowerType) {
                            this.cancelTowerPlacement();
                        }
                        return;
                    }
                    break;
            }
        });
    }

    // ========================================================================
    // TOWER PLACEMENT LOGIC (preserved exactly)
    // ========================================================================

    private selectTowerType(type: string): void {
        this.selectedTowerType = type;
        console.log(`Selected tower type: ${type}`);

        if (!this.towerPreview) {
            this.createTowerPreview();
        } else {
            this.towerPreview.setEnabled(true);
        }

        if (!this.squareOutline) {
            this.createSquareOutline();
        } else {
            this.squareOutline.setEnabled(true);
        }

        if (this.scene && this.scene.activeCamera) {
            const ray = this.scene.createPickingRay(
                this.scene.pointerX,
                this.scene.pointerY,
                Matrix.Identity(),
                this.scene.activeCamera
            );

            const groundPlane = new Vector3(0, 1, 0);
            const planeOrigin = new Vector3(0, 0, 0);

            const distance = ray.direction.dot(groundPlane);

            if (Math.abs(distance) > 0.0001) {
                const t = (planeOrigin.subtract(ray.origin).dot(groundPlane)) / distance;

                if (t >= 0) {
                    const intersectionPoint = ray.origin.add(ray.direction.scale(t));
                    this.updateTowerPreview(intersectionPoint);
                }
            }
        }
    }

    private createTowerPreview(): void {
        this.towerPreview = MeshBuilder.CreateCylinder('towerPreview', {
            height: 2,
            diameter: 1.5
        }, this.game.getScene());

        const material = new StandardMaterial('towerPreviewMaterial', this.game.getScene());
        material.diffuseColor = new Color3(0, 1, 0);
        material.alpha = 0.5;
        this.towerPreview.material = material;

        this.towerPreview.setEnabled(false);
    }

    private createSquareOutline(): void {
        const size = 2.2;
        const y = 0.1;
        const lineThickness = 0.05;

        const corners = [
            new Vector3(-size/2, y, -size/2),
            new Vector3(size/2, y, -size/2),
            new Vector3(size/2, y, size/2),
            new Vector3(-size/2, y, size/2),
            new Vector3(-size/2, y, -size/2)
        ];

        this.squareOutline = MeshBuilder.CreateLines('squareOutline', {
            points: corners,
            updatable: true
        }, this.game.getScene());

        this.squareOutline.color = new Color3(1, 1, 0);

        this.squareOutline.enableEdgesRendering();
        this.squareOutline.edgesWidth = 10.0;

        this.squareOutline.setEnabled(false);
    }

    private updateTowerPreview(position: Vector3): void {
        if (!this.towerPreview || !this.map) return;

        this.towerPreview.setEnabled(true);

        const gridPosition = this.map.worldToGrid(position);

        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);

        this.towerPreview.position = new Vector3(worldPosition.x, 1, worldPosition.z);

        if (!this.squareOutline) {
            this.createSquareOutline();
        }

        if (this.squareOutline) {
            this.squareOutline.setEnabled(true);
            this.squareOutline.position = new Vector3(worldPosition.x, 0.1, worldPosition.z);

            const canPlace = this.map.canPlaceTower(gridPosition.x, gridPosition.y);

            const material = this.towerPreview.material as StandardMaterial;
            if (canPlace) {
                material.diffuseColor = new Color3(0, 1, 0);
                this.squareOutline.color = new Color3(0, 1, 0);
                material.alpha = 0.6;
            } else {
                material.diffuseColor = new Color3(1, 0, 0);
                this.squareOutline.color = new Color3(1, 0, 0);
                material.alpha = 0.6;
            }

            console.log(`Tower preview at grid position (${gridPosition.x}, ${gridPosition.y}), can place: ${canPlace}`);
        }
    }

    private showConfirmationButtons(position: Vector3): void {
        if (!this.ui || !this.map) return;

        if (this.towerPreview) {
            const material = this.towerPreview.material as StandardMaterial;
            material.alpha = 0.3;
        }

        this.confirmationButtons.position = position.clone();

        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);

        const container = new Rectangle('confirmationContainer');
        container.width = '300px';
        container.height = '120px';
        container.background = 'rgba(28, 32, 40, 0.95)';
        container.cornerRadius = 12;
        container.thickness = 1;
        container.color = '#3A3F4B';
        container.zIndex = 10;

        container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        container.top = "80px";

        const towerTypeText = new TextBlock('towerTypeText');
        towerTypeText.text = `${this.selectedTowerType?.replace('Tower', '')} Tower`;
        towerTypeText.color = '#FFFFFF';
        towerTypeText.fontSize = 16;
        towerTypeText.fontFamily = 'Arial';
        towerTypeText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        towerTypeText.top = "-40px";
        container.addControl(towerTypeText);

        const buttonPanel = new Rectangle("buttonPanel");
        buttonPanel.width = "280px";
        buttonPanel.height = "60px";
        buttonPanel.thickness = 0;
        buttonPanel.background = "transparent";
        buttonPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        buttonPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        buttonPanel.top = "-10px";
        container.addControl(buttonPanel);

        const confirmButton = Button.CreateSimpleButton('confirmButton', 'Confirm');
        confirmButton.width = '130px';
        confirmButton.height = '50px';
        confirmButton.color = '#FFFFFF';
        confirmButton.background = '#4CAF50';
        confirmButton.cornerRadius = 32;
        confirmButton.thickness = 0;
        confirmButton.fontFamily = 'Arial';
        confirmButton.fontSize = 18;
        confirmButton.fontWeight = 'bold';
        confirmButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        confirmButton.isPointerBlocker = true;
        confirmButton.paddingLeft = '15px';
        confirmButton.paddingRight = '15px';
        confirmButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        confirmButton.shadowBlur = 5;
        confirmButton.shadowOffsetY = 2;

        confirmButton.onPointerClickObservable.add(() => {
            console.log("Confirm button clicked");
            this.confirmTowerPlacement();
        });

        confirmButton.onPointerUpObservable.add(() => {
            console.log("Confirm button up");
            this.confirmTowerPlacement();
        });

        buttonPanel.addControl(confirmButton);

        const cancelButton = Button.CreateSimpleButton('cancelButton', 'Cancel');
        cancelButton.width = '130px';
        cancelButton.height = '50px';
        cancelButton.color = '#FFFFFF';
        cancelButton.background = '#E53935';
        cancelButton.cornerRadius = 32;
        cancelButton.thickness = 0;
        cancelButton.fontFamily = 'Arial';
        cancelButton.fontSize = 18;
        cancelButton.fontWeight = 'bold';
        cancelButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        cancelButton.isPointerBlocker = true;
        cancelButton.paddingLeft = '15px';
        cancelButton.paddingRight = '15px';
        cancelButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        cancelButton.shadowBlur = 5;
        cancelButton.shadowOffsetY = 2;

        cancelButton.onPointerClickObservable.add(() => {
            console.log("Cancel button clicked");
            this.cancelTowerPlacement();
        });

        cancelButton.onPointerUpObservable.add(() => {
            console.log("Cancel button up");
            this.cancelTowerPlacement();
        });

        buttonPanel.addControl(cancelButton);

        this.ui.addControl(container);
        this.confirmationButtons.container = container;

        container.isPointerBlocker = true;

        console.log(`Showing confirmation buttons for ${this.selectedTowerType} at grid position (${gridPosition.x}, ${gridPosition.y})`);
    }

    private hideConfirmationButtons(): void {
        if (this.confirmationButtons.container && this.ui) {
            this.ui.removeControl(this.confirmationButtons.container);
            this.confirmationButtons.container = null;
            this.confirmationButtons.position = null;
        }

        this.placementState = 'selecting';
    }

    private confirmTowerPlacement(): void {
        if (!this.map || !this.towerManager || !this.playerStats || !this.selectedTowerType || !this.confirmationButtons.position) {
            this.hideConfirmationButtons();
            return;
        }

        const position = this.confirmationButtons.position;
        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);

        const towerCost = this.getTowerCost(this.selectedTowerType);
        if (this.playerStats.getMoney() >= towerCost) {
            this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);

            this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);

            this.game.getAssetManager().playSound('towerShoot');

            console.log(`Tower placed at grid position (${gridPosition.x}, ${gridPosition.y})`);
        } else {
            console.log(`Not enough money to place tower. Need ${towerCost}, have ${this.playerStats.getMoney()}`);
        }

        this.hideConfirmationButtons();

        this.placementState = 'selecting';

        if (this.towerPreview) {
            this.towerPreview.setEnabled(true);
            const material = this.towerPreview.material as StandardMaterial;
            material.alpha = 0.5;
        }
        if (this.squareOutline) {
            this.squareOutline.setEnabled(true);
        }
    }

    private cancelTowerPlacement(): void {
        this.selectedTowerType = null;
        this.selectedPosition = null;

        if (this.towerPreview) {
            this.towerPreview.setEnabled(false);
        }
        if (this.squareOutline) {
            this.squareOutline.setEnabled(false);
        }

        this.hideTowerSelector();
        this.hidePlacementOutline();

        console.log('Tower placement cancelled');
    }

    private getTowerCost(type: string): number {
        switch (type) {
            case 'basicTower': return 50;
            case 'fastTower': return 100;
            case 'heavyTower': return 150;
            case 'sniperTower': return 200;
            case 'fireTower': return 125;
            case 'waterTower': return 125;
            case 'windTower': return 125;
            case 'earthTower': return 125;
            case 'steamTower': return 250;
            case 'lavaTower': return 250;
            case 'iceTower': return 250;
            case 'stormTower': return 250;
            case 'mudTower': return 250;
            case 'dustTower': return 250;
            default: return 0;
        }
    }

    private togglePause(): void {
        this.isPaused = !this.isPaused;
        console.log(`Game ${this.isPaused ? 'paused' : 'resumed'}`);
    }

    private createHorizontalTowerButton(id: string, name: string, cost: string, color: string, left: number, parent: Rectangle, hidden: boolean = false): void {
        const button = new Rectangle(id);
        button.width = '130px';
        button.height = '40px';
        button.background = color;
        button.cornerRadius = 4;
        button.thickness = 2;
        button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        button.left = `${left}px`;
        button.isVisible = !hidden;
        button.isPointerBlocker = true;
        button.shadowColor = "rgba(0, 0, 0, 0.4)";
        button.shadowBlur = 5;
        button.shadowOffsetY = 2;

        // Create a container for the text to ensure proper alignment
        const textContainer = new Rectangle(`${id}_textContainer`);
        textContainer.width = '100%';
        textContainer.height = '100%';
        textContainer.thickness = 0;
        textContainer.background = 'transparent';
        button.addControl(textContainer);

        // Name text at the top
        const nameText = new TextBlock(`${id}_name`);
        nameText.text = name;
        nameText.color = 'white';
        nameText.fontSize = 13;
        nameText.fontFamily = 'Arial';
        nameText.fontWeight = 'bold';
        nameText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        nameText.top = '4px';
        textContainer.addControl(nameText);

        // Cost text at the bottom
        const costText = new TextBlock(`${id}_cost`);
        costText.text = cost;
        costText.color = 'white';
        costText.fontSize = 13;
        costText.fontFamily = 'Arial';
        costText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        costText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        costText.top = '-4px';
        textContainer.addControl(costText);

        button.onPointerEnterObservable.add(() => {
            button.alpha = 0.8;
            button.thickness = 3;
            button.shadowOffsetY = 4;
        });

        button.onPointerOutObservable.add(() => {
            button.alpha = 1;
            button.thickness = 2;
            button.shadowOffsetY = 2;
        });

        button.onPointerDownObservable.add(() => {
            button.alpha = 0.6;
        });

        button.onPointerUpObservable.add(() => {
            button.alpha = 0.8;
            this.selectTowerType(id);
        });

        parent.addControl(button);
    }

    private switchTowerCategory(category: 'basic' | 'elemental'): void {
        if (!this.ui) return;

        const basicTowers = ['basicTower', 'fastTower', 'heavyTower', 'sniperTower'];
        const elementalTowers = ['fireTower', 'waterTower', 'windTower', 'earthTower'];

        // Immediately update tab appearances
        const basicTab = this.ui.getControlByName('basicTab') as Button;
        const elementalTab = this.ui.getControlByName('elementalTab') as Button;

        if (basicTab && elementalTab) {
            if (category === 'basic') {
                basicTab.background = '#4CAF50';
                elementalTab.background = '#333333';
            } else {
                basicTab.background = '#333333';
                elementalTab.background = '#555555';
            }
        }

        // Handle tower visibility with a slight animation
        for (const type of basicTowers) {
            const button = this.ui.getControlByName(type);
            if (button) {
                if (category === 'basic') {
                    button.isVisible = true;
                    button.alpha = 0;
                    setTimeout(() => {
                        button.alpha = 1;
                    }, 50);
                } else {
                    button.alpha = 0;
                    setTimeout(() => {
                        button.isVisible = false;
                    }, 200);
                }
            }
        }

        for (const type of elementalTowers) {
            const button = this.ui.getControlByName(type);
            if (button) {
                if (category === 'elemental') {
                    button.isVisible = true;
                    button.alpha = 0;
                    setTimeout(() => {
                        button.alpha = 1;
                    }, 50);
                } else {
                    button.alpha = 0;
                    setTimeout(() => {
                        button.isVisible = false;
                    }, 200);
                }
            }
        }
    }

    // ========================================================================
    // TOWER SELECTION & INFO (UI rewritten)
    // ========================================================================

    private findTowerByMesh(mesh: AbstractMesh): Tower | null {
        if (!this.towerManager) return null;

        const towers = this.towerManager.getTowers();

        for (const tower of towers) {
            const towerMesh = tower.getMesh();
            if (towerMesh && (towerMesh === mesh || this.isMeshChildOf(mesh, towerMesh))) {
                return tower;
            }
        }

        return null;
    }

    private isMeshChildOf(child: AbstractMesh, parent: Mesh): boolean {
        if (!parent) return false;

        let current = child.parent;
        while (current) {
            if (current === parent) {
                return true;
            }
            current = current.parent;
        }

        return false;
    }

    private selectTower(tower: Tower): void {
        this.deselectTower();

        this.selectedTower = tower;
        tower.select();

        this.showTowerActions();
    }

    private deselectTower(): void {
        if (this.selectedTower) {
            this.selectedTower.deselect();
            this.selectedTower = null;
        }

        this.hideTowerActions();
    }

    private showTowerActions(): void {
        if (!this.ui || !this.selectedTower) return;

        if (!this.towerInfoPanel) {
            // Clean dark panel for tower info
            this.towerInfoPanel = new Rectangle('towerInfoPanel');
            this.towerInfoPanel.width = "260px";
            this.towerInfoPanel.height = "260px";
            this.towerInfoPanel.cornerRadius = 12;
            this.towerInfoPanel.color = '#3A3F4B';
            this.towerInfoPanel.thickness = 1;
            this.towerInfoPanel.background = 'rgba(28, 32, 40, 0.95)';
            this.towerInfoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.towerInfoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.towerInfoPanel.top = "-160px";
            this.towerInfoPanel.left = "-10px";
            this.towerInfoPanel.shadowColor = "rgba(0, 0, 0, 0.5)";
            this.towerInfoPanel.shadowBlur = 10;
            this.towerInfoPanel.shadowOffsetY = 3;
            this.ui.addControl(this.towerInfoPanel);

            // Header text
            const titleBlock = new TextBlock('towerInfoTitle', 'Tower Info');
            titleBlock.color = '#F5A623';
            titleBlock.fontSize = 18;
            titleBlock.fontWeight = 'bold';
            titleBlock.fontFamily = 'Arial';
            titleBlock.height = "30px";
            titleBlock.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            titleBlock.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            titleBlock.top = "12px";
            this.towerInfoPanel.addControl(titleBlock);

            // Stats grid with text labels (no emoji)
            const statsGrid = new Grid('statsGrid');
            statsGrid.addColumnDefinition(0.45); // Labels
            statsGrid.addColumnDefinition(0.55); // Values
            statsGrid.addRowDefinition(0.2); // Type
            statsGrid.addRowDefinition(0.2); // Level
            statsGrid.addRowDefinition(0.2); // Damage
            statsGrid.addRowDefinition(0.2); // Range
            statsGrid.addRowDefinition(0.2); // Rate
            statsGrid.width = "90%";
            statsGrid.height = "120px";
            statsGrid.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            statsGrid.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            statsGrid.top = "48px";
            this.towerInfoPanel.addControl(statsGrid);

            // Labels with text only
            const createLabel = (text: string, row: number) => {
                const label = new TextBlock(`${text}Label`, text + ":");
                label.color = '#B0B8C8';
                label.fontSize = 14;
                label.fontFamily = 'Arial';
                label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
                label.paddingRight = "10px";
                statsGrid.addControl(label, row, 0);
                return label;
            };

            createLabel("Type", 0);
            createLabel("Level", 1);
            createLabel("Damage", 2);
            createLabel("Range", 3);
            createLabel("Fire Rate", 4);

            // Value fields
            const createValue = (id: string, row: number) => {
                const value = new TextBlock(id, "-");
                value.color = '#FFFFFF';
                value.fontSize = 14;
                value.fontFamily = 'Arial';
                value.fontWeight = 'bold';
                value.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                statsGrid.addControl(value, row, 1);
                return value;
            };

            this.towerTypeText = createValue("typeValue", 0);
            this.towerLevelText = createValue("levelValue", 1);
            this.towerDamageText = createValue("damageValue", 2);
            this.towerRangeText = createValue("rangeValue", 3);
            this.towerRateText = createValue("rateValue", 4);

            // Divider
            const divider = new Rectangle('divider');
            divider.width = "90%";
            divider.height = "1px";
            divider.background = '#3A3F4B';
            divider.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            divider.top = "178px";
            this.towerInfoPanel.addControl(divider);

            // Sell button - pill shape
            this.sellButton = new Rectangle('sellButton');
            this.sellButton.width = "110px";
            this.sellButton.height = "44px";
            this.sellButton.cornerRadius = 22;
            this.sellButton.color = 'transparent';
            this.sellButton.thickness = 0;
            this.sellButton.background = '#E53935';
            this.sellButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            this.sellButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.sellButton.top = "-12px";
            this.sellButton.left = "15px";
            this.sellButton.isPointerBlocker = true;
            this.sellButton.shadowColor = "rgba(0, 0, 0, 0.4)";
            this.sellButton.shadowBlur = 5;
            this.sellButton.shadowOffsetY = 2;

            const sellText = new TextBlock('sellText', 'SELL');
            sellText.color = '#FFFFFF';
            sellText.fontSize = 14;
            sellText.fontFamily = 'Arial';
            sellText.fontWeight = 'bold';
            sellText.top = "-8px";
            this.sellButton.addControl(sellText);

            const sellValueText = new TextBlock('sellValueText', '');
            sellValueText.color = '#B0B8C8';
            sellValueText.fontSize = 12;
            sellValueText.fontFamily = 'Arial';
            sellValueText.top = "10px";
            this.sellButton.addControl(sellValueText);

            this.sellButton.onPointerEnterObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = '#EF5350';
                }
            });

            this.sellButton.onPointerOutObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = '#E53935';
                }
            });

            this.sellButton.onPointerDownObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.alpha = 0.8;
                }
            });

            this.sellButton.onPointerClickObservable.add(() => {
                console.log("Sell button clicked");
                this.sellSelectedTower();
            });

            this.sellButton.onPointerUpObservable.add(() => {
                console.log("Sell button up");
                if (this.sellButton) {
                    this.sellButton.alpha = 1.0;
                }
                this.sellSelectedTower();
            });

            this.towerInfoPanel.addControl(this.sellButton);

            // Upgrade button - pill shape
            this.upgradeButton = new Rectangle('upgradeButton');
            this.upgradeButton.width = "110px";
            this.upgradeButton.height = "44px";
            this.upgradeButton.cornerRadius = 22;
            this.upgradeButton.color = 'transparent';
            this.upgradeButton.thickness = 0;
            this.upgradeButton.background = '#4CAF50';
            this.upgradeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.upgradeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.upgradeButton.top = "-12px";
            this.upgradeButton.left = "-15px";
            this.upgradeButton.isPointerBlocker = true;
            this.upgradeButton.shadowColor = "rgba(0, 0, 0, 0.4)";
            this.upgradeButton.shadowBlur = 5;
            this.upgradeButton.shadowOffsetY = 2;

            const upgradeText = new TextBlock('upgradeText', 'UPGRADE');
            upgradeText.color = '#FFFFFF';
            upgradeText.fontSize = 14;
            upgradeText.fontFamily = 'Arial';
            upgradeText.fontWeight = 'bold';
            upgradeText.top = "-8px";
            this.upgradeButton.addControl(upgradeText);

            const upgradeCostText = new TextBlock('upgradeCostText', '');
            upgradeCostText.color = '#B0B8C8';
            upgradeCostText.fontSize = 12;
            upgradeCostText.fontFamily = 'Arial';
            upgradeCostText.top = "10px";
            this.upgradeButton.addControl(upgradeCostText);

            this.upgradeButton.onPointerEnterObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower &&
                    this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.background = '#66BB6A';
                }
            });

            this.upgradeButton.onPointerOutObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower) {
                    if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                        this.upgradeButton.background = '#4CAF50';
                    } else {
                        this.upgradeButton.background = '#3A3F4B';
                    }
                }
            });

            this.upgradeButton.onPointerDownObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower &&
                    this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.alpha = 0.8;
                }
            });

            this.upgradeButton.onPointerClickObservable.add(() => {
                console.log("Upgrade button clicked");
                this.upgradeSelectedTower();
            });

            this.upgradeButton.onPointerUpObservable.add(() => {
                console.log("Upgrade button up");
                if (this.upgradeButton && this.playerStats && this.selectedTower) {
                    if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                        this.upgradeButton.alpha = 1.0;
                    }
                }
                this.upgradeSelectedTower();
            });

            this.towerInfoPanel.addControl(this.upgradeButton);
        } else {
            this.towerInfoPanel.isVisible = true;
        }

        // Update tower info panel content based on selected tower
        this.updateTowerInfo();

        // Display the panel
        if (this.towerInfoPanel) {
            this.towerInfoPanel.isVisible = true;
        }
    }

    /**
     * Update the tower information display
     */
    private updateTowerInfo(): void {
        if (!this.selectedTower || !this.towerTypeText || !this.towerLevelText ||
            !this.towerDamageText || !this.towerRangeText || !this.towerRateText) {
            return;
        }

        // Get tower class name (e.g., "BasicTower" -> "Basic")
        let towerType = this.selectedTower.constructor.name;
        towerType = towerType.replace("Tower", "");

        // Update tower info text fields
        this.towerTypeText.text = towerType;
        this.towerLevelText.text = `${this.selectedTower.getLevel()}`;
        this.towerDamageText.text = `${this.selectedTower.getDamage().toFixed(1)}`;
        this.towerRangeText.text = `${this.selectedTower.getRange().toFixed(1)}`;
        this.towerRateText.text = `${this.selectedTower.getFireRate().toFixed(1)}/sec`;

        // Update sell value
        const sellValueEl = this.sellButton?.getChildByName('sellValueText') as TextBlock;
        if (sellValueEl) {
            sellValueEl.text = `$${this.selectedTower.getSellValue()}`;
        }

        // Update upgrade cost
        const upgradeCostEl = this.upgradeButton?.getChildByName('upgradeCostText') as TextBlock;
        if (upgradeCostEl) {
            upgradeCostEl.text = `$${this.selectedTower.getUpgradeCost()}`;
        }

        // Check if player can afford upgrade
        if (this.playerStats && this.upgradeButton) {
            if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                this.upgradeButton.background = '#4CAF50';
                this.upgradeButton.alpha = 1.0;
            } else {
                this.upgradeButton.background = '#3A3F4B';
                this.upgradeButton.alpha = 0.6;
            }
        }
    }

    private hideTowerActions(): void {
        if (this.towerInfoPanel) {
            this.towerInfoPanel.isVisible = false;
        }
    }

    // ========================================================================
    // TOWER SELL / UPGRADE / EFFECTS (preserved exactly)
    // ========================================================================

    private sellSelectedTower(): void {
        if (!this.selectedTower || !this.towerManager || !this.playerStats) {
            console.log("Cannot sell tower: missing tower, manager, or player stats");
            return;
        }

        console.log("Selling tower...");

        try {
            const towerPosition = this.selectedTower.getPosition();

            const sellValue = this.selectedTower.getSellValue();
            console.log(`Tower sell value: $${sellValue}`);

            this.towerManager.sellTower(this.selectedTower);

            this.playerStats.addMoney(sellValue);
            console.log(`Added $${sellValue} to player. New balance: $${this.playerStats.getMoney()}`);

            if (this.map && towerPosition) {
                const gridPosition = this.map.worldToGrid(towerPosition);
                this.map.setTowerPlaced(gridPosition.x, gridPosition.y, false);
                console.log(`Freed up grid cell at (${gridPosition.x}, ${gridPosition.y})`);
            }

            this.createMoneyEffect(towerPosition);

            this.game.getAssetManager().playSound('towerSell');

            this.selectedTower = null;

            this.hideTowerActions();
        } catch (error) {
            console.error("Error selling tower:", error);
        }
    }

    private createMoneyEffect(position: Vector3): void {
        if (!this.scene) return;

        const particleSystem = new ParticleSystem('moneyParticles', 20, this.scene);

        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);

        particleSystem.emitter = new Vector3(position.x, position.y + 1, position.z);
        particleSystem.minEmitBox = new Vector3(-0.5, 0, -0.5);
        particleSystem.maxEmitBox = new Vector3(0.5, 0.5, 0.5);

        particleSystem.color1 = new Color4(1.0, 0.8, 0.0, 1.0);
        particleSystem.color2 = new Color4(0.8, 0.8, 0.0, 1.0);
        particleSystem.colorDead = new Color4(0.5, 0.5, 0.0, 0.0);

        particleSystem.minSize = 0.2;
        particleSystem.maxSize = 0.5;

        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;

        particleSystem.emitRate = 50;

        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        particleSystem.gravity = new Vector3(0, 5, 0);

        particleSystem.direction1 = new Vector3(-1, 2, -1);
        particleSystem.direction2 = new Vector3(1, 5, 1);

        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;

        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;

        particleSystem.start();

        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1500);
        }, 500);
    }

    private upgradeSelectedTower(): void {
        if (!this.selectedTower || !this.towerManager || !this.playerStats) {
            console.log("Cannot upgrade tower: missing tower, manager, or player stats");
            return;
        }

        const upgradeCost = this.selectedTower.getUpgradeCost();
        if (this.playerStats.getMoney() < upgradeCost) {
            console.log(`Not enough money to upgrade tower. Need $${upgradeCost}, have $${this.playerStats.getMoney()}`);

            this.game.getAssetManager().playSound('error');

            this.shakeButton(this.upgradeButton);

            return;
        }

        console.log(`Upgrading tower for $${upgradeCost}...`);

        try {
            const towerPosition = this.selectedTower.getPosition();
            const selectedTowerId = this.selectedTower.getId(); // Ensure we have the specific tower ID

            if (this.towerManager.upgradeTower(this.selectedTower)) {
                this.playerStats.spendMoney(upgradeCost);
                console.log(`Spent $${upgradeCost}. New balance: $${this.playerStats.getMoney()}`);

                this.createUpgradeEffect(towerPosition);

                this.game.getAssetManager().playSound('towerUpgrade');

                // Make sure we update the UI with the same tower
                const upgradedTower = this.towerManager.getTowerById(selectedTowerId);
                if (upgradedTower) {
                    this.selectedTower = upgradedTower;
                }

                this.showTowerActions();

                console.log(`Tower upgraded to level ${this.selectedTower.getLevel()}`);
            } else {
                console.log("Tower upgrade failed");
            }
        } catch (error) {
            console.error("Error upgrading tower:", error);
        }
    }

    private createUpgradeEffect(position: Vector3): void {
        if (!this.scene) return;

        const particleSystem = new ParticleSystem('upgradeParticles', 50, this.scene);

        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);

        particleSystem.emitter = new Vector3(position.x, position.y, position.z);
        particleSystem.minEmitBox = new Vector3(-1, 0, -1);
        particleSystem.maxEmitBox = new Vector3(1, 0, 1);

        particleSystem.color1 = new Color4(0.0, 1.0, 0.0, 1.0);
        particleSystem.color2 = new Color4(0.5, 1.0, 0.5, 1.0);
        particleSystem.colorDead = new Color4(0.0, 0.5, 0.0, 0.0);

        particleSystem.minSize = 0.2;
        particleSystem.maxSize = 0.5;

        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;

        particleSystem.emitRate = 100;

        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        particleSystem.gravity = new Vector3(0, 8, 0);

        particleSystem.direction1 = new Vector3(-2, 5, -2);
        particleSystem.direction2 = new Vector3(2, 10, 2);

        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;

        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;

        particleSystem.start();

        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1500);
        }, 500);

        this.createUpgradeFlash(position);
    }

    private createUpgradeFlash(position: Vector3): void {
        if (!this.scene) return;

        const flash = MeshBuilder.CreateSphere('upgradeFlash', {
            diameter: 3,
            segments: 16
        }, this.scene);

        flash.position = new Vector3(position.x, position.y + 1, position.z);

        const flashMaterial = new StandardMaterial('upgradeFlashMaterial', this.scene);
        flashMaterial.diffuseColor = new Color3(0.3, 1.0, 0.3);
        flashMaterial.emissiveColor = new Color3(0.3, 1.0, 0.3);
        flashMaterial.alpha = 0.7;
        flash.material = flashMaterial;

        let alpha = 0.7;
        let scale = 1.0;
        const flashAnimation = this.scene.onBeforeRenderObservable.add(() => {
            alpha -= 0.05;
            scale += 0.1;
            if (alpha <= 0) {
                flash.dispose();
                this.scene?.onBeforeRenderObservable.remove(flashAnimation);
            } else {
                (flash.material as StandardMaterial).alpha = alpha;
                flash.scaling.setAll(scale);
            }
        });
    }

    private shakeButton(button: Rectangle | null): void {
        if (!button) return;

        const originalLeft = button.left;
        const shakeAmount = 5;
        const shakeSpeed = 50;

        setTimeout(() => { button.left = `${parseInt(originalLeft as string) - shakeAmount}px`; }, shakeSpeed * 0);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) + shakeAmount}px`; }, shakeSpeed * 1);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) - shakeAmount}px`; }, shakeSpeed * 2);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) + shakeAmount}px`; }, shakeSpeed * 3);
        setTimeout(() => { button.left = originalLeft; }, shakeSpeed * 4);
    }

    private placeTowerAtPosition(position: Vector3): void {
        if (!this.map || !this.towerManager || !this.playerStats || !this.selectedTowerType) {
            return;
        }

        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);

        const towerCost = this.getTowerCost(this.selectedTowerType);
        if (this.playerStats.getMoney() >= towerCost) {
            this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);
            this.playerStats.addTowerBuilt();

            this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);

            this.game.getAssetManager().playSound('towerShoot');

            console.log(`Tower placed at grid position (${gridPosition.x}, ${gridPosition.y})`);
        } else {
            console.log(`Not enough money to place tower. Need ${towerCost}, have ${this.playerStats.getMoney()}`);
        }
    }

    // ========================================================================
    // PAUSE / WAVE BUTTON STATE (UI text updated, no emoji)
    // ========================================================================

    // Update the pause/resume button to reflect the current game state
    private registerPauseButtonUpdate(pauseButton: Button): void {
        // Initial state
        this.updatePauseButtonState(pauseButton);

        // Create a render observer to update the button state
        this.game.getScene().onBeforeRenderObservable.add(() => {
            this.updatePauseButtonState(pauseButton);
        });
    }

    private updatePauseButtonState(pauseButton: Button): void {
        if (!pauseButton || !pauseButton.textBlock) return;

        const isPaused = this.game.getIsPaused();

        if (isPaused) {
            pauseButton.textBlock.text = '>';
            pauseButton.background = '#4CAF50';
        } else {
            pauseButton.textBlock.text = 'II';
            pauseButton.background = '#2196F3';
        }
    }

    private registerWaveButtonUpdate(waveButton: Button): void {
        if (!waveButton || !waveButton.textBlock) return;

        // Create a render observer to update the button state
        this.game.getScene().onBeforeRenderObservable.add(() => {
            this.updateWaveButtonState(waveButton);
        });
    }

    private updateWaveButtonState(waveButton: Button): void {
        if (!waveButton || !waveButton.textBlock || !this.waveManager) return;

        if (this.waveManager.isWaveInProgress()) {
            waveButton.textBlock.text = '~';
            waveButton.background = '#F57C00';

            // Cancel any milestone pulse effect
            if (waveButton.metadata?.isPulsing) {
                waveButton.metadata.isPulsing = false;
                waveButton.fontSize = 18;
            }
        } else {
            // Check if next wave is a milestone wave (every 5th wave)
            const nextWave = this.waveManager.getCurrentWave() + 1;
            const isNextMilestone = nextWave % 5 === 0;

            if (isNextMilestone) {
                // Warning text and color for milestone wave
                waveButton.textBlock.text = '!';
                waveButton.background = '#FF8800';

                // Add pulse animation for milestone warning
                if (!waveButton.metadata?.isPulsing) {
                    waveButton.metadata = { isPulsing: true };

                    // Create pulse animation
                    const pulseAnimation = () => {
                        if (!waveButton || !waveButton.metadata?.isPulsing) return;

                        // Calculate scale based on time
                        const scaleValue = 1.0 + 0.1 * Math.sin(performance.now() / 200);
                        waveButton.fontSize = Math.floor(18 * scaleValue);

                        // Continue animation
                        requestAnimationFrame(pulseAnimation);
                    };

                    // Start pulse animation
                    pulseAnimation();
                }
            } else {
                // Normal next wave button
                waveButton.textBlock.text = '>';
                waveButton.background = '#E53935';

                // Cancel pulse if active
                if (waveButton.metadata?.isPulsing) {
                    waveButton.metadata.isPulsing = false;
                    waveButton.fontSize = 18;
                }
            }
        }
    }

    // ========================================================================
    // FONT / ICON HELPERS (preserved)
    // ========================================================================

    private async waitForFontLoad(): Promise<void> {
        if (this.fontLoaded) return;

        try {
            await document.fonts.load('16px FontAwesome');
            this.fontLoaded = true;
        } catch (e) {
            console.warn('Font loading API not supported, falling back to timeout');
            // Fallback: wait for a moment to let the font load
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    private getIcon(iconUnicode: number, fallbackText: string): string {
        // Check cache first
        if (this.iconCache[iconUnicode]) {
            return this.iconCache[iconUnicode];
        }

        // Try to get the icon with retries
        const tryGetIcon = async (retries: number = 0): Promise<string> => {
            try {
                // Wait for font to load on first try
                if (retries === 0) {
                    await this.waitForFontLoad();
                }

                const icon = String.fromCharCode(iconUnicode);

                // Create a test span with proper font settings
                const testSpan = document.createElement('span');
                testSpan.style.fontFamily = 'FontAwesome';
                testSpan.style.fontSize = '16px';
                testSpan.style.position = 'absolute';
                testSpan.style.visibility = 'hidden';
                testSpan.textContent = icon;

                // Add to document temporarily
                document.body.appendChild(testSpan);

                // More thorough check for icon rendering
                const isIconValid = testSpan.offsetWidth > 0 &&
                                  testSpan.offsetHeight > 0 &&
                                  window.getComputedStyle(testSpan).fontFamily.includes('FontAwesome');

                // Clean up
                document.body.removeChild(testSpan);

                if (!isIconValid && retries < this.maxRetries) {
                    // Wait and retry
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    return tryGetIcon(retries + 1);
                }

                // Cache and return the result
                const result = isIconValid ? icon : fallbackText;
                this.iconCache[iconUnicode] = result;
                return result;
            } catch (e) {
                console.warn('Failed to load icon:', e);
                return fallbackText;
            }
        };

        // Start the retry process and use fallback while waiting
        tryGetIcon().then(icon => {
            // Update all instances of this icon in the UI
            if (this.ui) {
                const controls = this.ui.getControlsByType("TextBlock");
                controls.forEach(control => {
                    const textBlock = control as TextBlock;
                    if (textBlock.text.includes(fallbackText)) {
                        textBlock.text = textBlock.text.replace(fallbackText, icon);
                    }
                });
            }
        });

        // Return fallback immediately while we wait for the icon to load
        return fallbackText;
    }

    // ========================================================================
    // PLACEMENT OUTLINE (preserved exactly)
    // ========================================================================

    private showPlacementOutline(position: Vector3): void {
        if (!this.map) return;

        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);

        // Create a more visible outline
        const size = 2.2;
        const y = 0.1;
        const lineThickness = 0.05;

        const corners = [
            new Vector3(-size/2, y, -size/2),
            new Vector3(size/2, y, -size/2),
            new Vector3(size/2, y, size/2),
            new Vector3(-size/2, y, size/2),
            new Vector3(-size/2, y, -size/2)
        ];

        // Create the outline mesh
        const outline = MeshBuilder.CreateLines('placementOutline', {
            points: corners.map(corner => corner.add(new Vector3(worldPosition.x, 0, worldPosition.z))),
            updatable: true
        }, this.game.getScene());

        outline.color = new Color3(0, 1, 0);
        outline.enableEdgesRendering();
        outline.edgesWidth = 10.0;

        // Create a semi-transparent plane to show the placement area
        const plane = MeshBuilder.CreateGround('placementPlane', {
            width: size,
            height: size,
            subdivisions: 1
        }, this.game.getScene());

        plane.position = new Vector3(worldPosition.x, y, worldPosition.z);
        plane.rotation = new Vector3(0, 0, 0);

        const material = new StandardMaterial('placementMaterial', this.game.getScene());
        material.diffuseColor = new Color3(0, 1, 0);
        material.alpha = 0.2;
        material.emissiveColor = new Color3(0, 0.7, 0);
        plane.material = material;

        // Store references to clean up later
        this.placementOutline = outline;
        this.placementPlane = plane;
    }

    private hidePlacementOutline(): void {
        if (this.placementOutline) {
            this.placementOutline.dispose();
            this.placementOutline = null;
        }
        if (this.placementPlane) {
            this.placementPlane.dispose();
            this.placementPlane = null;
        }
    }

    // ========================================================================
    // TOWER SELECTOR (circular UI with colored circle indicators)
    // ========================================================================

    private showTowerSelector(): void {
        if (!this.ui || !this.selectedPosition) return;

        // Store position in a local variable that's guaranteed not to be null
        const position = this.selectedPosition.clone();

        // Convert 3D world position to 2D screen position
        if (!this.scene || !this.scene.activeCamera) return;

        const worldPos = position;
        const screenPos = Vector3.Project(
            worldPos,
            Matrix.Identity(),
            this.scene.getTransformMatrix(),
            this.scene.activeCamera.viewport
        );

        // Detect if we're on a mobile device
        const isMobile = this.isMobileDevice();

        // Get UI dimensions
        const uiWidth = this.ui.getSize().width;
        const uiHeight = this.ui.getSize().height;

        // Calculate screen position
        const screenX = screenPos.x * uiWidth;
        const screenY = screenPos.y * uiHeight;

        // Adjust selector size based on device
        const selectorSize = isMobile ? 280 : 260;
        const selectorRadius = selectorSize / 2;

        // Create circular tower selector panel with dark style
        this.towerSelectorPanel = new Rectangle('towerSelectorPanel');
        this.towerSelectorPanel.width = selectorSize + 'px';
        this.towerSelectorPanel.height = selectorSize + 'px';
        this.towerSelectorPanel.background = 'rgba(28, 32, 40, 0.92)';
        this.towerSelectorPanel.cornerRadius = selectorRadius;
        this.towerSelectorPanel.thickness = 1;
        this.towerSelectorPanel.color = '#3A3F4B';

        // Use center positioning to avoid edge issues
        this.towerSelectorPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.towerSelectorPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

        // Calculate position offsets from center of screen
        const offsetX = screenX - (uiWidth / 2);
        const offsetY = screenY - (uiHeight / 2);

        // Apply position
        this.towerSelectorPanel.left = offsetX + 'px';
        this.towerSelectorPanel.top = offsetY + 'px';

        this.towerSelectorPanel.zIndex = 10;
        this.ui.addControl(this.towerSelectorPanel);

        // Define tower buttons with colored circle indicators
        const towers = [
            { id: 'basicTower', name: 'Basic', cost: '50', color: '#4CAF50' },
            { id: 'fastTower', name: 'Fast', cost: '100', color: '#2196F3' },
            { id: 'heavyTower', name: 'Heavy', cost: '150', color: '#FF9800' },
            { id: 'sniperTower', name: 'Sniper', cost: '200', color: '#9C27B0' },
            { id: 'fireTower', name: 'Fire', cost: '125', color: '#FF5722' },
            { id: 'waterTower', name: 'Water', cost: '125', color: '#03A9F4' },
            { id: 'windTower', name: 'Wind', cost: '125', color: '#8BC34A' },
            { id: 'earthTower', name: 'Earth', cost: '125', color: '#795548' }
        ];

        // Create a circular arrangement of tower buttons
        const radius = isMobile ? 105 : 85;
        const buttonsCount = towers.length;

        // Add label in center
        const centerLabel = new TextBlock("centerLabel", "Select\nTower");
        centerLabel.color = '#B0B8C8';
        centerLabel.fontSize = 14;
        centerLabel.fontFamily = 'Arial';
        centerLabel.textWrapping = true;
        centerLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        centerLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        this.towerSelectorPanel.addControl(centerLabel);

        // Add close button
        const closeButton = Button.CreateSimpleButton("closeButton", "x");
        closeButton.width = "24px";
        closeButton.height = "24px";
        closeButton.color = '#FFFFFF';
        closeButton.background = '#E53935';
        closeButton.cornerRadius = 12;
        closeButton.thickness = 0;
        closeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        closeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        closeButton.top = "5px";
        closeButton.left = "-5px";
        closeButton.onPointerClickObservable.add(() => {
            this.hideTowerSelector();
            this.hidePlacementOutline();
        });
        this.towerSelectorPanel.addControl(closeButton);

        towers.forEach((tower, index) => {
            // Calculate position in circle
            const angle = (index / buttonsCount) * 2 * Math.PI;
            const x = Math.sin(angle) * radius;
            const y = -Math.cos(angle) * radius;

            // Create button container with colored circle
            const button = new Button(`${tower.id}_button`);
            const buttonSize = isMobile ? 65 : 55;
            button.width = buttonSize + "px";
            button.height = buttonSize + "px";
            button.background = tower.color;
            button.color = '#FFFFFF';
            button.cornerRadius = buttonSize / 2;
            button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            button.left = x + "px";
            button.top = y + "px";

            // Clear default text
            if (button.textBlock) {
                button.textBlock.text = "";
            }

            // Add tower name text
            const nameText = new TextBlock(`${tower.id}_name`, tower.name);
            nameText.color = '#FFFFFF';
            nameText.fontSize = isMobile ? 14 : 11;
            nameText.fontFamily = 'Arial';
            nameText.fontWeight = 'bold';
            nameText.resizeToFit = false;
            nameText.textWrapping = true;
            nameText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            nameText.top = isMobile ? "-10px" : "-8px";
            button.addControl(nameText);

            // Add small cost indicator at bottom of button
            const costIndicator = new TextBlock(`${tower.id}_cost`, "$" + tower.cost);
            costIndicator.color = '#FFFFFF';
            costIndicator.fontSize = isMobile ? 12 : 9;
            costIndicator.fontFamily = 'Arial';
            costIndicator.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            costIndicator.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            costIndicator.top = isMobile ? "18px" : "16px";
            button.addControl(costIndicator);

            // Highlight effect on hover + tooltip
            button.onPointerEnterObservable.add(() => {
                button.background = this.lightenColor(tower.color, 20);
                button.scaleX = 1.1;
                button.scaleY = 1.1;

                nameText.fontSize = 13;

                // Show tooltip
                this.showTowerTooltip(tower.id, tower.name, tower.cost);
            });

            button.onPointerOutObservable.add(() => {
                button.background = tower.color;
                button.scaleX = 1.0;
                button.scaleY = 1.0;

                nameText.fontSize = 12;

                // Hide tooltip
                this.hideTowerTooltip();
            });

            // Make button clickable
            button.isPointerBlocker = true;

            // Handle tower selection - use the stored position
            button.onPointerUpObservable.add(() => {
                // Check if player has enough money
                if (this.playerStats && this.getTowerCost(tower.id) > this.playerStats.getMoney()) {
                    // Shake effect for insufficient funds
                    this.shakeElement(button);
                    return;
                }

                // Select the tower type and place it immediately
                this.selectedTowerType = tower.id;

                // Hide the tower selector and outline
                this.hideTowerSelector();

                // Place the tower directly at the position
                this.placeTowerAtPosition(position);

                // Hide the placement outline after placing
                this.hidePlacementOutline();
            });

            // Add the button to the panel if it still exists
            if (this.towerSelectorPanel) {
                this.towerSelectorPanel.addControl(button);
            }
        });
    }

    private showTowerTooltip(towerId: string, name: string, cost: string): void {
        if (!this.ui) return;
        this.hideTowerTooltip();

        const stats = this.getTowerStats(towerId);

        this.towerTooltip = new Rectangle('towerTooltip');
        this.towerTooltip.width = '180px';
        this.towerTooltip.height = '120px';
        this.towerTooltip.background = 'rgba(28, 32, 40, 0.95)';
        this.towerTooltip.cornerRadius = 12;
        this.towerTooltip.thickness = 1;
        this.towerTooltip.color = '#3A3F4B';
        this.towerTooltip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.towerTooltip.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.towerTooltip.top = '-20px';
        this.towerTooltip.zIndex = 20;
        this.towerTooltip.isPointerBlocker = false;
        this.ui.addControl(this.towerTooltip);

        const tooltipText = new TextBlock('tooltipText');
        tooltipText.text = `${name} Tower - $${cost}\n` +
            `Damage: ${stats.damage}\n` +
            `Range: ${stats.range}\n` +
            `Fire Rate: ${stats.fireRate}/s\n` +
            `${stats.description}`;
        tooltipText.color = '#B0B8C8';
        tooltipText.fontSize = 13;
        tooltipText.fontFamily = 'Arial';
        tooltipText.textWrapping = true;
        tooltipText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        tooltipText.paddingLeft = '10px';
        tooltipText.paddingRight = '10px';
        tooltipText.paddingTop = '8px';
        tooltipText.paddingBottom = '8px';
        this.towerTooltip.addControl(tooltipText);
    }

    private hideTowerTooltip(): void {
        if (this.towerTooltip && this.ui) {
            this.ui.removeControl(this.towerTooltip);
            this.towerTooltip = null;
        }
    }

    private getTowerStats(towerId: string): { damage: number, range: number, fireRate: number, description: string } {
        switch (towerId) {
            case 'basicTower': return { damage: 10, range: 5, fireRate: 1, description: 'Balanced tower' };
            case 'fastTower': return { damage: 5, range: 4, fireRate: 3, description: 'Rapid fire, low damage' };
            case 'heavyTower': return { damage: 30, range: 4, fireRate: 0.5, description: 'High damage, slow' };
            case 'sniperTower': return { damage: 50, range: 10, fireRate: 0.3, description: 'Long range, very slow' };
            case 'fireTower': return { damage: 12, range: 5, fireRate: 1, description: 'Burns enemies over time' };
            case 'waterTower': return { damage: 8, range: 5, fireRate: 1.2, description: 'Slows enemies' };
            case 'windTower': return { damage: 6, range: 6, fireRate: 1.5, description: 'Pushes enemies back' };
            case 'earthTower': return { damage: 15, range: 4, fireRate: 0.8, description: 'Stuns enemies' };
            default: return { damage: 0, range: 0, fireRate: 0, description: '' };
        }
    }

    /**
     * Create a shake animation for an element when player has insufficient funds
     */
    private shakeElement(element: Control): void {
        const originalLeft = element.left;
        const shakeAmount = 3;
        const duration = 50;
        let count = 0;

        const shakeInterval = setInterval(() => {
            element.left = (parseInt(originalLeft as string) + (Math.random() * shakeAmount * 2 - shakeAmount)) + "px";
            count++;
            if (count > 8) {
                clearInterval(shakeInterval);
                element.left = originalLeft;
            }
        }, duration);
    }

    /**
     * Lighten a color by the specified amount
     */
    private lightenColor(color: string, amount: number): string {
        // Convert hex to RGB
        let r = parseInt(color.substring(1, 3), 16);
        let g = parseInt(color.substring(3, 5), 16);
        let b = parseInt(color.substring(5, 7), 16);

        // Lighten
        r = Math.min(255, r + amount);
        g = Math.min(255, g + amount);
        b = Math.min(255, b + amount);

        // Convert back to hex
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // ========================================================================
    // CAMERA CONTROLS (preserved exactly)
    // ========================================================================

    /**
     * Hide the tower selector UI
     */
    private hideTowerSelector(): void {
        this.hideTowerTooltip();
        if (this.towerSelectorPanel && this.ui) {
            this.ui.removeControl(this.towerSelectorPanel);
            this.towerSelectorPanel = null;
        }
    }

    /**
     * Detect if the current device is a mobile device
     */
    private isMobileDevice(): boolean {
        return ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
               window.innerWidth < 1024;
    }
}
