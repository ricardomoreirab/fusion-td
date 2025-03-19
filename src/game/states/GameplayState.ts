import { Engine, Scene, Vector3, Color3, Color4, ArcRotateCamera, HemisphericLight, DirectionalLight, PointLight, ShadowGenerator, MeshBuilder, StandardMaterial, Texture, KeyboardEventTypes, Mesh, LinesMesh, Matrix, PointerEventTypes, PointerInfo, AbstractMesh, ParticleSystem } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, TextBlock, Image, Grid, StackPanel } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { TowerManager } from '../gameplay/TowerManager';
import { EnemyManager } from '../gameplay/EnemyManager';
import { WaveManager } from '../gameplay/WaveManager';
import { PlayerStats } from '../gameplay/PlayerStats';
import { Tower } from '../gameplay/towers/Tower';
import { WaveStatus } from '../gameplay/WaveStatus';

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

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
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
        
        // Update game components
        this.towerManager?.update(deltaTime);
        this.enemyManager?.update(deltaTime);
        this.waveManager?.update(deltaTime);
        
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

    private createUI(): void {
        // Create fullscreen UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('gameplayUI', true, this.game.getScene());
        
        // Create minimalist stats icons with emojis
        const statsContainer = new Rectangle('statsContainer');
        statsContainer.width = '200px';  // Reduced width for more compact display
        statsContainer.height = '180px';  // Reduced height
        statsContainer.background = 'transparent';
        statsContainer.thickness = 0;
        statsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        statsContainer.left = '10px';
        statsContainer.top = '10px';
        this.ui.addControl(statsContainer);

        // Health display with heart emoji
        const healthContainer = new Rectangle('healthContainer');
        healthContainer.width = '190px';  // Slightly less than parent
        healthContainer.height = '40px';
        healthContainer.background = 'transparent';
        healthContainer.thickness = 0;
        healthContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        healthContainer.top = '0px';
        healthContainer.left = '0px';
        statsContainer.addControl(healthContainer);

        const healthText = new TextBlock('healthText');
        healthText.text = `❤ 100`;  // Using heart emoji
        healthText.color = 'white';
        healthText.fontSize = 22;
        healthText.fontFamily = 'Arial';
        healthText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthText.left = '10px';
        healthText.outlineWidth = 1;
        healthText.outlineColor = 'black';
        healthText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthContainer.addControl(healthText);

        // Money display with coin emoji
        const moneyContainer = new Rectangle('moneyContainer');
        moneyContainer.width = '190px'; // Slightly less than parent
        moneyContainer.height = '40px';
        moneyContainer.background = 'transparent';
        moneyContainer.thickness = 0;
        moneyContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        moneyContainer.top = '40px'; // Reduced spacing between items
        moneyContainer.left = '0px';
        statsContainer.addControl(moneyContainer);

        const moneyText = new TextBlock('moneyText');
        moneyText.text = `💰 100`;  // Using money bag emoji
        moneyText.color = 'white';
        moneyText.fontSize = 22;
        moneyText.fontFamily = 'Arial';
        moneyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyText.left = '10px';
        moneyText.outlineWidth = 1;
        moneyText.outlineColor = 'black';
        moneyText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyContainer.addControl(moneyText);

        // Wave display with wave emoji
        const waveContainer = new Rectangle('waveContainer');
        waveContainer.width = '190px'; // Slightly less than parent
        waveContainer.height = '40px'; // Reduced height for single line
        waveContainer.background = 'transparent';
        waveContainer.thickness = 0;
        waveContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveContainer.top = '80px'; // Return to original spacing
        waveContainer.left = '0px';
        statsContainer.addControl(waveContainer);

        const waveText = new TextBlock('waveText');
        waveText.text = `🌊 1`;  // Using wave emoji
        waveText.color = 'white';
        waveText.fontSize = 22;
        waveText.fontFamily = 'Arial';
        waveText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveText.left = '10px';
        waveText.outlineWidth = 1;
        waveText.outlineColor = 'black';
        waveText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveContainer.addControl(waveText);
        
        // Add timer display
        const timerContainer = new Rectangle('timerContainer');
        timerContainer.width = '190px'; // Slightly less than parent
        timerContainer.height = '40px'; // Reduced height for single line
        timerContainer.background = 'transparent';
        timerContainer.thickness = 0;
        timerContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        timerContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        timerContainer.top = '120px'; // Return to original spacing
        timerContainer.left = '0px';
        statsContainer.addControl(timerContainer);
        
        const timerText = new TextBlock('timerText');
        timerText.text = `⏱️ 0:00`;  // Using stopwatch emoji
        timerText.color = 'white';
        timerText.fontSize = 22;
        timerText.fontFamily = 'Arial';
        timerText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        timerText.left = '10px';
        timerText.outlineWidth = 1;
        timerText.outlineColor = 'black';
        timerText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        timerContainer.addControl(timerText);

        // Add camera controls help text
        const cameraHelpContainer = new Rectangle('cameraHelpContainer');
        cameraHelpContainer.width = '300px';
        cameraHelpContainer.height = '40px';
        cameraHelpContainer.background = 'rgba(0,0,0,0.5)';
        cameraHelpContainer.cornerRadius = 5;
        cameraHelpContainer.thickness = 0;
        cameraHelpContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        cameraHelpContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        cameraHelpContainer.left = '-20px';
        cameraHelpContainer.top = '70px';
        cameraHelpContainer.alpha = 0.7;
        this.ui.addControl(cameraHelpContainer);

        const cameraHelpText = new TextBlock('cameraHelpText');
        cameraHelpText.text = `🖱 Left-click + drag to rotate camera\n⚙ Mouse wheel to zoom in/out`;  // Using mouse and gear emojis
        cameraHelpText.color = 'white';
        cameraHelpText.fontSize = 12;
        cameraHelpText.fontFamily = 'Arial';  // Removed FontAwesome
        cameraHelpText.outlineWidth = 1;
        cameraHelpText.outlineColor = 'black';
        cameraHelpContainer.addControl(cameraHelpText);

        // Add show/hide button for camera help
        const toggleHelpButton = Button.CreateSimpleButton('toggleHelpButton', 'ℹ');  // Using info emoji
        toggleHelpButton.width = '40px';
        toggleHelpButton.height = '40px';
        toggleHelpButton.color = 'white';
        toggleHelpButton.background = '#2196F3';
        toggleHelpButton.cornerRadius = 20;
        toggleHelpButton.thickness = 2;
        toggleHelpButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        toggleHelpButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        toggleHelpButton.top = '60px';
        toggleHelpButton.left = '-20px';
        toggleHelpButton.zIndex = 100;
        toggleHelpButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        toggleHelpButton.shadowBlur = 5;
        toggleHelpButton.shadowOffsetY = 2;
        
        // Add hover effect for help button
        toggleHelpButton.onPointerEnterObservable.add(() => {
            toggleHelpButton.background = '#0b7dda';
            toggleHelpButton.shadowOffsetY = 4;
        });
        
        toggleHelpButton.onPointerOutObservable.add(() => {
            toggleHelpButton.background = '#2196F3';
            toggleHelpButton.shadowOffsetY = 2;
        });
        
        this.ui.addControl(toggleHelpButton);

        // Initially hide the help text
        cameraHelpContainer.isVisible = false;

        // Toggle visibility on click
        toggleHelpButton.onPointerClickObservable.add(() => {
            cameraHelpContainer.isVisible = !cameraHelpContainer.isVisible;
        });

        // Add pause/resume toggle button to the top right
        const pauseButton = Button.CreateSimpleButton('pauseButton', '⏸');  // Using pause icon
        pauseButton.width = '40px';
        pauseButton.height = '40px';
        pauseButton.color = 'white';
        pauseButton.background = '#2196F3';
        pauseButton.cornerRadius = 20;
        pauseButton.thickness = 2;
        pauseButton.fontFamily = 'Arial';  // Removed FontAwesome
        pauseButton.fontSize = 20;
        pauseButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        pauseButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        pauseButton.top = '10px';
        pauseButton.left = '-20px';
        pauseButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        pauseButton.shadowBlur = 5;
        pauseButton.shadowOffsetY = 2;
        pauseButton.zIndex = 100;
        
        // Add hover effect
        pauseButton.onPointerEnterObservable.add(() => {
            pauseButton.background = '#0b7dda';
            pauseButton.shadowOffsetY = 4;
        });
        
        pauseButton.onPointerOutObservable.add(() => {
            pauseButton.background = '#2196F3';
            pauseButton.shadowOffsetY = 2;
        });
        
        // Add click handler
        pauseButton.onPointerClickObservable.add(() => {
            console.log('Pause/Resume button clicked');
            this.game.togglePause();
        });
        
        this.ui.addControl(pauseButton);

        // Register button to update its state when the game pauses/resumes
        this.registerPauseButtonUpdate(pauseButton);

        // Create wave button in top right
        const waveButton = Button.CreateSimpleButton('waveButton', '+');  // Using plus sign
        waveButton.width = '40px';
        waveButton.height = '40px';
        waveButton.color = 'white';
        waveButton.background = '#D32F2F';
        waveButton.cornerRadius = 20;
        waveButton.thickness = 2;
        waveButton.fontFamily = 'Arial';  // Removed FontAwesome
        waveButton.fontSize = 20;
        waveButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        waveButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveButton.top = '110px';
        waveButton.left = '-20px';
        waveButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        waveButton.shadowBlur = 5;
        waveButton.shadowOffsetY = 2;
        waveButton.zIndex = 100;

        // Add hover effect for wave button
        waveButton.onPointerEnterObservable.add(() => {
            waveButton.background = '#F44336';
            waveButton.shadowOffsetY = 4;
        });

        waveButton.onPointerOutObservable.add(() => {
            waveButton.background = '#D32F2F';
            waveButton.shadowOffsetY = 2;
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
        this.ui.addControl(waveButton);

        // Register wave button to update its state
        this.registerWaveButtonUpdate(waveButton);
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
        nameText.outlineWidth = 1;
        nameText.outlineColor = 'black';
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
        costText.outlineWidth = 1;
        costText.outlineColor = 'black';
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

    private updateUI(): void {
        if (!this.ui || !this.playerStats || !this.waveManager) return;

        const healthText = this.ui.getControlByName('healthText') as TextBlock;
        const moneyText = this.ui.getControlByName('moneyText') as TextBlock;
        const waveText = this.ui.getControlByName('waveText') as TextBlock;
        const timerText = this.ui.getControlByName('timerText') as TextBlock;

        if (!healthText || !moneyText || !waveText || !timerText) return;

        // Update health display with hearts
        const health = this.playerStats.getHealth();
        healthText.text = `❤ ${health}`;
        
        // Change color based on health
        if (health <= 25) {
            healthText.color = 'red';
        } else if (health <= 50) {
            healthText.color = 'orange';
        } else {
            healthText.color = 'white';
        }

        // Update money display with coins
        moneyText.text = `💰 ${this.playerStats.getMoney()}`;

        // Update wave display - simplified
        const waveManager = this.waveManager;
        const currentWave = waveManager.getCurrentWave();

        // Add milestone indicator if it's a milestone wave
        const isMilestone = waveManager.isMilestoneWave();
        const milestoneIndicator = isMilestone ? ' 🔥🔥' : '';
        
        // Add boss indicator if it's a boss wave
        const isBossWave = waveManager.isBossWave();
        const bossIndicator = isBossWave ? ' 👹' : '';
        
        // Get the difficulty multiplier and format it to one decimal place
        const diffMultiplier = waveManager.getDifficultyMultiplier().toFixed(1);
        
        // Add wave and difficulty in a compact format
        waveText.text = `🌊 ${currentWave}${milestoneIndicator}${bossIndicator} (×${diffMultiplier})`;

        // Update timer display - simplified
        const waveStatus = waveManager.getWaveStatus();
        if (waveStatus === WaveStatus.InProgress) {
            // Show only enemy count, no timing info
            const enemiesRemaining = waveManager.getRemainingEnemiesInWave();
            timerText.text = `⏱️ ${enemiesRemaining}`;
            timerText.color = 'white';
        } else if (waveStatus === WaveStatus.Countdown) {
            // Check if next wave is a milestone
            const isNextMilestone = waveManager.isNextWaveMilestone();
            const warningIcon = isNextMilestone ? '⚠️ ' : '⏱️ ';
            
            // Show simplified countdown (just the number of seconds)
            const nextWaveTimeRemaining = waveManager.getTimeToNextWave();
            timerText.text = `${warningIcon}${nextWaveTimeRemaining.toFixed(0)}s`;
            timerText.color = isNextMilestone ? '#ff8800' : 'white';
        } else {
            // Ready for next wave
            timerText.text = `⏱️ Ready!`;
            timerText.color = 'green';
        }
    }
    
    /**
     * Get a color based on difficulty level
     * @param difficulty The current difficulty
     * @returns A color string in hex format
     */
    private getDifficultyColor(difficulty: number): string {
        // Start at yellow (1.0) and go to red (10.0)
        const normalizedDifficulty = Math.min((difficulty - 1) / 9, 1);
        
        // Calculate RGB values
        const red = 255; // Always full red
        const green = Math.floor(255 * (1 - normalizedDifficulty * 0.8)); // Decrease green component
        
        // Convert to hex
        const redHex = red.toString(16).padStart(2, '0');
        const greenHex = green.toString(16).padStart(2, '0');
        
        return `#${redHex}${greenHex}00`;
    }

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
                    switch (kbInfo.event.key) {
                        case 'Escape':
                            if (this.selectedTowerType) {
                                this.cancelTowerPlacement();
                            }
                            break;
                    }
                    break;
            }
        });
    }

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
        container.background = '#333333';
        container.alpha = 0.9;
        container.thickness = 1;
        container.cornerRadius = 10;
        container.color = "white";
        container.zIndex = 10;
        
        container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        container.top = "80px";
        
        const towerTypeText = new TextBlock('towerTypeText');
        towerTypeText.text = `${this.selectedTowerType?.replace('Tower', '')} Tower`;
        towerTypeText.color = 'white';
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
        
        const confirmButton = Button.CreateSimpleButton('confirmButton', '✓ Confirm');
        confirmButton.width = '130px';
        confirmButton.height = '50px';
        confirmButton.color = 'white';
        confirmButton.background = '#4CAF50';
        confirmButton.cornerRadius = 25;
        confirmButton.thickness = 2;
        confirmButton.fontFamily = 'Arial';
        confirmButton.fontSize = 18;
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
        
        const cancelButton = Button.CreateSimpleButton('cancelButton', '✗ Cancel');
        cancelButton.width = '130px';
        cancelButton.height = '50px';
        cancelButton.color = 'white';
        cancelButton.background = '#F44336';
        cancelButton.cornerRadius = 25;
        cancelButton.thickness = 2;
        cancelButton.fontFamily = 'Arial';
        cancelButton.fontSize = 18;
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
        nameText.outlineWidth = 1;
        nameText.outlineColor = 'black';
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
        costText.outlineWidth = 1;
        costText.outlineColor = 'black';
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
            // Create medieval-styled tower info panel with larger size
            this.towerInfoPanel = new Rectangle('towerInfoPanel');
            this.towerInfoPanel.width = "260px";  // Wider to fit more info
            this.towerInfoPanel.height = "250px"; // Taller to fit more info
            this.towerInfoPanel.cornerRadius = 8;
            this.towerInfoPanel.color = "#5D4037"; // Brown border for medieval style
            this.towerInfoPanel.thickness = 3;
            this.towerInfoPanel.background = "#3E2723"; // Dark brown background
            this.towerInfoPanel.alpha = 0.95;
            this.towerInfoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.towerInfoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.towerInfoPanel.top = "-160px";
            this.towerInfoPanel.left = "-10px";
            this.towerInfoPanel.shadowColor = "rgba(0, 0, 0, 0.7)";
            this.towerInfoPanel.shadowBlur = 10;
            this.towerInfoPanel.shadowOffsetY = 3;
            this.ui.addControl(this.towerInfoPanel);
            
            // Create header with scroll-like appearance
            const headerBg = new Rectangle('headerBg');
            headerBg.width = "100%";
            headerBg.height = "40px";
            headerBg.background = "#8D6E63"; // Lighter brown
            headerBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            headerBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            headerBg.cornerRadius = 8;
            this.towerInfoPanel.addControl(headerBg);
            
            const titleBlock = new TextBlock('towerInfoTitle', 'Tower Information');
            titleBlock.color = "#FFEBEE"; // Off-white for parchment feel
            titleBlock.fontSize = 18;
            titleBlock.fontStyle = "bold";
            titleBlock.height = "40px";
            titleBlock.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            titleBlock.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            titleBlock.top = "10px";
            this.towerInfoPanel.addControl(titleBlock);
            
            // Create tower stats grid (name: value)
            const statsGrid = new Grid('statsGrid');
            statsGrid.addColumnDefinition(0.5); // Labels
            statsGrid.addColumnDefinition(0.5); // Values
            statsGrid.addRowDefinition(0.2); // Type
            statsGrid.addRowDefinition(0.2); // Level
            statsGrid.addRowDefinition(0.2); // Damage
            statsGrid.addRowDefinition(0.2); // Range
            statsGrid.addRowDefinition(0.2); // Rate
            statsGrid.width = "90%";
            statsGrid.height = "120px";
            statsGrid.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            statsGrid.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            statsGrid.top = "50px";
            this.towerInfoPanel.addControl(statsGrid);
            
            // Add labels
            const createLabel = (text: string, row: number) => {
                const label = new TextBlock(`${text}Label`, text + ":");
                label.color = "#D7CCC8"; // Light tan
                label.fontSize = 14;
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
            
            // Add value fields (will be updated with each tower selection)
            const createValue = (id: string, row: number) => {
                const value = new TextBlock(id, "-");
                value.color = "#FFECB3"; // Gold-ish color for values
                value.fontSize = 14;
                value.fontStyle = "bold";
                value.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                statsGrid.addControl(value, row, 1);
                return value;
            };
            
            this.towerTypeText = createValue("typeValue", 0);
            this.towerLevelText = createValue("levelValue", 1);
            this.towerDamageText = createValue("damageValue", 2);
            this.towerRangeText = createValue("rangeValue", 3);
            this.towerRateText = createValue("rateValue", 4);
            
            // Create divider
            const divider = new Rectangle('divider');
            divider.width = "90%";
            divider.height = "2px";
            divider.background = "#8D6E63"; // Light brown
            divider.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            divider.top = "175px";
            this.towerInfoPanel.addControl(divider);
            
            this.sellButton = new Rectangle('sellButton');
            this.sellButton.width = "110px";
            this.sellButton.height = "40px";
            this.sellButton.cornerRadius = 4;
            this.sellButton.color = "#D50000"; // Darker red border
            this.sellButton.thickness = 2;
            this.sellButton.background = "#B71C1C"; // Deep red background
            this.sellButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            this.sellButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.sellButton.top = "-15px";
            this.sellButton.left = "15px";
            this.sellButton.isPointerBlocker = true;
            this.sellButton.shadowColor = "rgba(0, 0, 0, 0.4)";
            this.sellButton.shadowBlur = 5;
            this.sellButton.shadowOffsetY = 2;
            
            // Add wooden texture pattern to button
            const sellPattern = new Rectangle('sellPattern');
            sellPattern.width = "100%";
            sellPattern.height = "100%";
            sellPattern.background = "#C62828"; // Slightly lighter red
            sellPattern.alpha = 0.4;
            sellPattern.zIndex = -1;
            this.sellButton.addControl(sellPattern);
            
            const sellText = new TextBlock('sellText', 'SELL');
            sellText.color = "#FFD700"; // Gold text for medieval feel
            sellText.fontSize = 16;
            sellText.fontStyle = "bold";
            sellText.top = "-8px";
            this.sellButton.addControl(sellText);
            
            const sellValueText = new TextBlock('sellValueText', '');
            sellValueText.color = "#FFFDE7"; // Off-white
            sellValueText.fontSize = 14;
            sellValueText.top = "12px";
            this.sellButton.addControl(sellValueText);
            
            this.sellButton.onPointerEnterObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#D32F2F"; // Brighter red
                    this.sellButton.thickness = 3;
                    this.sellButton.shadowOffsetY = 4; // Raise shadow on hover
                }
            });
            
            this.sellButton.onPointerOutObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#B71C1C";
                    this.sellButton.thickness = 2;
                    this.sellButton.shadowOffsetY = 2;
                }
            });
            
            this.sellButton.onPointerDownObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#991111";
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
                    this.sellButton.background = "#DD3333";
                    this.sellButton.alpha = 1.0;
                }
                this.sellSelectedTower();
            });
            
            this.towerInfoPanel.addControl(this.sellButton);
            
            this.upgradeButton = new Rectangle('upgradeButton');
            this.upgradeButton.width = "110px";
            this.upgradeButton.height = "40px";
            this.upgradeButton.cornerRadius = 4;
            this.upgradeButton.color = "#2E7D32"; // Darker green border
            this.upgradeButton.thickness = 2;
            this.upgradeButton.background = "#1B5E20"; // Deep green background
            this.upgradeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.upgradeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.upgradeButton.top = "-15px";
            this.upgradeButton.left = "-15px";
            this.upgradeButton.isPointerBlocker = true;
            this.upgradeButton.shadowColor = "rgba(0, 0, 0, 0.4)";
            this.upgradeButton.shadowBlur = 5;
            this.upgradeButton.shadowOffsetY = 2;
            
            // Add wooden texture pattern to button
            const upgradePattern = new Rectangle('upgradePattern');
            upgradePattern.width = "100%";
            upgradePattern.height = "100%";
            upgradePattern.background = "#2E7D32"; // Slightly lighter green
            upgradePattern.alpha = 0.4;
            upgradePattern.zIndex = -1;
            this.upgradeButton.addControl(upgradePattern);
            
            const upgradeText = new TextBlock('upgradeText', 'UPGRADE');
            upgradeText.color = "#FFD700"; // Gold text
            upgradeText.fontSize = 16;
            upgradeText.fontStyle = "bold";
            upgradeText.top = "-8px";
            this.upgradeButton.addControl(upgradeText);
            
            const upgradeCostText = new TextBlock('upgradeCostText', '');
            upgradeCostText.color = "#FFFDE7"; // Off-white
            upgradeCostText.fontSize = 14;
            upgradeCostText.top = "12px";
            this.upgradeButton.addControl(upgradeCostText);
            
            this.upgradeButton.onPointerEnterObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower && 
                    this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.background = "#33CC33";
                    this.upgradeButton.thickness = 3;
                }
            });
            
            this.upgradeButton.onPointerOutObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower) {
                    if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                        this.upgradeButton.background = "#22AA22";
                        this.upgradeButton.color = "#44FF44";
                    } else {
                        this.upgradeButton.background = "#555555";
                        this.upgradeButton.color = "#777777";
                    }
                }
            });
            
            this.upgradeButton.onPointerDownObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower && 
                    this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.background = "#119911";
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
                        this.upgradeButton.background = "#33CC33";
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
                // Can afford upgrade
                this.upgradeButton.background = "#1B5E20"; // Normal green
                this.upgradeButton.color = "#2E7D32";      // Normal border
                this.upgradeButton.alpha = 1.0;
            } else {
                // Cannot afford upgrade
                this.upgradeButton.background = "#424242"; // Gray out
                this.upgradeButton.color = "#616161";      // Gray border
                this.upgradeButton.alpha = 0.8;
            }
        }
    }
    
    private hideTowerActions(): void {
        if (this.towerInfoPanel) {
            this.towerInfoPanel.isVisible = false;
        }
    }
    
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
            
            if (this.towerManager.upgradeTower(this.selectedTower)) {
                this.playerStats.spendMoney(upgradeCost);
                console.log(`Spent $${upgradeCost}. New balance: $${this.playerStats.getMoney()}`);
                
                this.createUpgradeEffect(towerPosition);
                
                this.game.getAssetManager().playSound('towerUpgrade');
                
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
            
            this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);
            
            this.game.getAssetManager().playSound('towerShoot');
            
            console.log(`Tower placed at grid position (${gridPosition.x}, ${gridPosition.y})`);
        } else {
            console.log(`Not enough money to place tower. Need ${towerCost}, have ${this.playerStats.getMoney()}`);
        }
    }

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
            pauseButton.textBlock.text = '▶';  // Using play icon
            pauseButton.background = '#4CAF50';
        } else {
            pauseButton.textBlock.text = '⏸';  // Using pause icon
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
            waveButton.textBlock.text = '⟳';  // Using random icon
            waveButton.background = '#F57C00';
            
            // Cancel any milestone pulse effect
            if (waveButton.metadata?.isPulsing) {
                waveButton.metadata.isPulsing = false;
                waveButton.fontSize = 20; // Reset font size
            }
        } else if (this.waveManager.getAutoWaveTimeRemaining() > 0) {
            // Normal auto-wave countdown
            waveButton.textBlock.text = '⏲';  // Using clock icon
            
            // Check if next wave is a milestone wave
            if (this.waveManager.isNextWaveMilestone()) {
                // Warning color for milestone
                waveButton.background = '#FF8800';
                
                // Add pulse animation for milestone warning
                if (!waveButton.metadata?.isPulsing) {
                    waveButton.metadata = { isPulsing: true };
                    
                    // Create pulse animation
                    const pulseAnimation = () => {
                        if (!waveButton || !waveButton.metadata?.isPulsing) return;
                        
                        // Calculate scale based on time
                        const scaleValue = 1.0 + 0.1 * Math.sin(performance.now() / 200);
                        waveButton.fontSize = Math.floor(20 * scaleValue);
                        
                        // Continue animation
                        requestAnimationFrame(pulseAnimation);
                    };
                    
                    // Start pulse animation
                    pulseAnimation();
                }
            } else {
                // Normal auto-wave button
                waveButton.background = '#1976D2';
                
                // Cancel pulse if active
                if (waveButton.metadata?.isPulsing) {
                    waveButton.metadata.isPulsing = false;
                    waveButton.fontSize = 20; // Reset font size
                }
            }
        } else {
            // Ready to start next wave
            waveButton.textBlock.text = '+';  // Using plus icon
            
            // Check if next wave is a milestone wave
            if (this.waveManager.isNextWaveMilestone()) {
                // Warning color and animation for milestone
                waveButton.background = '#FF8800';
                
                // Add pulsing warning animation
                if (!waveButton.metadata?.isPulsing) {
                    waveButton.metadata = { isPulsing: true };
                    
                    const pulseAnimation = () => {
                        if (!waveButton || !waveButton.metadata?.isPulsing) return;
                        
                        const scaleValue = 1.0 + 0.15 * Math.sin(performance.now() / 150);
                        waveButton.fontSize = Math.floor(20 * scaleValue);
                        
                        requestAnimationFrame(pulseAnimation);
                    };
                    
                    pulseAnimation();
                }
                
                // Override the hover behavior for milestone waves
                waveButton.onPointerEnterObservable.clear();
                waveButton.onPointerOutObservable.clear();
                
                waveButton.onPointerEnterObservable.add(() => {
                    waveButton.background = '#FF9800';
                    waveButton.shadowOffsetY = 4;
                });
                
                waveButton.onPointerOutObservable.add(() => {
                    waveButton.background = '#FF8800';
                    waveButton.shadowOffsetY = 2;
                });
            } else {
                // Normal wave button
                waveButton.background = '#D32F2F';
                
                // Reset hover behavior
                waveButton.onPointerEnterObservable.clear();
                waveButton.onPointerOutObservable.clear();
                
                waveButton.onPointerEnterObservable.add(() => {
                    waveButton.background = '#F44336';
                    waveButton.shadowOffsetY = 4;
                });
                
                waveButton.onPointerOutObservable.add(() => {
                    waveButton.background = '#D32F2F';
                    waveButton.shadowOffsetY = 2;
                });
                
                // Cancel pulse if active
                if (waveButton.metadata?.isPulsing) {
                    waveButton.metadata.isPulsing = false;
                    waveButton.fontSize = 20; // Reset font size
                }
            }
        }
    }

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
        material.emissiveColor = new Color3(0, 0.7, 0);  // Increased green component for more glow
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

    private showTowerSelector(): void {
        if (!this.ui || !this.selectedPosition) return;

        // Create tower selector panel with modern sleek styling
        this.towerSelectorPanel = new Rectangle('towerSelectorPanel');
        
        // Make panel responsive based on screen width
        const screenWidth = this.ui.getSize().width;
        const isMobile = screenWidth < 768;
        
        if (isMobile) {
            // Mobile layout: 2x4 grid
            this.towerSelectorPanel.width = '100%';
            this.towerSelectorPanel.height = '400px';  // Taller for mobile
            this.towerSelectorPanel.background = '#1A1A1A';
            this.towerSelectorPanel.alpha = 0.95;
            this.towerSelectorPanel.thickness = 1;
            this.towerSelectorPanel.cornerRadius = 8;
            this.towerSelectorPanel.color = "#333333";
            this.towerSelectorPanel.zIndex = 10;
            this.towerSelectorPanel.shadowColor = "rgba(0, 0, 0, 0.7)";
            this.towerSelectorPanel.shadowBlur = 15;
            this.towerSelectorPanel.shadowOffsetY = -3;
            this.towerSelectorPanel.paddingBottom = "20px";
            
            this.towerSelectorPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.towerSelectorPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.towerSelectorPanel.top = '0px';
            
            // Create grid for tower buttons - 2x4 layout for mobile
            const grid = new Grid();
            for (let i = 0; i < 4; i++) {
                grid.addColumnDefinition(1/4);
            }
            for (let i = 0; i < 2; i++) {
                grid.addRowDefinition(1/2);
            }
            grid.width = '100%';
            grid.height = '380px';
            grid.top = '0px';
            grid.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.towerSelectorPanel.addControl(grid);

            // Add tower buttons with mobile-optimized styling
            const towers = [
                { id: 'basicTower', name: 'Basic', cost: '$50', color: '#4CAF50', accentColor: '#81C784' },
                { id: 'fastTower', name: 'Fast', cost: '$100', color: '#2196F3', accentColor: '#64B5F6' },
                { id: 'heavyTower', name: 'Heavy', cost: '$150', color: '#FF9800', accentColor: '#FFB74D' },
                { id: 'sniperTower', name: 'Sniper', cost: '$200', color: '#9C27B0', accentColor: '#BA68C8' },
                { id: 'fireTower', name: 'Fire', cost: '$125', color: '#FF5722', accentColor: '#FF8A65' },
                { id: 'waterTower', name: 'Water', cost: '$125', color: '#03A9F4', accentColor: '#4FC3F7' },
                { id: 'windTower', name: 'Wind', cost: '$125', color: '#8BC34A', accentColor: '#AED581' },
                { id: 'earthTower', name: 'Earth', cost: '$125', color: '#795548', accentColor: '#A1887F' }
            ];

            towers.forEach((tower, index) => {
                const buttonContainer = new Rectangle(`${tower.id}_container`);
                buttonContainer.width = '90%';
                buttonContainer.height = '90%';
                buttonContainer.background = '#252525';
                buttonContainer.cornerRadius = 6;
                buttonContainer.thickness = 0;
                buttonContainer.isPointerBlocker = true;
                
                // Add top accent border
                const accentBorder = new Rectangle(`${tower.id}_accent`);
                accentBorder.width = '100%';
                accentBorder.height = '3px';
                accentBorder.background = tower.color;
                accentBorder.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                accentBorder.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                accentBorder.cornerRadiusX = 3;
                buttonContainer.addControl(accentBorder);

                // Add hover effect with transition-like animation
                buttonContainer.onPointerEnterObservable.add(() => {
                    buttonContainer.background = '#303030';
                    
                    // Animate the accent border
                    let startSize = 3;
                    let targetSize = 5;
                    let step = 0.5;
                    let interval = setInterval(() => {
                        startSize += step;
                        accentBorder.height = startSize + "px";
                        if (startSize >= targetSize) {
                            clearInterval(interval);
                        }
                    }, 20);
                    
                    // Animate text scaling
                    nameText.fontSize = Number(nameText.fontSize) + 1;
                    costText.fontSize = Number(costText.fontSize) + 1;
                });

                buttonContainer.onPointerOutObservable.add(() => {
                    buttonContainer.background = '#252525';
                    accentBorder.height = "3px";
                    nameText.fontSize = Number(nameText.fontSize) - 1;
                    costText.fontSize = Number(costText.fontSize) - 1;
                });

                // Add tower name
                const nameText = new TextBlock(`${tower.id}_name`, tower.name);
                nameText.color = 'white';
                nameText.fontSize = 16;
                nameText.fontFamily = 'Arial';
                nameText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                nameText.top = "15px";
                buttonContainer.addControl(nameText);

                // Add cost
                const costText = new TextBlock(`${tower.id}_cost`, tower.cost);
                costText.color = '#FFD700';
                costText.fontSize = 14;
                costText.fontFamily = 'Arial';
                costText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                costText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                costText.top = "-20px";
                buttonContainer.addControl(costText);

                // Add click effect
                buttonContainer.onPointerDownObservable.add(() => {
                    buttonContainer.background = '#1A1A1A';
                    buttonContainer.scaleX = 0.95;
                    buttonContainer.scaleY = 0.95;
                    
                    setTimeout(() => {
                        buttonContainer.scaleX = 1;
                        buttonContainer.scaleY = 1;
                    }, 100);
                });

                // Handle click to place tower
                buttonContainer.onPointerClickObservable.add(() => {
                    if (this.playerStats && this.getTowerCost(tower.id) > this.playerStats.getMoney()) {
                        let originalLeft = 0;
                        let shakeAmount = 3;
                        let duration = 50;
                        
                        let shakeInterval = setInterval(() => {
                            buttonContainer.left = (Math.random() * shakeAmount * 2 - shakeAmount) + "px";
                        }, 20);
                        
                        setTimeout(() => {
                            clearInterval(shakeInterval);
                            buttonContainer.left = originalLeft + "px";
                        }, duration * 5);
                        
                        this.game.getAssetManager().playSound('error');
                        return;
                    }
                    
                    this.selectedTowerType = tower.id;
                    this.placeTowerAtPosition(this.selectedPosition!);
                    this.hideTowerSelector();
                    this.hidePlacementOutline();
                });

                // Calculate grid position (2x4 layout)
                const row = Math.floor(index / 4);
                const col = index % 4;
                grid.addControl(buttonContainer, row, col);
            });
        } else {
            // Desktop layout (original 1x8 grid)
            this.towerSelectorPanel.width = '850px';
            this.towerSelectorPanel.height = '180px';
            this.towerSelectorPanel.background = '#1A1A1A';
            this.towerSelectorPanel.alpha = 0.95;
            this.towerSelectorPanel.thickness = 1;
            this.towerSelectorPanel.cornerRadius = 8;
            this.towerSelectorPanel.color = "#333333";
            this.towerSelectorPanel.zIndex = 10;
            this.towerSelectorPanel.shadowColor = "rgba(0, 0, 0, 0.7)";
            this.towerSelectorPanel.shadowBlur = 15;
            this.towerSelectorPanel.shadowOffsetY = -3;
            this.towerSelectorPanel.paddingBottom = "20px";
            
            this.towerSelectorPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.towerSelectorPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.towerSelectorPanel.top = '-10px';
            
            // Create grid for tower buttons
            const grid = new Grid();
            for (let i = 0; i < 8; i++) {
                grid.addColumnDefinition(1/8);
            }
            grid.addRowDefinition(1);
            grid.width = '830px';
            grid.height = '160px';
            grid.top = '0px';
            grid.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.towerSelectorPanel.addControl(grid);

            // Add tower buttons with desktop styling
            const towers = [
                { id: 'basicTower', name: 'Basic', cost: '$50', color: '#4CAF50', accentColor: '#81C784' },
                { id: 'fastTower', name: 'Fast', cost: '$100', color: '#2196F3', accentColor: '#64B5F6' },
                { id: 'heavyTower', name: 'Heavy', cost: '$150', color: '#FF9800', accentColor: '#FFB74D' },
                { id: 'sniperTower', name: 'Sniper', cost: '$200', color: '#9C27B0', accentColor: '#BA68C8' },
                { id: 'fireTower', name: 'Fire', cost: '$125', color: '#FF5722', accentColor: '#FF8A65' },
                { id: 'waterTower', name: 'Water', cost: '$125', color: '#03A9F4', accentColor: '#4FC3F7' },
                { id: 'windTower', name: 'Wind', cost: '$125', color: '#8BC34A', accentColor: '#AED581' },
                { id: 'earthTower', name: 'Earth', cost: '$125', color: '#795548', accentColor: '#A1887F' }
            ];

            towers.forEach((tower, index) => {
                const buttonContainer = new Rectangle(`${tower.id}_container`);
                buttonContainer.width = '95px';
                buttonContainer.height = '140px';
                buttonContainer.background = '#252525';
                buttonContainer.cornerRadius = 6;
                buttonContainer.thickness = 0;
                buttonContainer.isPointerBlocker = true;
                
                // Add top accent border
                const accentBorder = new Rectangle(`${tower.id}_accent`);
                accentBorder.width = '100%';
                accentBorder.height = '3px';
                accentBorder.background = tower.color;
                accentBorder.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                accentBorder.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                accentBorder.cornerRadiusX = 3;
                buttonContainer.addControl(accentBorder);

                // Add hover effect with transition-like animation
                buttonContainer.onPointerEnterObservable.add(() => {
                    buttonContainer.background = '#303030';
                    
                    // Animate the accent border
                    let startSize = 3;
                    let targetSize = 5;
                    let step = 0.5;
                    let interval = setInterval(() => {
                        startSize += step;
                        accentBorder.height = startSize + "px";
                        if (startSize >= targetSize) {
                            clearInterval(interval);
                        }
                    }, 20);
                    
                    // Animate text scaling
                    nameText.fontSize = Number(nameText.fontSize) + 1;
                    costText.fontSize = Number(costText.fontSize) + 1;
                });

                buttonContainer.onPointerOutObservable.add(() => {
                    buttonContainer.background = '#252525';
                    accentBorder.height = "3px";
                    nameText.fontSize = Number(nameText.fontSize) - 1;
                    costText.fontSize = Number(costText.fontSize) - 1;
                });

                // Add tower name
                const nameText = new TextBlock(`${tower.id}_name`, tower.name);
                nameText.color = 'white';
                nameText.fontSize = 14;
                nameText.fontFamily = 'Arial';
                nameText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                nameText.top = "10px";
                buttonContainer.addControl(nameText);

                // Add cost
                const costText = new TextBlock(`${tower.id}_cost`, tower.cost);
                costText.color = '#FFD700';
                costText.fontSize = 12;
                costText.fontFamily = 'Arial';
                costText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                costText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                costText.top = "-20px";
                buttonContainer.addControl(costText);

                // Add click effect
                buttonContainer.onPointerDownObservable.add(() => {
                    buttonContainer.background = '#1A1A1A';
                    buttonContainer.scaleX = 0.95;
                    buttonContainer.scaleY = 0.95;
                    
                    setTimeout(() => {
                        buttonContainer.scaleX = 1;
                        buttonContainer.scaleY = 1;
                    }, 100);
                });

                // Handle click to place tower
                buttonContainer.onPointerClickObservable.add(() => {
                    if (this.playerStats && this.getTowerCost(tower.id) > this.playerStats.getMoney()) {
                        let originalLeft = 0;
                        let shakeAmount = 3;
                        let duration = 50;
                        
                        let shakeInterval = setInterval(() => {
                            buttonContainer.left = (Math.random() * shakeAmount * 2 - shakeAmount) + "px";
                        }, 20);
                        
                        setTimeout(() => {
                            clearInterval(shakeInterval);
                            buttonContainer.left = originalLeft + "px";
                        }, duration * 5);
                        
                        this.game.getAssetManager().playSound('error');
                        return;
                    }
                    
                    this.selectedTowerType = tower.id;
                    this.placeTowerAtPosition(this.selectedPosition!);
                    this.hideTowerSelector();
                    this.hidePlacementOutline();
                });

                grid.addControl(buttonContainer, 0, index);
            });
        }

        // Add the panel to the UI
        this.ui.addControl(this.towerSelectorPanel);
    }

    private hideTowerSelector(): void {
        if (this.towerSelectorPanel && this.ui) {
            this.ui.removeControl(this.towerSelectorPanel);
            this.towerSelectorPanel = null;
        }
        this.selectedPosition = null;
        this.hidePlacementOutline();
    }
} 