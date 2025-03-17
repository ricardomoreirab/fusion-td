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

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering gameplay state');
        
        // Create game components
        this.map = new Map(this.game);
        this.playerStats = new PlayerStats(100, 100); // Start with 100 health and 100 money
        this.towerManager = new TowerManager(this.game, this.map);
        this.enemyManager = new EnemyManager(this.game, this.map);
        this.waveManager = new WaveManager(this.enemyManager, this.playerStats);
        
        // Connect managers
        this.enemyManager.setPlayerStats(this.playerStats);
        this.towerManager.setEnemyManager(this.enemyManager);
        
        // Initialize the map
        this.map.initialize();
        
        // Create UI
        this.createUI();
        
        // Set up input handling
        this.setupInputHandling();
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
        statsContainer.width = '150px';  // Increased width
        statsContainer.height = '120px';
        statsContainer.background = 'transparent';
        statsContainer.thickness = 0;
        statsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        statsContainer.left = '0px';
        statsContainer.top = '10px';
        this.ui.addControl(statsContainer);

        // Health display with heart emoji
        const healthContainer = new Rectangle('healthContainer');
        healthContainer.width = '150px';  // Increased width
        healthContainer.height = '40px';
        healthContainer.background = 'transparent';
        healthContainer.thickness = 0;
        healthContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        healthContainer.top = '0px';
        healthContainer.left = '0px';
        statsContainer.addControl(healthContainer);

        const healthText = new TextBlock('healthText');
        healthText.text = `${this.getIcon(0xf004, '❤')} 100`;  // heart icon with fallback
        healthText.color = 'white';
        healthText.fontSize = 22;
        healthText.fontFamily = 'FontAwesome, Arial';
        healthText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthText.left = '10px';  // Small padding from the edge
        healthText.outlineWidth = 1;
        healthText.outlineColor = 'black';
        healthContainer.addControl(healthText);

        // Money display with coin emoji
        const moneyContainer = new Rectangle('moneyContainer');
        moneyContainer.width = '150px';  // Increased width
        moneyContainer.height = '40px';
        moneyContainer.background = 'transparent';
        moneyContainer.thickness = 0;
        moneyContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        moneyContainer.top = '40px';
        moneyContainer.left = '0px';
        statsContainer.addControl(moneyContainer);

        const moneyText = new TextBlock('moneyText');
        moneyText.text = `${this.getIcon(0xf51e, '$')} 100`;  // coins icon with fallback
        moneyText.color = 'white';
        moneyText.fontSize = 22;
        moneyText.fontFamily = 'FontAwesome, Arial';
        moneyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyText.left = '10px';  // Small padding from the edge
        moneyText.outlineWidth = 1;
        moneyText.outlineColor = 'black';
        moneyContainer.addControl(moneyText);

        // Wave display with wave emoji
        const waveContainer = new Rectangle('waveContainer');
        waveContainer.width = '150px';  // Increased width
        waveContainer.height = '40px';
        waveContainer.background = 'transparent';
        waveContainer.thickness = 0;
        waveContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveContainer.top = '80px';
        waveContainer.left = '0px';
        statsContainer.addControl(waveContainer);

        const waveText = new TextBlock('waveText');
        waveText.text = `${this.getIcon(0xf83e, '~')} 1`;  // wave icon with fallback
        waveText.color = 'white';
        waveText.fontSize = 22;
        waveText.fontFamily = 'FontAwesome, Arial';
        waveText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveText.left = '10px';  // Small padding from the edge
        waveText.outlineWidth = 1;
        waveText.outlineColor = 'black';
        waveContainer.addControl(waveText);

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
        cameraHelpText.text = `${this.getIcon(0xf8cc, '🖱')} Left-click + drag to rotate camera\n${this.getIcon(0xf013, '⚙')} Mouse wheel to zoom in/out`;
        cameraHelpText.color = 'white';
        cameraHelpText.fontSize = 12;
        cameraHelpText.fontFamily = 'FontAwesome, Arial';  // Added fallback font
        cameraHelpText.outlineWidth = 1;
        cameraHelpText.outlineColor = 'black';
        cameraHelpContainer.addControl(cameraHelpText);

        // Add show/hide button for camera help
        const toggleHelpButton = Button.CreateSimpleButton('toggleHelpButton', this.getIcon(0xf05a, 'i'));  // info icon with fallback
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
        toggleHelpButton.fontFamily = 'FontAwesome, Arial';  // Added fallback font
        
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
        const pauseButton = Button.CreateSimpleButton('pauseButton', this.getIcon(0xf04c, '⏸'));  // pause icon with fallback
        pauseButton.width = '40px';
        pauseButton.height = '40px';
        pauseButton.color = 'white';
        pauseButton.background = '#2196F3';
        pauseButton.cornerRadius = 20;
        pauseButton.thickness = 2;
        pauseButton.fontFamily = 'FontAwesome, Arial';  // Added fallback font
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

        // Create bottom panel for tower selection with adjusted dimensions
        const bottomPanel = new Rectangle('bottomPanel');
        bottomPanel.width = '100%';  // Full width for better mobile support
        bottomPanel.height = '80px';
        bottomPanel.background = 'transparent';
        bottomPanel.thickness = 0;
        bottomPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        bottomPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        bottomPanel.top = '-5px';
        bottomPanel.zIndex = 5;
        this.ui.addControl(bottomPanel);

        // Create panel title and tabs - centered and responsive
        const tabsContainer = new Rectangle('bottomTabsContainer');
        tabsContainer.width = '140px';
        tabsContainer.height = '24px';
        tabsContainer.background = 'transparent';
        tabsContainer.thickness = 0;
        tabsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        tabsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        tabsContainer.top = '0px';
        tabsContainer.zIndex = 10;
        bottomPanel.addControl(tabsContainer);

        const basicTab = Button.CreateSimpleButton('basicTab', 'Basic');
        basicTab.width = '65px';
        basicTab.height = '24px';
        basicTab.color = 'white';
        basicTab.background = '#388E3C';
        basicTab.cornerRadius = 4;
        basicTab.thickness = 1;
        basicTab.fontFamily = 'Arial';
        basicTab.fontSize = 12;
        basicTab.fontWeight = 'bold';
        basicTab.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        basicTab.shadowColor = "rgba(0, 0, 0, 0.6)";
        basicTab.shadowBlur = 5;
        basicTab.shadowOffsetY = 2;
        basicTab.isPointerBlocker = true;

        basicTab.onPointerEnterObservable.add(() => {
            basicTab.background = '#4CAF50';
            basicTab.shadowOffsetY = 4;
        });

        basicTab.onPointerOutObservable.add(() => {
            if (this.ui) {
                const currentTab = this.ui.getControlByName('basicTab') as Button;
                if (currentTab && currentTab !== basicTab) {
                    basicTab.background = '#388E3C';
                    basicTab.shadowOffsetY = 2;
                }
            }
        });

        basicTab.onPointerUpObservable.add(() => {
            this.switchTowerCategory('basic');
        });
        tabsContainer.addControl(basicTab);

        const elementalTab = Button.CreateSimpleButton('elementalTab', 'Elemental');
        elementalTab.width = '65px';
        elementalTab.height = '24px';
        elementalTab.color = 'white';
        elementalTab.background = '#333333';
        elementalTab.cornerRadius = 4;
        elementalTab.thickness = 1;
        elementalTab.fontFamily = 'Arial';
        elementalTab.fontSize = 12;
        elementalTab.fontWeight = 'bold';
        elementalTab.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        elementalTab.shadowColor = "rgba(0, 0, 0, 0.6)";
        elementalTab.shadowBlur = 5;
        elementalTab.shadowOffsetY = 2;
        elementalTab.isPointerBlocker = true;

        elementalTab.onPointerEnterObservable.add(() => {
            elementalTab.background = '#555555';
            elementalTab.shadowOffsetY = 4;
        });

        elementalTab.onPointerOutObservable.add(() => {
            if (this.ui) {
                const currentTab = this.ui.getControlByName('elementalTab') as Button;
                if (currentTab && currentTab !== elementalTab) {
                    elementalTab.background = '#333333';
                    currentTab.shadowOffsetY = 2;
                }
            }
        });

        elementalTab.onPointerUpObservable.add(() => {
            this.switchTowerCategory('elemental');
        });
        tabsContainer.addControl(elementalTab);

        // Create tower selection container - now responsive
        const towerPanel = new Rectangle('towerPanel');
        towerPanel.width = '95%';  // Leave some margin on the sides
        towerPanel.height = '45px';
        towerPanel.background = 'transparent';
        towerPanel.thickness = 0;
        towerPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        towerPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        towerPanel.top = '-5px';
        towerPanel.zIndex = 6;
        bottomPanel.addControl(towerPanel);

        // Calculate responsive button widths and spacing
        const buttonWidth = '22%';  // Slightly less than 25% to ensure spacing
        const buttonSpacing = '4%';  // Space between buttons

        // Create tower buttons with responsive widths
        this.createResponsiveTowerButton('basicTower', 'Basic', '$50', '#4CAF50', buttonWidth, '0%', towerPanel);
        this.createResponsiveTowerButton('fastTower', 'Fast', '$100', '#2196F3', buttonWidth, '25%', towerPanel);
        this.createResponsiveTowerButton('heavyTower', 'Heavy', '$150', '#FF9800', buttonWidth, '50%', towerPanel);
        this.createResponsiveTowerButton('sniperTower', 'Sniper', '$200', '#9C27B0', buttonWidth, '75%', towerPanel);

        // Create elemental tower buttons (initially hidden)
        this.createResponsiveTowerButton('fireTower', 'Fire', '$125', '#FF5722', buttonWidth, '0%', towerPanel, true);
        this.createResponsiveTowerButton('waterTower', 'Water', '$125', '#03A9F4', buttonWidth, '25%', towerPanel, true);
        this.createResponsiveTowerButton('windTower', 'Wind', '$125', '#8BC34A', buttonWidth, '50%', towerPanel, true);
        this.createResponsiveTowerButton('earthTower', 'Earth', '$125', '#795548', buttonWidth, '75%', towerPanel, true);

        // Create wave button in top right
        const waveButton = Button.CreateSimpleButton('waveButton', this.getIcon(0xf067, '+'));  // plus icon with fallback
        waveButton.width = '40px';
        waveButton.height = '40px';
        waveButton.color = 'white';
        waveButton.background = '#D32F2F';
        waveButton.cornerRadius = 20;
        waveButton.thickness = 2;
        waveButton.fontFamily = 'FontAwesome, Arial';  // Added fallback font
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
        if (healthText) {
            healthText.text = `${this.getIcon(0xf004, '❤')} ${this.playerStats.getHealth()}`;
        }
        
        const moneyText = this.ui.getControlByName('moneyText') as TextBlock;
        if (moneyText) {
            moneyText.text = `${this.getIcon(0xf51e, '$')} ${this.playerStats.getMoney()}`;
        }
        
        const waveText = this.ui.getControlByName('waveText') as TextBlock;
        if (waveText) {
            let waveDisplay = `${this.getIcon(0xf83e, '~')} ${this.waveManager.getCurrentWave()}`;
            const difficulty = this.waveManager.getDifficultyMultiplier();
            if (difficulty > 1.0) {
                waveDisplay += `×${difficulty.toFixed(1)}`;
            }
            waveText.text = waveDisplay;
        }
    }

    private setupInputHandling(): void {
        this.scene = this.game.getScene();
        if (!this.scene) return;
        
        this.scene.onPointerDown = (evt) => {
            if (evt.button !== 0 || !this.scene) return;
            
            const pickInfo = this.scene.pick(
                this.scene.pointerX, 
                this.scene.pointerY
            );
            
            if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                return;
            }
            
            if (this.selectedTowerType && this.scene) {
                const pickResult = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY,
                    (mesh) => {
                        return mesh.name.startsWith('ground_');
                    }
                );
                
                if (pickResult.hit) {
                    const position = pickResult.pickedPoint;
                    if (position && this.map) {
                        const gridPosition = this.map.worldToGrid(position);
                        if (this.map.canPlaceTower(gridPosition.x, gridPosition.y)) {
                            this.placeTowerAtPosition(position);
                        }
                    }
                }
            } else {
                const pickResult = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY
                );
                
                if (pickResult.hit && pickResult.pickedMesh) {
                    const clickedTower = this.findTowerByMesh(pickResult.pickedMesh);
                    
                    if (clickedTower) {
                        this.selectTower(clickedTower);
                    } else {
                        this.deselectTower();
                    }
                } else {
                    this.deselectTower();
                }
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
        
        if (this.towerPreview) {
            this.towerPreview.setEnabled(false);
        }
        if (this.squareOutline) {
            this.squareOutline.setEnabled(false);
        }
        
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
            this.towerInfoPanel = new Rectangle('towerInfoPanel');
            this.towerInfoPanel.width = "220px";
            this.towerInfoPanel.height = "160px";
            this.towerInfoPanel.cornerRadius = 10;
            this.towerInfoPanel.color = "#333333";
            this.towerInfoPanel.thickness = 2;
            this.towerInfoPanel.background = "#222222";
            this.towerInfoPanel.alpha = 0.9;
            this.towerInfoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.towerInfoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.towerInfoPanel.top = "-160px";
            this.towerInfoPanel.left = "-10px";
            this.towerInfoPanel.shadowColor = "rgba(0, 0, 0, 0.6)";
            this.towerInfoPanel.shadowBlur = 5;
            this.towerInfoPanel.shadowOffsetY = 2;
            this.ui.addControl(this.towerInfoPanel);
            
            const titleBlock = new TextBlock('towerInfoTitle', 'Tower Info');
            titleBlock.color = "white";
            titleBlock.fontSize = 16;
            titleBlock.height = "30px";
            titleBlock.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            titleBlock.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            titleBlock.top = "10px";
            this.towerInfoPanel.addControl(titleBlock);
            
            this.sellButton = new Rectangle('sellButton');
            this.sellButton.width = "100px";
            this.sellButton.height = "40px";
            this.sellButton.cornerRadius = 5;
            this.sellButton.color = "#FF4444";
            this.sellButton.thickness = 2;
            this.sellButton.background = "#AA2222";
            this.sellButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.sellButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.sellButton.top = "-20px";
            this.sellButton.left = "0px";
            this.sellButton.isPointerBlocker = true;
            
            const sellText = new TextBlock('sellText', 'SELL');
            sellText.color = "white";
            sellText.fontSize = 14;
            this.sellButton.addControl(sellText);
            
            const sellValueText = new TextBlock('sellValueText', '');
            sellValueText.color = "white";
            sellValueText.fontSize = 12;
            sellValueText.top = "15px";
            this.sellButton.addControl(sellValueText);
            
            this.sellButton.onPointerEnterObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#DD3333";
                    this.sellButton.thickness = 3;
                }
            });
            
            this.sellButton.onPointerOutObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#AA2222";
                    this.sellButton.thickness = 2;
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
            this.upgradeButton.width = "100px";
            this.upgradeButton.height = "40px";
            this.upgradeButton.cornerRadius = 5;
            this.upgradeButton.color = "#44FF44";
            this.upgradeButton.thickness = 2;
            this.upgradeButton.background = "#22AA22";
            this.upgradeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.upgradeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.upgradeButton.top = "-70px";
            this.upgradeButton.left = "0px";
            this.upgradeButton.isPointerBlocker = true;
            
            const upgradeText = new TextBlock('upgradeText', 'UPGRADE');
            upgradeText.color = "white";
            upgradeText.fontSize = 14;
            this.upgradeButton.addControl(upgradeText);
            
            const upgradeCostText = new TextBlock('upgradeCostText', '');
            upgradeCostText.color = "white";
            upgradeCostText.fontSize = 12;
            upgradeCostText.top = "15px";
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
        
        if (this.sellButton) {
            const sellValueTextBlock = this.sellButton.getChildByName('sellValueText') as TextBlock;
            if (sellValueTextBlock) {
                sellValueTextBlock.text = `$${this.selectedTower.getSellValue()}`;
            }
        }
        
        if (this.upgradeButton) {
            const upgradeCostTextBlock = this.upgradeButton.getChildByName('upgradeCostText') as TextBlock;
            if (upgradeCostTextBlock) {
                upgradeCostTextBlock.text = `$${this.selectedTower.getUpgradeCost()}`;
            }
            
            if (this.playerStats && this.playerStats.getMoney() < this.selectedTower.getUpgradeCost()) {
                this.upgradeButton.background = "#555555";
                this.upgradeButton.color = "#777777";
            } else {
                this.upgradeButton.background = "#22AA22";
                this.upgradeButton.color = "#44FF44";
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
            pauseButton.textBlock.text = this.getIcon(0xf04b, '▶');  // play icon with fallback
            pauseButton.background = '#4CAF50';
        } else {
            pauseButton.textBlock.text = this.getIcon(0xf04c, '⏸');  // pause icon with fallback
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
            waveButton.textBlock.text = this.getIcon(0xf519, '⟳');  // random icon with fallback
            waveButton.background = '#F57C00';
        } else if (this.waveManager.getAutoWaveTimeRemaining() > 0) {
            waveButton.textBlock.text = this.getIcon(0xf017, '⏲');  // clock icon with fallback
            waveButton.background = '#1976D2';
        } else {
            waveButton.textBlock.text = this.getIcon(0xf067, '+');  // plus icon with fallback
            waveButton.background = '#D32F2F';
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
} 