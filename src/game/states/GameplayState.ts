import { Engine, Scene, Vector3, Color3, Color4, ArcRotateCamera, HemisphericLight, DirectionalLight, PointLight, ShadowGenerator, MeshBuilder, StandardMaterial, Texture, KeyboardEventTypes, Mesh, LinesMesh, Matrix, PointerEventTypes, PointerInfo, AbstractMesh, ParticleSystem, TransformNode } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, TextBlock, Image, Grid } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { TowerManager } from '../gameplay/TowerManager';
import { EnemyManager } from '../gameplay/EnemyManager';
import { WaveManager } from '../gameplay/WaveManager';
import { PlayerStats } from '../gameplay/PlayerStats';
import { Tower, ElementType, TargetingMode } from '../gameplay/towers/Tower';
import { WaveStatus } from '../gameplay/WaveStatus';
import { DamageNumberManager } from '../gameplay/DamageNumberManager';
import { LevelManager } from '../gameplay/LevelManager';
import { AbilityManager } from '../gameplay/AbilityManager';
import { ChampionManager } from '../gameplay/ChampionManager';
import { TowerPreviewRenderer } from '../ui/TowerPreviewRenderer';
import { PALETTE } from '../rendering/StyleConstants';
import { TowerDefinition, getTowerDefinition, getBaseTowers, getUpgradeOptions } from '../gameplay/towers/TowerDefinitions';
import { getUpgradeCost } from '../gameplay/towers/UpgradeTree';

// ==================== TOWER DATA (derived from definitions) ====================

interface TowerData {
    id: string;
    name: string;
    cost: number;
    color: string;
    element: string;
    category: 'medieval' | 'elemental';
    damage: number;
    range: number;
    fireRate: number;
    description: string;
}

// Two base towers only
const TOWER_DATA: TowerData[] = [
    { id: 'medievalTower',    name: 'Medieval Tower',    cost: 50, color: '#8B7355', element: 'none',    category: 'medieval',  damage: 8,  range: 5, fireRate: 1.0, description: 'Physical tower. Branches into Archer or Garrison paths.' },
    { id: 'elementalObelisk', name: 'Elemental Obelisk', cost: 50, color: '#9B59B6', element: 'arcane',  category: 'elemental', damage: 6,  range: 5, fireRate: 1.2, description: 'Magical tower. Branches into Fire or Ice paths.' },
];

function getTowerDataById(id: string): TowerData | undefined {
    // First check base tower data
    const base = TOWER_DATA.find(t => t.id === id);
    if (base) return base;
    // Fall back to definition system
    const def = getTowerDefinition(id);
    if (!def) return undefined;
    const treeColor = def.tree === 'medieval' ? '#8B7355' : '#9B59B6';
    return {
        id: def.id,
        name: def.name,
        cost: def.stats.cost,
        color: treeColor,
        element: def.category,
        category: def.tree,
        damage: def.stats.damage,
        range: def.stats.range,
        fireRate: def.stats.fireRate,
        description: def.description,
    };
}

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
    private selectorAnchor: TransformNode | null = null;
    private selectorCards: Rectangle[] = [];
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
    private towerDetailPopup: Rectangle | null = null;
    private levelManager: LevelManager | null = null;
    private levelTransitioning: boolean = false;
    private levelTransitionOverlay: Rectangle | null = null;
    private towerPreviewRenderer: TowerPreviewRenderer | null = null;
    private rewardEventHandler: ((e: Event) => void) | null = null;
    private targetingButton: Rectangle | null = null;
    private abilityManager: AbilityManager | null = null;
    private meteorButton: Rectangle | null = null;
    private frostNovaButton: Rectangle | null = null;
    private chainLightningButton: Rectangle | null = null;
    private fortifyButton: Rectangle | null = null;
    private goldRushButton: Rectangle | null = null;
    private lastKnownHealth: number = -1;
    private damageVignette: Rectangle | null = null;
    private waveClearText: TextBlock | null = null;
    private bossWarningText: TextBlock | null = null;
    private lastWaveInProgress: boolean = false;
    private lastSegmentWave: number = 0;
    private upgradeGuidePanel: Rectangle | null = null;
    private upgradeGuideToggle: Button | null = null;
    private championManager: ChampionManager | null = null;
    private championButton: Rectangle | null = null;
    private bottomToolbar: Rectangle | null = null;
    private _selectorPositionObs: any = null;

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
            camera.target = new Vector3(20, 0, 20); // Will be updated after levelManager created
            camera.alpha = -Math.PI / 4;
            camera.beta = 1.05;  // tilted isometric: ~60° from pole
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
        this.selectorAnchor = null;
        this.selectorCards = [];
        this._selectorPositionObs = null;
        this.placementOutline = null;
        this.placementPlane = null;
        this.towerTypeText = null;
        this.towerLevelText = null;
        this.towerDamageText = null;
        this.towerRangeText = null;
        this.towerRateText = null;
        this.bottomToolbar = null;

        // Create level manager
        this.levelManager = new LevelManager(this.game);
        this.levelTransitioning = false;

        // Setup the first map segment (Level 1: The Enchanted Forest)
        this.map = this.levelManager.createFirstSegment();

        // Create enemy manager
        this.enemyManager = new EnemyManager(this.game, this.map);

        // Create player stats (initial values: health, money)
        this.playerStats = new PlayerStats(100, 200);

        // Set player stats in enemy manager for rewards
        this.enemyManager.setPlayerStats(this.playerStats);

        // Create tower manager
        this.towerManager = new TowerManager(this.game, this.map);
        this.towerManager.setLevelManager(this.levelManager);

        // Connect managers for targeting
        this.towerManager.setEnemyManager(this.enemyManager);

        // Connect managers for tower destruction
        this.enemyManager.setTowerManager(this.towerManager);

        // Create wave manager (infinite mode)
        this.waveManager = new WaveManager(this.enemyManager, this.playerStats);

        // Set up segment completion callback
        this.waveManager.setOnSegmentComplete(() => this.extendMap());

        // Create ability manager
        this.abilityManager = new AbilityManager(this.game, this.enemyManager);
        this.abilityManager.setPlayerStats(this.playerStats);
        this.abilityManager.setTowerManager(this.towerManager);

        // Create champion manager
        this.championManager = new ChampionManager(this.game, this.enemyManager, this.waveManager);

        // Generate tower preview images then build UI
        this.towerPreviewRenderer = new TowerPreviewRenderer(this.game);
        this.towerPreviewRenderer.generateAll().then(() => {
            this.createUI();
            this.setupInputHandling();
        }).catch(() => {
            // Fallback: build UI without previews
            this.createUI();
            this.setupInputHandling();
        });

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

        // Listen for enemy reward events (gold float text on death)
        this.rewardEventHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (this.damageNumberManager) {
                this.damageNumberManager.showReward(detail.position, detail.reward);
            }
        };
        document.addEventListener('enemyReward', this.rewardEventHandler);

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
        this.levelManager?.dispose(); // disposes all maps
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

        // Remove reward event listener
        if (this.rewardEventHandler) {
            document.removeEventListener('enemyReward', this.rewardEventHandler);
            this.rewardEventHandler = null;
        }

        // Reset time scale
        this.game.setTimeScale(1);

        // Clear references
        this.map = null;
        this.towerManager = null;
        this.enemyManager = null;
        this.waveManager = null;
        this.playerStats = null;
        this.levelManager = null;
        if (this.abilityManager) {
            this.abilityManager.dispose();
            this.abilityManager = null;
        }
        if (this.championManager) {
            this.championManager.dispose();
            this.championManager = null;
        }
        this.championButton = null;
        this.levelTransitioning = false;
        this.confirmationButtons.container = null;
        this.confirmationButtons.position = null;
        this.towerPreviewRenderer = null;
    }

    public update(deltaTime: number): void {
        if (this.isPaused || this.levelTransitioning) return;

        // Apply time scale
        const scaledDelta = deltaTime * this.game.getTimeScale();

        // Update game components
        this.towerManager?.update(scaledDelta);
        this.enemyManager?.update(scaledDelta);
        this.waveManager?.update(scaledDelta);
        this.abilityManager?.update(scaledDelta);
        this.championManager?.update(scaledDelta);

        // Update damage numbers (use real deltaTime for smooth animation)
        this.damageNumberManager?.update(deltaTime);

        // Check for game over condition (only way game ends — player death)
        if (this.playerStats && this.playerStats.getHealth() <= 0) {
            this.game.getStateManager().changeState('gameOver');
        }

        // --- Screen damage vignette ---
        if (this.playerStats) {
            const currentHealth = this.playerStats.getHealth();
            if (this.lastKnownHealth > 0 && currentHealth < this.lastKnownHealth) {
                this.flashDamageVignette();
            }
            this.lastKnownHealth = currentHealth;
        }

        // --- Wave complete feedback + Boss warning ---
        if (this.waveManager) {
            const waveInProgress = this.waveManager.isWaveInProgress();
            const segmentWave = this.waveManager.getSegmentWave();

            // Detect wave just completed (was in progress, now not)
            if (this.lastWaveInProgress && !waveInProgress && segmentWave > this.lastSegmentWave) {
                this.showWaveClearText();
                // Boss warning: check upcoming waves
                if (segmentWave === 8) {
                    this.showBossWarning('WARNING: Boss in 2 waves!', false);
                } else if (segmentWave === 9) {
                    this.showBossWarning('BOSS INCOMING!', true);
                }
            }
            this.lastWaveInProgress = waveInProgress;
            this.lastSegmentWave = segmentWave;
        }

        // Update UI
        this.updateUI();
    }

    // ========================================================================
    // MAP EXTENSION (infinite mode)
    // ========================================================================

    /**
     * Extend the map with a new procedural segment. Called when 10 waves are completed
     * on the current segment. Towers, enemies, and the wave manager persist.
     */
    private extendMap(): void {
        if (!this.levelManager || !this.enemyManager || !this.playerStats) return;

        console.log('Extending map with new segment...');

        // 1. Remove the end portal from the latest segment (visual cleanup)
        this.levelManager.removeEndPortalFromLatestSegment();

        // 2. Generate and create the new segment
        const newMap = this.levelManager.generateNextSegment();
        const newSegmentIndex = this.levelManager.getSegmentCount() - 1;

        // 3. Get bridge + new path for extending in-flight enemies
        const bridgeAndPath = this.levelManager.getBridgeAndNewSegmentPath(newSegmentIndex);
        this.enemyManager.extendAllEnemyPaths(bridgeAndPath);

        // 4. Update composite path for future enemy spawning
        const compositePath = this.levelManager.getCompositePath();
        this.enemyManager.setCompositePath(compositePath);

        // 5. Award money bonus
        this.playerStats.addMoney(newMap.getZOffsetValue() > 0 ? 100 + (newSegmentIndex - 1) * 50 : 0);

        // 6. Animate camera to new segment
        this.levelManager.animateCameraToSegment(newSegmentIndex);

        // 7. Show brief "New Territory!" notification
        this.showNewTerritoryNotification();

        console.log(`Map extended to segment ${newSegmentIndex + 1}`);
    }

    /**
     * Show a brief non-blocking "New Territory!" notification that fades after 2 seconds.
     */
    private showNewTerritoryNotification(): void {
        if (!this.ui) return;

        const notification = new Rectangle('newTerritoryNotification');
        notification.width = '300px';
        notification.height = '50px';
        notification.background = 'rgba(76, 175, 80, 0.9)';
        notification.cornerRadius = 12;
        notification.thickness = 0;
        notification.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        notification.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        notification.top = '-100px';
        notification.zIndex = 50;
        this.ui.addControl(notification);

        const text = new TextBlock('notificationText');
        text.text = 'New Territory Unlocked!';
        text.color = '#FFFFFF';
        text.fontSize = 22;
        text.fontFamily = 'Arial';
        text.fontWeight = 'bold';
        notification.addControl(text);

        // Fade out after 2 seconds
        setTimeout(() => {
            if (this.ui && notification) {
                this.ui.removeControl(notification);
            }
        }, 2000);
    }

    // ========================================================================
    // UI CREATION
    // ========================================================================

    private createUI(): void {
        // Create the UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI("gameplayUI", true, this.scene!);

        // Mobile: completely separate UI path
        const isMobileCheck = this.isMobileDevice();
        console.log(`[createUI] isMobile=${isMobileCheck}, innerWidth=${window.innerWidth}, touch=${'ontouchstart' in window}, maxTouch=${navigator.maxTouchPoints}`);
        if (isMobileCheck) {
            this.ui.idealWidth = 600;
            this.ui.useSmallestIdeal = true;
            this.createMobileHUD();
            this.createMobileAbilityButtons();
            this.createMobileUpgradeGuideButton();
            console.log('[createUI] Mobile UI path taken');
            return;
        }

        // Detect if we're on a mobile device
        const isMobile = this.isMobileDevice();

        // Apply device-specific UI scaling
        if (isMobile) {
            this.ui.idealWidth = 600;
            this.ui.useSmallestIdeal = true;
        }

        // ====== STATS BAR (top-left): compact horizontal bar ======
        const statsBar = new Rectangle('statsContainer');
        statsBar.width = isMobile ? '250px' : '400px';
        statsBar.height = isMobile ? '36px' : '44px';
        statsBar.background = PALETTE.UI_PANEL_BG;
        statsBar.cornerRadius = isMobile ? 10 : 16;
        statsBar.thickness = 1;
        statsBar.color = PALETTE.UI_BORDER;
        statsBar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsBar.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        statsBar.left = '6px';
        statsBar.top = '6px';
        statsBar.shadowColor = 'rgba(0,0,0,0.3)';
        statsBar.shadowBlur = 8;
        statsBar.shadowOffsetY = 2;
        this.ui.addControl(statsBar);

        // Helper: each stat lives in its own fixed-width container so text never overlaps
        const createStatGroup = (
            circleColor: string, label: string, valueName: string,
            defaultValue: string, leftPos: number, groupWidth: number
        ) => {
            // Container that clips its contents
            const group = new Rectangle(`${valueName}Group`);
            group.width = groupWidth + 'px';
            group.height = isMobile ? '30px' : '36px';
            group.thickness = 0;
            group.background = 'transparent';
            group.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            group.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            group.left = leftPos + 'px';
            statsBar.addControl(group);

            // Icon circle
            const circleSize = isMobile ? 20 : 26;
            const circle = new Rectangle(`${valueName}Dot`);
            circle.width = circleSize + 'px';
            circle.height = circleSize + 'px';
            circle.cornerRadius = circleSize / 2;
            circle.background = circleColor;
            circle.thickness = 0;
            circle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            circle.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            circle.left = '0px';
            group.addControl(circle);

            const circleLabel = new TextBlock(`${valueName}Label`, label);
            circleLabel.color = '#FFFFFF';
            circleLabel.fontSize = isMobile ? 7 : 9;
            circleLabel.fontFamily = 'Arial';
            circleLabel.fontWeight = 'bold';
            circle.addControl(circleLabel);

            // Value text — constrained to remaining width inside group
            const valueText = new TextBlock(valueName);
            valueText.text = defaultValue;
            valueText.color = '#FFFFFF';
            valueText.fontSize = isMobile ? 11 : 14;
            valueText.fontFamily = 'Arial';
            valueText.fontWeight = 'bold';
            valueText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            valueText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            valueText.left = (circleSize + 4) + 'px';
            valueText.width = (groupWidth - circleSize - 6) + 'px';
            valueText.resizeToFit = true;
            group.addControl(valueText);
        };

        // Stat groups with explicit widths — HP short, $ medium, Wave long
        const hpWidth = isMobile ? 52 : 80;
        const goldWidth = isMobile ? 60 : 90;
        const waveWidth = isMobile ? 100 : 160;

        createStatGroup('#E53935', 'HP', 'healthText', '100', isMobile ? 6 : 8, hpWidth);
        createStatGroup('#F5A623', '$', 'moneyText', '200', (isMobile ? 6 : 8) + hpWidth + (isMobile ? 2 : 4), goldWidth);
        createStatGroup('#42A5F5', 'W', 'waveText', 'S1-1/10', (isMobile ? 6 : 8) + hpWidth + (isMobile ? 2 : 4) + goldWidth + (isMobile ? 2 : 4), waveWidth);

        // Rename the health circle to 'healthDot' for updateUI compat
        // The dot is nested inside the group container, so search recursively via the UI texture
        const hGroup = statsBar.getChildByName('healthTextGroup') as Rectangle;
        if (hGroup) {
            const hDot = hGroup.getChildByName('healthTextDot');
            if (hDot) hDot.name = 'healthDot';
        }

        // Kill text (small, right-aligned in remaining space)
        const killText = new TextBlock('killText');
        killText.text = '0';
        killText.color = '#B0B8C8';
        killText.fontSize = isMobile ? 9 : 11;
        killText.fontFamily = 'Arial';
        killText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        killText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        killText.left = '-6px';
        killText.width = '30px';
        statsBar.addControl(killText);

        // Fade-in animation for stats bar
        statsBar.alpha = 0;
        let fadeIn = 0;
        const fadeObs = this.scene!.onBeforeRenderObservable.add(() => {
            fadeIn += 0.05;
            statsBar.alpha = Math.min(1, fadeIn);
            if (fadeIn >= 1) this.scene?.onBeforeRenderObservable.remove(fadeObs);
        });

        // ====== WAVE INFO BAR (below stats bar on desktop, merged into second row on mobile) ======
        const waveInfoBar = new Rectangle('waveInfoContainer');
        waveInfoBar.width = isMobile ? '250px' : '400px';
        waveInfoBar.height = isMobile ? '22px' : '28px';
        waveInfoBar.background = PALETTE.UI_PANEL_BG;
        waveInfoBar.cornerRadius = isMobile ? 7 : 10;
        waveInfoBar.thickness = 1;
        waveInfoBar.color = PALETTE.UI_BORDER;
        waveInfoBar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveInfoBar.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveInfoBar.left = '6px';
        waveInfoBar.top = isMobile ? '44px' : '58px';
        this.ui.addControl(waveInfoBar);

        const countdownText = new TextBlock('countdownText');
        countdownText.text = '';
        countdownText.color = '#F5A623';
        countdownText.fontSize = isMobile ? 10 : 12;
        countdownText.fontFamily = 'Arial';
        countdownText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        countdownText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        countdownText.left = '8px';
        waveInfoBar.addControl(countdownText);

        const enemiesText = new TextBlock('enemiesText');
        enemiesText.text = '';
        enemiesText.color = '#B0B8C8';
        enemiesText.fontSize = isMobile ? 10 : 12;
        enemiesText.fontFamily = 'Arial';
        enemiesText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        enemiesText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        enemiesText.left = '-8px';
        waveInfoBar.addControl(enemiesText);

        // ====== CONTROLS STRIP ======
        const controlStrip = new Rectangle('controlsPanel');
        if (isMobile) {
            // Mobile: compact horizontal bar at top-right
            controlStrip.width = '180px';
            controlStrip.height = '36px';
            controlStrip.cornerRadius = 10;
            controlStrip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            controlStrip.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            controlStrip.top = '6px';
            controlStrip.left = '-6px';
        } else {
            // Desktop: vertical strip at top-right
            controlStrip.width = '52px';
            controlStrip.height = '220px';
            controlStrip.cornerRadius = 16;
            controlStrip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            controlStrip.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            controlStrip.top = '10px';
            controlStrip.left = '-10px';
        }
        controlStrip.background = PALETTE.UI_PANEL_BG;
        controlStrip.thickness = 1;
        controlStrip.color = PALETTE.UI_BORDER;
        controlStrip.shadowColor = 'rgba(0,0,0,0.3)';
        controlStrip.shadowBlur = 8;
        controlStrip.shadowOffsetY = 2;
        this.ui.addControl(controlStrip);

        // Pause button
        const mBtnSize = 44; // mobile button size in ideal px (Apple/Google 44px guideline)
        const pauseBtnSize = isMobile ? mBtnSize + 'px' : '40px';
        const pauseButton = Button.CreateSimpleButton('pauseButton', 'II');
        pauseButton.width = pauseBtnSize;
        pauseButton.height = pauseBtnSize;
        pauseButton.color = '#FFFFFF';
        pauseButton.background = '#2196F3';
        pauseButton.cornerRadius = 20;
        pauseButton.thickness = 0;
        pauseButton.fontFamily = 'Arial';
        pauseButton.fontSize = isMobile ? 12 : 16;
        pauseButton.fontWeight = 'bold';
        pauseButton.zIndex = 100;

        if (isMobile) {
            pauseButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            pauseButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            pauseButton.left = '4px';
        } else {
            pauseButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            pauseButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            pauseButton.top = '8px';
        }

        if (!isMobile) {
            pauseButton.onPointerEnterObservable.add(() => { pauseButton.background = '#42A5F5'; });
            pauseButton.onPointerOutObservable.add(() => {
                pauseButton.background = this.game.getIsPaused() ? '#4CAF50' : '#2196F3';
            });
        }
        pauseButton.onPointerClickObservable.add(() => { this.game.togglePause(); });
        controlStrip.addControl(pauseButton);
        this.registerPauseButtonUpdate(pauseButton);

        // Next wave button
        const waveBtnSize = isMobile ? mBtnSize + 'px' : '40px';
        const waveButton = Button.CreateSimpleButton('waveButton', '>');
        waveButton.width = waveBtnSize;
        waveButton.height = waveBtnSize;
        waveButton.color = '#FFFFFF';
        waveButton.background = '#E53935';
        waveButton.cornerRadius = 20;
        waveButton.thickness = 0;
        waveButton.fontFamily = 'Arial';
        waveButton.fontSize = isMobile ? 14 : 18;
        waveButton.fontWeight = 'bold';
        waveButton.zIndex = 100;

        if (isMobile) {
            waveButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            waveButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            waveButton.left = (4 + mBtnSize + 4) + 'px';
        } else {
            waveButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            waveButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            waveButton.top = '56px';
        }

        if (!isMobile) {
            waveButton.onPointerEnterObservable.add(() => { waveButton.background = '#EF5350'; });
            waveButton.onPointerOutObservable.add(() => { waveButton.background = '#E53935'; });
        }

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
                } else {
                    this.waveManager.startNextWave();
                }
            }
        });
        controlStrip.addControl(waveButton);
        this.registerWaveButtonUpdate(waveButton);

        // Separator line
        const separator = new Rectangle('controlsSep');
        if (isMobile) {
            separator.width = '1px';
            separator.height = '22px';
            separator.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            separator.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            separator.left = (4 + mBtnSize * 2 + 8) + 'px';
        } else {
            separator.width = '32px';
            separator.height = '1px';
            separator.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            separator.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            separator.top = '104px';
        }
        separator.background = 'rgba(80,90,110,0.4)';
        separator.thickness = 0;
        controlStrip.addControl(separator);

        // Speed buttons
        const speeds = [1, 2, 3];
        const mSpeedSize = 26;
        speeds.forEach((speed, index) => {
            const speedBtn = Button.CreateSimpleButton(`speed${speed}Btn`, `${speed}x`);
            const speedBtnSize = isMobile ? mSpeedSize + 'px' : '36px';
            speedBtn.width = speedBtnSize;
            speedBtn.height = speedBtnSize;
            speedBtn.color = '#FFFFFF';
            speedBtn.background = speed === 1 ? '#4CAF50' : '#3A3F4B';
            speedBtn.cornerRadius = 18;
            speedBtn.thickness = 0;
            speedBtn.fontSize = isMobile ? 9 : 13;
            speedBtn.fontFamily = 'Arial';
            speedBtn.fontWeight = 'bold';
            speedBtn.zIndex = 100;

            if (isMobile) {
                speedBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                speedBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
                speedBtn.left = (4 + mBtnSize * 2 + 12 + index * (mSpeedSize + 4)) + 'px';
            } else {
                speedBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                speedBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                speedBtn.top = (112 + index * 36) + 'px';
            }

            speedBtn.onPointerUpObservable.add(() => {
                this.game.setTimeScale(speed);
                speeds.forEach(s => {
                    const btn = this.ui?.getControlByName(`speed${s}Btn`) as Button;
                    if (btn) btn.background = s === speed ? '#4CAF50' : '#3A3F4B';
                });
            });

            controlStrip.addControl(speedBtn);
        });

        // ====== ABILITY BUTTONS (bottom-left) ======
        this.createAbilityButtons(isMobile);

        // ====== UPGRADE GUIDE BUTTON (right side) ======
        this.createUpgradeGuideButton(isMobile);
    }

    private createAbilityButtons(isMobile: boolean): void {
        if (!this.ui) return;

        const btnW = isMobile ? '48px' : '55px';
        const btnH = isMobile ? '48px' : '55px';
        const btnGap = isMobile ? 54 : 61; // button width + 6px gap
        const fontSize = isMobile ? 7 : 9;
        const baseLeft = isMobile ? 8 : 10;

        const abilityConfigs = [
            { id: 'meteor', icon: '\u2604', label: 'METEOR', iconColor: '#FF6600', labelColor: '#FFB380', bg: '#B34000', border: '#FF6600', needsTargeting: true },
            { id: 'frostNova', icon: '\u2744', label: 'FROST', iconColor: '#66BBEE', labelColor: '#88CCEE', bg: '#1A4D7A', border: '#4499DD', needsTargeting: false },
            { id: 'chainLightning', icon: '\u26A1', label: 'CHAIN', iconColor: '#AAAAFF', labelColor: '#BBBBFF', bg: '#2A2A5A', border: '#7777CC', needsTargeting: true },
            { id: 'fortify', icon: '\uD83D\uDEE1', label: 'FORT', iconColor: '#FFD700', labelColor: '#FFE066', bg: '#5A4A10', border: '#CCAA00', needsTargeting: false },
            { id: 'goldRush', icon: '\uD83D\uDCB0', label: 'GOLD', iconColor: '#FFD700', labelColor: '#FFE066', bg: '#4A3A00', border: '#BB9900', needsTargeting: false },
        ];

        const buttonRefs = ['meteorButton', 'frostNovaButton', 'chainLightningButton', 'fortifyButton', 'goldRushButton'] as const;

        for (let i = 0; i < abilityConfigs.length; i++) {
            const cfg = abilityConfigs[i];
            const btn = new Rectangle(`${cfg.id}Button`);
            btn.width = btnW;
            btn.height = btnH;
            btn.cornerRadius = 10;
            btn.background = cfg.bg;
            btn.color = cfg.border;
            btn.thickness = 2;
            btn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            btn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            btn.left = `${baseLeft + i * btnGap}px`;
            btn.top = isMobile ? '-60px' : '-80px';
            btn.zIndex = 100;
            btn.isPointerBlocker = true;

            const icon = new TextBlock(`${cfg.id}Icon`, cfg.icon);
            icon.fontSize = isMobile ? 18 : 20;
            icon.color = cfg.iconColor;
            icon.top = '-6px';
            btn.addControl(icon);

            const label = new TextBlock(`${cfg.id}Label`, cfg.label);
            label.fontSize = fontSize;
            label.color = cfg.labelColor;
            label.fontFamily = 'Arial';
            label.fontWeight = 'bold';
            label.top = '12px';
            btn.addControl(label);

            const cooldown = new TextBlock(`${cfg.id}Cooldown`, '');
            cooldown.fontSize = fontSize;
            cooldown.color = '#FFFFFF';
            cooldown.fontFamily = 'Arial';
            cooldown.top = '20px';
            btn.addControl(cooldown);

            btn.onPointerClickObservable.add(() => {
                if (this.abilityManager) {
                    const ability = this.abilityManager.getAbility(cfg.id);
                    if (ability && ability.isReady) {
                        if (cfg.needsTargeting) {
                            this.abilityManager.startTargeting(cfg.id);
                        } else {
                            this.abilityManager.activate(cfg.id);
                        }
                    }
                }
            });

            this.ui.addControl(btn);
            (this as any)[buttonRefs[i]] = btn;
        }

        // ====== CHAMPION SUMMON BUTTON (below ability row) ======
        const champBtn = new Rectangle('championButton');
        const champW = isMobile ? 200 : 220;
        champBtn.width = `${champW}px`;
        champBtn.height = btnH;
        champBtn.cornerRadius = 10;
        champBtn.background = '#1A3A2A';
        champBtn.color = '#FFD700';
        champBtn.thickness = 2;
        champBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        champBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        champBtn.left = `${baseLeft}px`;
        champBtn.top = isMobile ? '-14px' : '-24px';
        champBtn.zIndex = 100;
        champBtn.isPointerBlocker = true;

        const champIcon = new TextBlock('championIcon', '\u2694');
        champIcon.fontSize = isMobile ? 16 : 18;
        champIcon.color = '#FFD700';
        champIcon.left = isMobile ? '-70px' : '-80px';
        champBtn.addControl(champIcon);

        const champLabel = new TextBlock('championLabel', 'SUMMON CHAMPION');
        champLabel.fontSize = isMobile ? 9 : 10;
        champLabel.color = '#FFD700';
        champLabel.fontFamily = 'Arial';
        champLabel.fontWeight = 'bold';
        champLabel.top = '-8px';
        champLabel.left = '10px';
        champBtn.addControl(champLabel);

        const champStatus = new TextBlock('championStatus', 'READY!');
        champStatus.fontSize = isMobile ? 8 : 9;
        champStatus.color = '#66FF66';
        champStatus.fontFamily = 'Arial';
        champStatus.top = '8px';
        champStatus.left = '10px';
        champBtn.addControl(champStatus);

        champBtn.onPointerClickObservable.add(() => {
            if (this.championManager && this.championManager.canSummon() && this.levelManager) {
                const path = this.levelManager.getCompositePath();
                this.championManager.summon(path);
            }
        });

        this.ui.addControl(champBtn);
        this.championButton = champBtn;
    }

    private updateAbilityButtons(): void {
        if (!this.abilityManager) return;

        const buttonConfigs: Array<{ id: string; btn: Rectangle | null; bg: string; activeBg?: string }> = [
            { id: 'meteor', btn: this.meteorButton, bg: '#B34000', activeBg: '#FF6600' },
            { id: 'frostNova', btn: this.frostNovaButton, bg: '#1A4D7A' },
            { id: 'chainLightning', btn: this.chainLightningButton, bg: '#2A2A5A', activeBg: '#5555AA' },
            { id: 'fortify', btn: this.fortifyButton, bg: '#5A4A10' },
            { id: 'goldRush', btn: this.goldRushButton, bg: '#4A3A00' },
        ];

        for (const cfg of buttonConfigs) {
            const ability = this.abilityManager.getAbility(cfg.id);
            if (!ability || !cfg.btn) continue;

            const cooldownText = cfg.btn.getChildByName(`${cfg.id}Cooldown`) as TextBlock;
            if (ability.isReady) {
                cfg.btn.alpha = 1.0;
                if (cooldownText) cooldownText.text = '';
                // Highlight if this ability is currently being targeted
                if (cfg.activeBg && this.abilityManager.getTargetingAbility() === cfg.id) {
                    cfg.btn.background = cfg.activeBg;
                } else {
                    cfg.btn.background = cfg.bg;
                }
                // Ready-state glow
                cfg.btn.shadowColor = cfg.btn.color;
                cfg.btn.shadowBlur = 8;
                cfg.btn.shadowOffsetY = 0;
            } else {
                cfg.btn.alpha = 0.5;
                if (cooldownText) cooldownText.text = `${Math.ceil(ability.currentCooldown)}s`;
                cfg.btn.background = '#3A3F4B';
                cfg.btn.shadowColor = 'transparent';
                cfg.btn.shadowBlur = 0;
            }
        }

        // Update champion button state
        if (this.championButton && this.championManager) {
            const statusText = this.championButton.getChildByName('championStatus') as TextBlock;
            const labelText = this.championButton.getChildByName('championLabel') as TextBlock;
            if (this.championManager.isChampionActive()) {
                this.championButton.alpha = 0.8;
                this.championButton.background = '#2A3A2A';
                this.championButton.color = '#FFD700';
                if (statusText) { statusText.text = 'CHAMPION ACTIVE'; statusText.color = '#FFD700'; }
            } else if (this.championManager.canSummon()) {
                this.championButton.alpha = 1.0;
                this.championButton.background = '#1A3A2A';
                this.championButton.color = '#FFD700';
                if (statusText) { statusText.text = 'READY!'; statusText.color = '#66FF66'; }
            } else {
                const wavesLeft = this.championManager.getWavesUntilReady();
                this.championButton.alpha = 0.5;
                this.championButton.background = '#3A3F4B';
                this.championButton.color = '#666666';
                if (statusText) { statusText.text = `${wavesLeft} waves remaining`; statusText.color = '#AAAAAA'; }
            }
        }
    }

    private createUpgradeGuideButton(isMobile: boolean): void {
        if (!this.ui) return;

        // Toggle button on the right edge
        const toggleBtn = Button.CreateSimpleButton('upgradeGuideToggle', '\uD83D\uDCD6');
        toggleBtn.width = isMobile ? '40px' : '44px';
        toggleBtn.height = isMobile ? '40px' : '44px';
        toggleBtn.fontSize = isMobile ? 18 : 20;
        toggleBtn.cornerRadius = 12;
        toggleBtn.background = '#2A2040';
        toggleBtn.color = '#C8A0FF';
        toggleBtn.thickness = 0;
        toggleBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        toggleBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        toggleBtn.left = isMobile ? '-8px' : '-10px';
        toggleBtn.top = isMobile ? '-8px' : '-10px';
        toggleBtn.shadowColor = '#000000';
        toggleBtn.shadowBlur = 6;
        toggleBtn.shadowOffsetY = 2;
        toggleBtn.zIndex = 100;
        toggleBtn.onPointerEnterObservable.add(() => { toggleBtn.background = '#3A3060'; });
        toggleBtn.onPointerOutObservable.add(() => { toggleBtn.background = '#2A2040'; });
        toggleBtn.onPointerClickObservable.add(() => {
            if (this.upgradeGuidePanel) {
                this.upgradeGuidePanel.isVisible = !this.upgradeGuidePanel.isVisible;
            }
        });
        this.ui.addControl(toggleBtn);

        // Guide panel — anchored right, vertically centered
        const panel = new Rectangle('upgradeGuidePanel');
        const panelW = isMobile ? 260 : 300;
        panel.width = `${panelW}px`;
        panel.height = isMobile ? '420px' : '500px';
        panel.cornerRadius = 14;
        panel.background = '#141820';
        panel.color = '#2A2E38';
        panel.thickness = 1;
        panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        panel.left = isMobile ? '-8px' : '-10px';
        panel.top = isMobile ? '-56px' : '-62px';
        panel.shadowColor = '#000000';
        panel.shadowBlur = 14;
        panel.shadowOffsetY = 3;
        panel.zIndex = 200;
        panel.isVisible = false;
        panel.isPointerBlocker = true;
        this.ui.addControl(panel);
        this.upgradeGuidePanel = panel;

        // Panel title
        const title = new TextBlock('guideTitle', 'UPGRADE PATHS');
        title.color = '#FFD54F';
        title.fontSize = 16;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.height = '28px';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        title.top = '12px';
        panel.addControl(title);

        // Divider
        const divider = new Rectangle('guideDivider');
        divider.width = '50px';
        divider.height = '2px';
        divider.background = '#FFD54F';
        divider.thickness = 0;
        divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        divider.top = '38px';
        panel.addControl(divider);

        // Upgrade tree guide content
        const fs = isMobile ? 11 : 12;
        const rowH = 22;
        let y = 50;

        const treeLines = [
            { text: 'MEDIEVAL TREE', color: '#8B7355', bold: true },
            { text: '  Archer \u2192 Longbow \u2192 Marksman', color: '#A0A8B8', bold: false },
            { text: '    Hawkeye \u2192 Zenith Spire', color: '#FFD54F', bold: false },
            { text: '    Volley \u2192 Arrow Maelstrom', color: '#C0A878', bold: false },
            { text: '  Archer \u2192 Repeater \u2192 Scorpion', color: '#A0A8B8', bold: false },
            { text: '    Gatling \u2192 Perpetual Engine', color: '#808890', bold: false },
            { text: '    Ballista \u2192 Kingdom Breaker', color: '#808890', bold: false },
            { text: '  Garrison \u2192 Barracks \u2192 War Hall', color: '#A0A8B8', bold: false },
            { text: '    Commander \u2192 Grand Marshal', color: '#FFD54F', bold: false },
            { text: '    Warden \u2192 Black Tower', color: '#9966CC', bold: false },
            { text: '  Garrison \u2192 Bulwark \u2192 Rampart', color: '#A0A8B8', bold: false },
            { text: '    Catapult \u2192 Doom Trebuchet', color: '#FF6633', bold: false },
            { text: '    Saboteur \u2192 Grand Architect', color: '#FFD54F', bold: false },
            { text: '', color: '', bold: false },
            { text: 'ELEMENTAL TREE', color: '#9B59B6', bold: true },
            { text: '  Pyroclast \u2192 Inferno Pyre', color: '#FF5722', bold: false },
            { text: '    Hellfire \u2192 Infernal Bastion', color: '#FF4400', bold: false },
            { text: '    Ember \u2192 Dwarven Hellforge', color: '#FF8844', bold: false },
            { text: '  Pyroclast \u2192 Storm Needle', color: '#7777FF', bold: false },
            { text: '    Tempest \u2192 Stormcaller Apex', color: '#9999FF', bold: false },
            { text: '    Plasma \u2192 Annihilation Lens', color: '#CC77FF', bold: false },
            { text: '  Cryomancer \u2192 Glacier Monolith', color: '#55AAFF', bold: false },
            { text: '    Permafrost \u2192 Absolute Zero', color: '#66CCFF', bold: false },
            { text: '    Tidal \u2192 Leviathan\'s Maw', color: '#3388CC', bold: false },
            { text: '  Cryomancer \u2192 Verdant Totem', color: '#55AA55', bold: false },
            { text: '    Thornweald \u2192 World Tree', color: '#66BB44', bold: false },
            { text: '    Shadowgrove \u2192 Void Sentinel', color: '#8844AA', bold: false },
        ];

        for (const line of treeLines) {
            if (line.text === '') { y += 8; continue; }
            const t = new TextBlock();
            t.text = line.text;
            t.color = line.color;
            t.fontSize = fs;
            t.fontWeight = line.bold ? 'bold' : 'normal';
            t.fontFamily = 'monospace';
            t.height = `${rowH}px`;
            t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            t.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            t.left = '12px';
            t.top = `${y}px`;
            panel.addControl(t);
            y += rowH;
        }

        const closeHint = new TextBlock('guideCloseHint', 'tap to close');
        closeHint.color = '#4A5060';
        closeHint.fontSize = 10;
        closeHint.fontFamily = 'Arial';
        closeHint.height = '16px';
        closeHint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        closeHint.top = '-8px';
        panel.addControl(closeHint);
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

        // Update wave display: compact "S1-3/10"
        const segmentNum = this.waveManager.getSegmentIndex() + 1;
        const segmentWave = this.waveManager.getSegmentWave();
        waveText.text = `S${segmentNum}-${segmentWave}/10`;

        // Update wave countdown timer + wave preview
        if (countdownText) {
            const timeRemaining = this.waveManager.getAutoWaveTimeRemaining();
            if (timeRemaining > 0) {
                // Show countdown with enemy composition preview
                const nextEnemies = this.waveManager.getNextWaveEnemies();
                let previewStr = '';
                if (nextEnemies) {
                    const parts = nextEnemies.map(e => {
                        const icons: Record<string, string> = {
                            basic: 'Goblin', fast: 'Wraith', tank: 'Beetle',
                            boss: 'BOSS', splitting: 'Hydra', healer: 'Shaman', shield: 'Paladin'
                        };
                        return `${e.count}x ${icons[e.type] || e.type}`;
                    });
                    previewStr = `  [${parts.join(', ')}]`;
                }
                countdownText.text = `Next: ${timeRemaining.toFixed(1)}s${previewStr}`;
                countdownText.color = '#F5A623';
            } else if (this.waveManager.isWaveInProgress()) {
                countdownText.text = 'Wave in progress';
                countdownText.color = '#E53935';
            } else if (this.waveManager.getCurrentWave() <= 1 && timeRemaining <= 0) {
                countdownText.text = '';
            } else {
                countdownText.text = '';
            }
        }

        // Update enemies remaining / difficulty
        if (enemiesText) {
            if (this.waveManager.isWaveInProgress() && this.enemyManager) {
                const remaining = this.waveManager.getRemainingEnemiesInWave();
                enemiesText.text = `Enemies: ${remaining}`;
            } else {
                const diff = this.waveManager.getDifficultyMultiplier().toFixed(1);
                enemiesText.text = `x${diff}`;
            }
        }

        // Update kill counter (number only)
        if (killText) {
            killText.text = `${this.playerStats.getTotalKills()}`;
        }

        // Update ability buttons
        this.updateAbilityButtons();
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

        // Ensure camera cannot rotate — fully detach all built-in camera controls
        const camera = this.scene.activeCamera as ArcRotateCamera;
        if (camera) {
            camera.inputs.clear();
            camera.detachControl();
        }

        const isMobile = this.isMobileDevice();

        // --- Camera drag state ---
        // Drag threshold in pixels: movement below this is a tap, above is a drag
        // Higher threshold on mobile to prevent accidental drags from taps
        const DRAG_THRESHOLD = isMobile ? 15 : 8;
        let pointerDown = false;
        let isDragging = false;
        let downX = 0;
        let downY = 0;
        let lastX = 0;
        let lastY = 0;

        // Camera clamping: rail on desktop, free pan on mobile
        const MAP_CENTER_X = 20;
        const clampTarget = (target: Vector3) => {
            if (!this.levelManager) return;
            const maxZ = this.levelManager.getMaxZ() + 5;
            if (isMobile) {
                // Free pan: allow X movement within map bounds
                target.x = Math.max(0, Math.min(40, target.x));
            } else {
                // Rail: lock X to center
                target.x = MAP_CENTER_X;
            }
            target.z = Math.max(5, Math.min(maxZ, target.z));
        };

        const canvas = this.scene.getEngine().getRenderingCanvas();

        // --- Unified pointer handling: drag to pan, tap to interact ---
        this.scene.onPointerDown = (evt) => {
            if (evt.button !== 0 || !this.scene) return;
            pointerDown = true;
            isDragging = false;
            downX = evt.clientX;
            downY = evt.clientY;
            lastX = evt.clientX;
            lastY = evt.clientY;
        };

        this.scene.onPointerMove = (evt) => {
            if (!this.scene) return;

            // Tower preview follows pointer when placing
            if (this.selectedTowerType && this.towerPreview) {
                const pickResult = this.scene.pick(
                    this.scene.pointerX,
                    this.scene.pointerY,
                    (mesh) => mesh.name.startsWith('ground_')
                );
                if (pickResult.hit && pickResult.pickedPoint) {
                    this.updateTowerPreview(pickResult.pickedPoint);
                }
            }

            // Camera drag
            if (!pointerDown) return;

            const dx = evt.clientX - downX;
            const dy = evt.clientY - downY;

            // Start dragging once past threshold
            if (!isDragging && (dx * dx + dy * dy) > DRAG_THRESHOLD * DRAG_THRESHOLD) {
                isDragging = true;
            }

            if (isDragging) {
                const camera = this.scene.activeCamera as ArcRotateCamera;
                if (!camera || !canvas) return;

                const moveX = evt.clientX - lastX;
                const moveY = evt.clientY - lastY;
                lastX = evt.clientX;
                lastY = evt.clientY;

                const orthoHeight = (camera.orthoTop ?? 1) - (camera.orthoBottom ?? -1);
                const pixelToWorld = orthoHeight / canvas.clientHeight;

                const target = camera.target.clone();

                if (isMobile) {
                    // Free pan: map screen drag to world X/Z using isometric projection
                    // Camera is at alpha=-45deg, so screen X maps to a diagonal in world space
                    const cosA = Math.cos(camera.alpha);
                    const sinA = Math.sin(camera.alpha);
                    const worldDx = moveX * pixelToWorld;
                    const worldDy = -moveY * pixelToWorld;
                    target.x += worldDx * cosA + worldDy * sinA;
                    target.z += -worldDx * sinA + worldDy * cosA;
                } else {
                    // Rail: Z-only movement
                    target.z += moveY * pixelToWorld;
                }

                clampTarget(target);
                camera.target = target;
            }
        };

        this.scene.onPointerUp = (evt) => {
            if (evt.button !== 0 || !this.scene) {
                pointerDown = false;
                isDragging = false;
                return;
            }

            const wasDrag = isDragging;
            pointerDown = false;
            isDragging = false;

            // If it was a drag, don't process as a tap
            if (wasDrag) return;

            // === TAP HANDLING (same logic as the old onPointerDown) ===

            // Handle ability targeting mode (Meteor Strike click-to-target)
            if (this.abilityManager && this.abilityManager.getIsTargeting()) {
                const abilityPick = this.scene.pick(
                    this.scene.pointerX,
                    this.scene.pointerY,
                    (mesh) => mesh.name.startsWith('ground_')
                );
                if (abilityPick.hit && abilityPick.pickedPoint) {
                    const targetAbility = this.abilityManager.getTargetingAbility();
                    if (targetAbility) {
                        this.abilityManager.activate(targetAbility, abilityPick.pickedPoint);
                    }
                } else {
                    this.abilityManager.cancelTargeting();
                }
                return;
            }

            // Check UI elements
            const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
            if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                return;
            }

            // Close tower selector if open
            if (this.selectorAnchor) {
                this.hideTowerSelector();
                this.hidePlacementOutline();
                return;
            }

            // Check if tapping on a tower
            const pickResult = this.scene.pick(
                this.scene.pointerX,
                this.scene.pointerY,
                (mesh) => !mesh.name.includes('GUI') &&
                          !mesh.name.includes('rangeIndicator') &&
                          !mesh.name.includes('rangeRing')
            );

            if (pickResult.hit && pickResult.pickedMesh) {
                const clickedTower = this.findTowerByMesh(pickResult.pickedMesh);
                if (clickedTower) {
                    if (this.selectedTower === clickedTower) return;
                    this.selectTower(clickedTower);
                    this.hidePlacementOutline();
                    this.hideTowerSelector();
                    return;
                }
            }

            // Deselect tower if tapping elsewhere
            if (this.selectedTower) {
                this.deselectTower();
            }

            // Check if tapping on buildable ground
            const groundPickResult = this.scene.pick(
                this.scene.pointerX,
                this.scene.pointerY,
                (mesh) => mesh.name.startsWith('ground_')
            );

            if (groundPickResult.hit && groundPickResult.pickedPoint) {
                const position = groundPickResult.pickedPoint;
                const clickMap = this.levelManager
                    ? this.levelManager.getMapForWorldPosition(position)
                    : this.map;
                if (clickMap) {
                    const gridPosition = clickMap.worldToGrid(position);
                    if (clickMap.canPlaceTower(gridPosition.x, gridPosition.y)) {
                        this.hidePlacementOutline();
                        this.hideTowerSelector();
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

        // Keyboard: Escape + WASD movement
        const pressedKeys = new Set<string>();

        this.scene.onKeyboardObservable.add((kbInfo) => {
            const key = kbInfo.event.key.toLowerCase();
            if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
                pressedKeys.add(key);
                if (key === 'escape' && this.selectedTowerType) {
                    this.cancelTowerPlacement();
                }
                // Speed control shortcuts: 1/2/3
                if (key === '1') {
                    this.game.setTimeScale(1);
                    [1, 2, 3].forEach(s => {
                        const btn = this.ui?.getControlByName(`speed${s}Btn`) as Rectangle;
                        if (btn) btn.background = s === 1 ? '#4CAF50' : '#3A3F4B';
                    });
                } else if (key === '2') {
                    this.game.setTimeScale(2);
                    [1, 2, 3].forEach(s => {
                        const btn = this.ui?.getControlByName(`speed${s}Btn`) as Rectangle;
                        if (btn) btn.background = s === 2 ? '#4CAF50' : '#3A3F4B';
                    });
                } else if (key === '3') {
                    this.game.setTimeScale(3);
                    [1, 2, 3].forEach(s => {
                        const btn = this.ui?.getControlByName(`speed${s}Btn`) as Rectangle;
                        if (btn) btn.background = s === 3 ? '#4CAF50' : '#3A3F4B';
                    });
                }
                // Space for pause
                if (key === ' ') {
                    this.game.togglePause();
                }
                // Cancel ability targeting with Escape
                if (key === 'escape' && this.abilityManager?.getIsTargeting()) {
                    this.abilityManager.cancelTargeting();
                }
            } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
                pressedKeys.delete(key);
            }
        });

        // WASD / arrow keys move camera along Z rail only
        this.scene.onBeforeRenderObservable.add(() => {
            const cam = this.scene?.activeCamera as ArcRotateCamera;
            if (!cam || !this.levelManager) return;

            let zMove = 0;
            const speed = 0.8;

            // W/Up = scroll toward lower Z (toward start), S/Down = toward higher Z
            if (pressedKeys.has('w') || pressedKeys.has('arrowup')) zMove = -speed;
            if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) zMove = speed;

            if (zMove !== 0) {
                const target = cam.target.clone();
                target.z += zMove;
                clampTarget(target);
                cam.target = target;
            }
        });

        // Prevent context menu & scroll wheel zoom
        if (canvas) {
            canvas.addEventListener('contextmenu', (evt) => evt.preventDefault());

            canvas.addEventListener('wheel', (evt: WheelEvent) => {
                evt.preventDefault();
                const cam = this.scene?.activeCamera as ArcRotateCamera;
                if (!cam) return;

                const currentZoom = cam.metadata?.orthoZoom ?? 25;
                const zoomDelta = evt.deltaY * 0.02;
                const newZoom = Math.max(8, Math.min(50, currentZoom + zoomDelta));

                cam.metadata = { ...cam.metadata, orthoZoom: newZoom };
                this.game.updateOrthoBounds();
            }, { passive: false });

            // Pinch-to-zoom for mobile
            let pinchStartDist = 0;
            let pinchStartZoom = 25;
            let isPinching = false;

            canvas.addEventListener('touchstart', (evt: TouchEvent) => {
                if (evt.touches.length === 2) {
                    isPinching = true;
                    // Suppress drag when pinching
                    pointerDown = false;
                    isDragging = false;
                    const dx = evt.touches[0].clientX - evt.touches[1].clientX;
                    const dy = evt.touches[0].clientY - evt.touches[1].clientY;
                    pinchStartDist = Math.sqrt(dx * dx + dy * dy);
                    const cam = this.scene?.activeCamera as ArcRotateCamera;
                    pinchStartZoom = cam?.metadata?.orthoZoom ?? 25;
                }
            }, { passive: true });

            canvas.addEventListener('touchmove', (evt: TouchEvent) => {
                if (isPinching && evt.touches.length === 2) {
                    evt.preventDefault();
                    const dx = evt.touches[0].clientX - evt.touches[1].clientX;
                    const dy = evt.touches[0].clientY - evt.touches[1].clientY;
                    const currentDist = Math.sqrt(dx * dx + dy * dy);

                    const scale = pinchStartDist / currentDist;
                    const newZoom = Math.max(8, Math.min(50, pinchStartZoom * scale));

                    const cam = this.scene?.activeCamera as ArcRotateCamera;
                    if (cam) {
                        cam.metadata = { ...cam.metadata, orthoZoom: newZoom };
                        this.game.updateOrthoBounds();
                    }
                }
            }, { passive: false });

            canvas.addEventListener('touchend', (evt: TouchEvent) => {
                if (evt.touches.length < 2) {
                    isPinching = false;
                }
            }, { passive: true });
        }
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
        if (!this.towerPreview) return;

        // Resolve which map segment this position belongs to
        const previewMap = this.levelManager
            ? this.levelManager.getMapForWorldPosition(position)
            : this.map;
        if (!previewMap) return;

        this.towerPreview.setEnabled(true);

        const gridPosition = previewMap.worldToGrid(position);

        const worldPosition = previewMap.gridToWorld(gridPosition.x, gridPosition.y);

        this.towerPreview.position = new Vector3(worldPosition.x, 1, worldPosition.z);

        if (!this.squareOutline) {
            this.createSquareOutline();
        }

        if (this.squareOutline) {
            this.squareOutline.setEnabled(true);
            this.squareOutline.position = new Vector3(worldPosition.x, 0.1, worldPosition.z);

            const canPlace = previewMap.canPlaceTower(gridPosition.x, gridPosition.y);

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
        if (!this.ui) return;

        const confirmMap = this.levelManager
            ? (this.levelManager.getMapForWorldPosition(position) || this.map)
            : this.map;
        if (!confirmMap) return;

        if (this.towerPreview) {
            const material = this.towerPreview.material as StandardMaterial;
            material.alpha = 0.3;
        }

        this.confirmationButtons.position = position.clone();

        const gridPosition = confirmMap.worldToGrid(position);
        const worldPosition = confirmMap.gridToWorld(gridPosition.x, gridPosition.y);

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
        if (!this.towerManager || !this.playerStats || !this.selectedTowerType || !this.confirmationButtons.position) {
            this.hideConfirmationButtons();
            return;
        }

        const position = this.confirmationButtons.position;
        // Resolve which map segment this placement belongs to
        const placeMap = this.levelManager
            ? (this.levelManager.getMapForWorldPosition(position) || this.map)
            : this.map;

        if (!placeMap) {
            this.hideConfirmationButtons();
            return;
        }

        const gridPosition = placeMap.worldToGrid(position);
        const worldPosition = placeMap.gridToWorld(gridPosition.x, gridPosition.y);

        const towerCost = this.getTowerCost(this.selectedTowerType);
        if (this.playerStats.getMoney() >= towerCost) {
            const placed = this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);

            // Mark grid cell as occupied
            if (placed) {
                placeMap.setTowerPlaced(gridPosition.x, gridPosition.y, true);
            }

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
        const data = getTowerDataById(type);
        if (data) return data.cost;
        const def = getTowerDefinition(type);
        return def ? def.stats.cost : 0;
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

        // Debug: log when click misses all towers
        if (towers.length > 0) {
            console.log(`[CLICK] Picked mesh "${mesh.name}", parent: "${mesh.parent?.name}". No tower matched. Tower count: ${towers.length}`);
            for (const tower of towers) {
                const tm = tower.getMesh();
                console.log(`[CLICK]   Tower mesh: "${tm?.name}", id: ${tower.getId()}, pos: (${tower.getPosition().x}, ${tower.getPosition().z})`);
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

        const isMobile = this.isMobileDevice();

        if (!this.towerInfoPanel) {
            if (isMobile) {
                this.createMobileTowerInfoPanel();
            } else {
                this.towerInfoPanel = new Rectangle('towerInfoPanel');

                // Desktop: right-side panel
                this.towerInfoPanel.width = "280px";
                this.towerInfoPanel.height = "310px";
                this.towerInfoPanel.cornerRadius = 14;
                this.towerInfoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
                this.towerInfoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                this.towerInfoPanel.top = "-100px";
                this.towerInfoPanel.left = "-10px";
                this.towerInfoPanel.color = PALETTE.UI_BORDER;
                this.towerInfoPanel.thickness = 1;
                this.towerInfoPanel.background = PALETTE.UI_PANEL_SOLID;
                this.towerInfoPanel.shadowColor = "rgba(0, 0, 0, 0.5)";
                this.towerInfoPanel.shadowBlur = 12;
                this.towerInfoPanel.shadowOffsetY = 4;
                this.ui.addControl(this.towerInfoPanel);

                // Slide-in from right (desktop)
                let slideX = 290;
                this.towerInfoPanel.left = (slideX - 10) + 'px';
                const slideObs = this.scene!.onBeforeRenderObservable.add(() => {
                    slideX *= 0.78;
                    if (slideX < 1) {
                        slideX = 0;
                        this.scene?.onBeforeRenderObservable.remove(slideObs);
                    }
                    if (this.towerInfoPanel) this.towerInfoPanel.left = (-10 + slideX) + 'px';
                });

                // ---- DESKTOP LAYOUT (original) ----
                // Tower preview image (72x72)
                const previewContainer = new Rectangle('towerInfoPreview');
                previewContainer.width = '72px';
                previewContainer.height = '72px';
                previewContainer.cornerRadius = 10;
                previewContainer.background = 'rgba(40, 44, 52, 0.8)';
                previewContainer.thickness = 1;
                previewContainer.color = 'rgba(80, 90, 110, 0.3)';
                previewContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                previewContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                previewContainer.top = '14px';
                previewContainer.left = '14px';
                this.towerInfoPanel.addControl(previewContainer);

                // Tower name
                this.towerTypeText = new TextBlock('typeValue', '-');
                this.towerTypeText.color = '#FFFFFF';
                this.towerTypeText.fontSize = 18;
                this.towerTypeText.fontFamily = 'Arial';
                this.towerTypeText.fontWeight = 'bold';
                this.towerTypeText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                this.towerTypeText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                this.towerTypeText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                this.towerTypeText.top = '16px';
                this.towerTypeText.left = '96px';
                this.towerTypeText.width = '170px';
                this.towerTypeText.resizeToFit = true;
                this.towerInfoPanel.addControl(this.towerTypeText);

                // Level text (hidden data)
                this.towerLevelText = new TextBlock('levelValue', '1');
                this.towerLevelText.color = 'transparent';
                this.towerLevelText.fontSize = 1;
                this.towerLevelText.width = '0px';
                this.towerLevelText.height = '0px';
                this.towerInfoPanel.addControl(this.towerLevelText);

                // Level dots
                const levelDotsContainer = new Rectangle('levelDots');
                levelDotsContainer.width = '80px';
                levelDotsContainer.height = '16px';
                levelDotsContainer.thickness = 0;
                levelDotsContainer.background = 'transparent';
                levelDotsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                levelDotsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                levelDotsContainer.top = '40px';
                levelDotsContainer.left = '96px';
                this.towerInfoPanel.addControl(levelDotsContainer);

                for (let i = 0; i < 3; i++) {
                    const dot = new Rectangle(`levelDot_${i}`);
                    dot.width = '12px';
                    dot.height = '12px';
                    dot.cornerRadius = 6;
                    dot.background = 'rgba(80, 90, 110, 0.4)';
                    dot.thickness = 0;
                    dot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                    dot.left = (i * 18) + 'px';
                    levelDotsContainer.addControl(dot);
                }

                const levelLabel = new TextBlock('levelLabel', 'LVL');
                levelLabel.color = '#B0B8C8';
                levelLabel.fontSize = 10;
                levelLabel.fontFamily = 'Arial';
                levelLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                levelLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                levelLabel.left = '60px';
                levelDotsContainer.addControl(levelLabel);

                // Divider
                const divider1 = new Rectangle('divider1');
                divider1.width = '90%';
                divider1.height = '1px';
                divider1.background = 'rgba(80, 90, 110, 0.3)';
                divider1.thickness = 0;
                divider1.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                divider1.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                divider1.top = '96px';
                this.towerInfoPanel.addControl(divider1);

                // Stats grid
                const statsGrid = new Grid('statsGrid');
                statsGrid.addColumnDefinition(0.5);
                statsGrid.addColumnDefinition(0.5);
                statsGrid.addRowDefinition(0.5);
                statsGrid.addRowDefinition(0.5);
                statsGrid.width = '90%';
                statsGrid.height = '90px';
                statsGrid.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                statsGrid.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                statsGrid.top = '104px';
                this.towerInfoPanel.addControl(statsGrid);

                const createStatCell = (label: string, valueId: string, row: number, col: number): TextBlock => {
                    const container = new Rectangle(`stat_${valueId}`);
                    container.thickness = 0;
                    container.background = 'transparent';
                    statsGrid.addControl(container, row, col);

                    const lbl = new TextBlock(`${valueId}_lbl`, label);
                    lbl.color = '#B0B8C8';
                    lbl.fontSize = 10;
                    lbl.fontFamily = 'Arial';
                    lbl.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                    lbl.top = '2px';
                    container.addControl(lbl);

                    const val = new TextBlock(valueId, '-');
                    val.color = '#FFFFFF';
                    val.fontSize = 16;
                    val.fontFamily = 'Arial';
                    val.fontWeight = 'bold';
                    val.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                    val.top = '-2px';
                    container.addControl(val);

                    return val;
                };

                this.towerDamageText = createStatCell('DMG', 'damageValue', 0, 0);
                this.towerRangeText = createStatCell('RNG', 'rangeValue', 0, 1);
                this.towerRateText = createStatCell('RATE', 'rateValue', 1, 0);
                createStatCell('SELL', 'sellDisplayValue', 1, 1);

                // Divider 2
                const divider2 = new Rectangle('divider2');
                divider2.width = '90%';
                divider2.height = '1px';
                divider2.background = 'rgba(80, 90, 110, 0.3)';
                divider2.thickness = 0;
                divider2.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                divider2.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                divider2.top = '202px';
                this.towerInfoPanel.addControl(divider2);

                // Sell button
                this.sellButton = new Rectangle('sellButton');
                this.sellButton.width = "115px";
                this.sellButton.height = "44px";
                this.sellButton.cornerRadius = 22;
                this.sellButton.color = 'transparent';
                this.sellButton.thickness = 0;
                this.sellButton.background = '#E53935';
                this.sellButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                this.sellButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                this.sellButton.top = "-12px";
                this.sellButton.left = "14px";
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
                    if (this.sellButton) this.sellButton.background = '#EF5350';
                });
                this.sellButton.onPointerOutObservable.add(() => {
                    if (this.sellButton) this.sellButton.background = '#E53935';
                });
                this.sellButton.onPointerDownObservable.add(() => {
                    if (this.sellButton) this.sellButton.alpha = 0.8;
                });
                this.sellButton.onPointerClickObservable.add(() => {
                    this.sellSelectedTower();
                });
                this.sellButton.onPointerUpObservable.add(() => {
                    if (this.sellButton) this.sellButton.alpha = 1.0;
                    this.sellSelectedTower();
                });
                this.towerInfoPanel.addControl(this.sellButton);

                // Upgrade button
                this.upgradeButton = new Rectangle('upgradeButton');
                this.upgradeButton.width = "115px";
                this.upgradeButton.height = "44px";
                this.upgradeButton.cornerRadius = 22;
                this.upgradeButton.color = 'transparent';
                this.upgradeButton.thickness = 0;
                this.upgradeButton.background = '#4CAF50';
                this.upgradeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
                this.upgradeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                this.upgradeButton.top = "-12px";
                this.upgradeButton.left = "-14px";
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
                    this.upgradeSelectedTower();
                });
                this.upgradeButton.onPointerUpObservable.add(() => {
                    if (this.upgradeButton && this.playerStats && this.selectedTower) {
                        if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                            this.upgradeButton.alpha = 1.0;
                        }
                    }
                });
                this.towerInfoPanel.addControl(this.upgradeButton);

                // --- Targeting mode button ---
                this.targetingButton = new Rectangle('targetingButton');
                this.targetingButton.width = '100px';
                this.targetingButton.height = '28px';
                this.targetingButton.cornerRadius = 6;
                this.targetingButton.background = '#3A3F4B';
                this.targetingButton.color = '#555';
                this.targetingButton.thickness = 1;
                this.targetingButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                this.targetingButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                this.targetingButton.top = this.isMobileDevice() ? '-8px' : '-6px';

                const targetText = new TextBlock('targetingText', 'CLOSEST');
                targetText.color = '#B0B8C8';
                targetText.fontSize = this.isMobileDevice() ? 10 : 9;
                targetText.fontFamily = 'Arial';
                targetText.fontWeight = 'bold';
                this.targetingButton.addControl(targetText);

                this.targetingButton.onPointerClickObservable.add(() => {
                    if (this.selectedTower) {
                        const newMode = this.selectedTower.cycleTargetingMode();
                        this.updateTargetingButtonText();
                    }
                });
                this.towerInfoPanel.addControl(this.targetingButton);
            }
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
     * Map tower class name to tower ID for preview lookup
     */
    private getTowerIdFromInstance(tower: Tower): string | undefined {
        return tower.getDefinitionId();
    }

    /**
     * Update the tower information display
     */
    private updateTowerInfo(): void {
        if (!this.selectedTower || !this.towerTypeText || !this.towerLevelText ||
            !this.towerDamageText || !this.towerRangeText || !this.towerRateText) {
            return;
        }

        // Look up tower data from definition system
        const towerId = this.getTowerIdFromInstance(this.selectedTower);
        const towerData = towerId ? getTowerDataById(towerId) : undefined;
        const towerType = towerData ? towerData.name : towerId || 'Unknown';

        this.towerTypeText.text = towerData ? towerData.name : towerType;
        this.towerLevelText.text = `T${this.selectedTower.getLevel()}`;
        this.towerDamageText.text = `${this.selectedTower.getDamage().toFixed(1)}`;
        this.towerRangeText.text = `${this.selectedTower.getRange().toFixed(1)}`;
        this.towerRateText.text = `${this.selectedTower.getFireRate().toFixed(1)}/s`;

        // Update tower preview image
        if (this.towerInfoPanel && towerId) {
            const previewContainer = this.towerInfoPanel.getChildByName('towerInfoPreview') as Rectangle;
            if (previewContainer) {
                // Remove previous preview image
                const existingImg = previewContainer.getChildByName('towerInfoImg');
                if (existingImg) previewContainer.removeControl(existingImg);

                const previewUrl = this.towerPreviewRenderer?.getDataUrl(towerId);
                if (previewUrl) {
                    const img = new Image('towerInfoImg', previewUrl);
                    img.width = '64px';
                    img.height = '64px';
                    previewContainer.addControl(img);
                }
            }
        }

        // Update level/tier dots (show tier progress 1-8)
        if (this.towerInfoPanel) {
            const tier = this.selectedTower.getLevel(); // tier is stored as level
            const tColor = towerData ? towerData.color : '#4CAF50';
            for (let i = 0; i < 3; i++) {
                const dot = this.towerInfoPanel.getChildByName(`levelDot_${i}`) as Rectangle;
                if (dot) {
                    // Map tier 1-8 to 3 dots: tier 1-2=1dot, 3-5=2dots, 6-8=3dots
                    const filled = tier >= (i === 0 ? 1 : i === 1 ? 3 : 6);
                    dot.background = filled ? tColor : 'rgba(80, 90, 110, 0.4)';
                }
            }
        }

        // Update sell value in stats grid
        if (this.towerInfoPanel) {
            const sellDisplay = this.towerInfoPanel.getChildByName('sellDisplayValue') as TextBlock;
            if (sellDisplay) {
                sellDisplay.text = `$${this.selectedTower.getSellValue()}`;
            }
        }

        // Update sell button value
        const sellValueEl = this.sellButton?.getChildByName('sellValueText') as TextBlock;
        if (sellValueEl) {
            sellValueEl.text = `$${this.selectedTower.getSellValue()}`;
        }

        // Update upgrade/evolve button state
        if (this.upgradeButton) {
            const upgradeTextEl = this.upgradeButton.getChildByName('upgradeText') as TextBlock;
            const upgradeCostEl = this.upgradeButton.getChildByName('upgradeCostText') as TextBlock;

            const upgradeOptions = this.selectedTower.getUpgradeOptions();
            if (upgradeOptions.length === 0) {
                // Max tier — no more upgrades
                this.upgradeButton.background = '#888888';
                this.upgradeButton.alpha = 0.8;
                this.upgradeButton.isEnabled = false;
                if (upgradeTextEl) upgradeTextEl.text = 'MAX TIER';
                if (upgradeCostEl) upgradeCostEl.text = '';
            } else if (upgradeOptions.length === 1) {
                // Linear upgrade — single path
                const cost = upgradeOptions[0].stats.cost;
                this.upgradeButton.isEnabled = true;
                if (upgradeTextEl) upgradeTextEl.text = `EVOLVE: ${upgradeOptions[0].name}`;
                if (upgradeCostEl) upgradeCostEl.text = `$${cost}`;
                if (this.playerStats) {
                    if (this.playerStats.getMoney() >= cost) {
                        this.upgradeButton.background = '#4CAF50';
                        this.upgradeButton.alpha = 1.0;
                    } else {
                        this.upgradeButton.background = '#3A3F4B';
                        this.upgradeButton.alpha = 0.6;
                    }
                }
            } else {
                // Branching — show "CHOOSE PATH" to prompt the upgrade panel
                const minCost = Math.min(...upgradeOptions.map(o => o.stats.cost));
                this.upgradeButton.isEnabled = true;
                if (upgradeTextEl) upgradeTextEl.text = 'CHOOSE PATH';
                if (upgradeCostEl) upgradeCostEl.text = `from $${minCost}`;
                if (this.playerStats) {
                    if (this.playerStats.getMoney() >= minCost) {
                        this.upgradeButton.background = '#2196F3';
                        this.upgradeButton.alpha = 1.0;
                    } else {
                        this.upgradeButton.background = '#3A3F4B';
                        this.upgradeButton.alpha = 0.6;
                    }
                }
            }
        }

        // Update targeting mode button text
        this.updateTargetingButtonText();
    }

    private updateTargetingButtonText(): void {
        if (!this.targetingButton || !this.selectedTower) return;
        const targetText = this.targetingButton.getChildByName('targetingText') as TextBlock;
        if (targetText) {
            const mode = this.selectedTower.getTargetingMode();
            const labels: Record<string, string> = {
                [TargetingMode.CLOSEST]: '\u25CE CLOSEST',
                [TargetingMode.FIRST]: '\u25B6 FIRST',
                [TargetingMode.STRONGEST]: '\u2620 STRONGEST'
            };
            targetText.text = labels[mode] || 'CLOSEST';
        }
    }

    // ========================================================================
    // SCREEN FEEDBACK EFFECTS
    // ========================================================================

    private flashDamageVignette(): void {
        if (!this.ui) return;

        // Create or reuse vignette overlay
        if (!this.damageVignette) {
            this.damageVignette = new Rectangle('damageVignette');
            this.damageVignette.width = '100%';
            this.damageVignette.height = '100%';
            this.damageVignette.thickness = 0;
            this.damageVignette.background = 'transparent';
            this.damageVignette.color = 'rgba(220, 30, 30, 0.45)';
            this.damageVignette.thickness = 30;
            this.damageVignette.isHitTestVisible = false;
            this.damageVignette.isPointerBlocker = false;
            this.damageVignette.alpha = 0;
            this.ui.addControl(this.damageVignette);
        }

        // Flash in and out over 300ms
        this.damageVignette.alpha = 1.0;
        const startTime = performance.now();
        const duration = 300;
        const fadeStep = () => {
            const elapsed = performance.now() - startTime;
            if (elapsed >= duration) {
                if (this.damageVignette) this.damageVignette.alpha = 0;
                return;
            }
            if (this.damageVignette) {
                this.damageVignette.alpha = 1.0 - (elapsed / duration);
            }
            requestAnimationFrame(fadeStep);
        };
        requestAnimationFrame(fadeStep);
    }

    private showWaveClearText(): void {
        if (!this.ui) return;

        if (this.waveClearText) {
            this.ui.removeControl(this.waveClearText);
            this.waveClearText = null;
        }

        this.waveClearText = new TextBlock('waveClearText', 'WAVE CLEARED!');
        this.waveClearText.color = '#66BB6A';
        this.waveClearText.fontSize = 36;
        this.waveClearText.fontFamily = 'Arial';
        this.waveClearText.fontWeight = 'bold';
        this.waveClearText.outlineWidth = 3;
        this.waveClearText.outlineColor = 'black';
        this.waveClearText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.waveClearText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        this.waveClearText.top = '-50px';
        this.waveClearText.isHitTestVisible = false;
        this.waveClearText.scaleX = 0.5;
        this.waveClearText.scaleY = 0.5;
        this.ui.addControl(this.waveClearText);

        // Scale-up animation then fade out
        const startTime = performance.now();
        const animStep = () => {
            const elapsed = performance.now() - startTime;
            if (!this.waveClearText) return;

            if (elapsed < 200) {
                // Scale up: 0.5 -> 1.2
                const t = elapsed / 200;
                const scale = 0.5 + t * 0.7;
                this.waveClearText.scaleX = scale;
                this.waveClearText.scaleY = scale;
            } else if (elapsed < 400) {
                // Scale settle: 1.2 -> 1.0
                const t = (elapsed - 200) / 200;
                const scale = 1.2 - t * 0.2;
                this.waveClearText.scaleX = scale;
                this.waveClearText.scaleY = scale;
            } else if (elapsed < 1500) {
                this.waveClearText.scaleX = 1;
                this.waveClearText.scaleY = 1;
            } else if (elapsed < 2000) {
                // Fade out
                this.waveClearText.alpha = 1 - (elapsed - 1500) / 500;
            } else {
                if (this.ui && this.waveClearText) {
                    this.ui.removeControl(this.waveClearText);
                    this.waveClearText = null;
                }
                return;
            }
            requestAnimationFrame(animStep);
        };
        requestAnimationFrame(animStep);
    }

    private showBossWarning(text: string, urgent: boolean): void {
        if (!this.ui) return;

        if (this.bossWarningText) {
            this.ui.removeControl(this.bossWarningText);
            this.bossWarningText = null;
        }

        this.bossWarningText = new TextBlock('bossWarningText', text);
        this.bossWarningText.color = urgent ? '#FF3333' : '#FF9800';
        this.bossWarningText.fontSize = urgent ? 32 : 26;
        this.bossWarningText.fontFamily = 'Arial';
        this.bossWarningText.fontWeight = 'bold';
        this.bossWarningText.outlineWidth = 3;
        this.bossWarningText.outlineColor = 'black';
        this.bossWarningText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.bossWarningText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        this.bossWarningText.top = '20px';
        this.bossWarningText.isHitTestVisible = false;
        this.ui.addControl(this.bossWarningText);

        // Flash and fade out over 3 seconds
        const startTime = performance.now();
        const duration = 3000;
        const animStep = () => {
            const elapsed = performance.now() - startTime;
            if (!this.bossWarningText) return;

            if (elapsed < duration - 500) {
                // Pulsing alpha
                this.bossWarningText.alpha = 0.7 + 0.3 * Math.sin(elapsed / 150);
            } else if (elapsed < duration) {
                this.bossWarningText.alpha = 1 - (elapsed - (duration - 500)) / 500;
            } else {
                if (this.ui && this.bossWarningText) {
                    this.ui.removeControl(this.bossWarningText);
                    this.bossWarningText = null;
                }
                return;
            }
            requestAnimationFrame(animStep);
        };
        requestAnimationFrame(animStep);
    }

    private hideTowerActions(): void {
        if (this.towerInfoPanel) {
            this.towerInfoPanel.isVisible = false;
        }
        if (this.isMobileDevice()) {
            if (this.bottomToolbar) this.bottomToolbar.isVisible = true;
            if (this.upgradeGuideToggle) this.upgradeGuideToggle.isVisible = true;
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

        const upgradeOptions = this.selectedTower.getUpgradeOptions();
        if (upgradeOptions.length === 0) {
            console.log("Tower is at max tier");
            return;
        }

        // If branching, pick the first option (UI should show choice panel for 2 options)
        // For now, if there are multiple options, show a simple choice — pick first by default
        let targetDef = upgradeOptions[0];
        if (upgradeOptions.length > 1) {
            // Multiple paths — try to show the upgrade choice panel
            this.showUpgradeChoicePanel(upgradeOptions);
            return;
        }

        this.performEvolution(targetDef.id);
    }

    /**
     * Show a panel letting the player choose between upgrade paths.
     */
    private showUpgradeChoicePanel(options: TowerDefinition[]): void {
        if (!this.ui || !this.selectedTower) return;

        // Create a choice overlay
        const overlay = new Rectangle('upgradeChoiceOverlay');
        overlay.width = '340px';
        overlay.height = `${80 + options.length * 90}px`;
        overlay.background = PALETTE.UI_PANEL;
        overlay.cornerRadius = 12;
        overlay.thickness = 1;
        overlay.color = PALETTE.UI_PANEL_BORDER;
        overlay.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        overlay.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        overlay.isPointerBlocker = true;
        overlay.zIndex = 200;
        this.ui.addControl(overlay);

        const title = new TextBlock('choiceTitle', 'Choose Upgrade Path');
        title.color = PALETTE.UI_TEXT_PRIMARY;
        title.fontSize = 16;
        title.fontFamily = 'monospace';
        title.fontWeight = 'bold';
        title.height = '35px';
        title.top = '10px';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        overlay.addControl(title);

        options.forEach((opt, idx) => {
            const btn = new Rectangle(`choice_${idx}`);
            btn.width = '300px';
            btn.height = '70px';
            btn.top = `${50 + idx * 80}px`;
            btn.background = PALETTE.UI_CARD_BG;
            btn.cornerRadius = 8;
            btn.thickness = 1;
            btn.color = PALETTE.UI_PANEL_BORDER;
            btn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            btn.isPointerBlocker = true;
            overlay.addControl(btn);

            const nameText = new TextBlock(`choiceName_${idx}`, opt.name);
            nameText.color = PALETTE.UI_TEXT_PRIMARY;
            nameText.fontSize = 14;
            nameText.fontFamily = 'monospace';
            nameText.fontWeight = 'bold';
            nameText.top = '-12px';
            nameText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            nameText.left = '10px';
            btn.addControl(nameText);

            const descText = new TextBlock(`choiceDesc_${idx}`, opt.ability.description);
            descText.color = PALETTE.UI_TEXT_SECONDARY;
            descText.fontSize = 11;
            descText.fontFamily = 'monospace';
            descText.top = '5px';
            descText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            descText.left = '10px';
            btn.addControl(descText);

            const costText = new TextBlock(`choiceCost_${idx}`, `$${opt.stats.cost}`);
            costText.color = PALETTE.UI_ACCENT_GOLD;
            costText.fontSize = 13;
            costText.fontFamily = 'monospace';
            costText.fontWeight = 'bold';
            costText.top = '20px';
            costText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            costText.left = '-10px';
            btn.addControl(costText);

            // Hover effect
            btn.onPointerEnterObservable.add(() => { btn.background = PALETTE.UI_CARD_HOVER; });
            btn.onPointerOutObservable.add(() => { btn.background = PALETTE.UI_CARD_BG; });

            btn.onPointerClickObservable.add(() => {
                if (this.ui) this.ui.removeControl(overlay);
                this.performEvolution(opt.id);
            });
        });

        // Cancel button
        const cancelBtn = new Rectangle('choiceCancel');
        cancelBtn.width = '300px';
        cancelBtn.height = '30px';
        cancelBtn.top = `${50 + options.length * 80}px`;
        cancelBtn.background = 'transparent';
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        cancelBtn.isPointerBlocker = true;
        overlay.addControl(cancelBtn);
        const cancelText = new TextBlock('cancelText', 'Cancel');
        cancelText.color = PALETTE.UI_TEXT_SECONDARY;
        cancelText.fontSize = 12;
        cancelText.fontFamily = 'monospace';
        cancelBtn.addControl(cancelText);
        cancelBtn.onPointerClickObservable.add(() => { if (this.ui) this.ui.removeControl(overlay); });
    }

    /**
     * Perform the actual evolution to a target tower definition.
     */
    private performEvolution(targetId: string): void {
        if (!this.selectedTower || !this.towerManager || !this.playerStats) return;

        const targetDef = getTowerDefinition(targetId);
        if (!targetDef) return;

        const cost = targetDef.stats.cost;
        if (this.playerStats.getMoney() < cost) {
            console.log(`Not enough money. Need $${cost}, have $${this.playerStats.getMoney()}`);
            this.game.getAssetManager().playSound('error');
            this.shakeButton(this.upgradeButton);
            return;
        }

        console.log(`Evolving tower to ${targetDef.name} for $${cost}...`);

        try {
            const towerPosition = this.selectedTower.getPosition();
            const selectedTowerId = this.selectedTower.getId();

            if (this.towerManager.evolveTower(this.selectedTower, targetId)) {
                this.playerStats.spendMoney(cost);
                console.log(`Spent $${cost}. New balance: $${this.playerStats.getMoney()}`);

                this.createUpgradeEffect(towerPosition);
                this.game.getAssetManager().playSound('towerUpgrade');

                // Re-select to refresh UI
                const upgradedTower = this.towerManager.getTowerById(selectedTowerId);
                if (upgradedTower) {
                    this.selectedTower = upgradedTower;
                }

                this.showTowerActions();
                console.log(`Tower evolved to ${targetDef.name} (Tier ${targetDef.tier})`);
            } else {
                console.log("Tower evolution failed");
            }
        } catch (error) {
            console.error("Error evolving tower:", error);
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
            const placed = this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);
            this.playerStats.addTowerBuilt();

            // Mark grid cell as occupied
            if (placed) {
                this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);
            }

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
        const outlineMap = this.levelManager
            ? (this.levelManager.getMapForWorldPosition(position) || this.map)
            : this.map;
        if (!outlineMap) return;

        const gridPosition = outlineMap.worldToGrid(position);
        const worldPosition = outlineMap.gridToWorld(gridPosition.x, gridPosition.y);

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
    // TOWER SELECTOR (floating cards linked to clicked tile)
    // ========================================================================

    private showTowerSelector(): void {
        if (!this.ui || !this.selectedPosition || !this.scene) return;

        const position = this.selectedPosition.clone();
        const isMobile = this.isMobileDevice();

        // Card dimensions (in GUI pixels)
        const cardW = isMobile ? 110 : 130;
        const cardH = isMobile ? 170 : 200;
        const gap = isMobile ? 14 : 20;
        const previewSize = isMobile ? 48 : 68;

        // Fullscreen transparent backdrop — catches outside clicks and blocks scene handler
        const backdrop = new Rectangle('selectorBackdrop');
        backdrop.width = '100%';
        backdrop.height = '100%';
        backdrop.background = 'transparent';
        backdrop.thickness = 0;
        backdrop.isPointerBlocker = true;
        backdrop.zIndex = 19;
        backdrop.onPointerClickObservable.add(() => {
            this.hideTowerSelector();
            this.hidePlacementOutline();
        });
        this.ui.addControl(backdrop);
        this.selectorCards.push(backdrop);

        // Create anchor TransformNode for position tracking
        this.selectorAnchor = new TransformNode('selectorAnchor', this.scene);
        this.selectorAnchor.position = position.clone();

        const playerMoney = this.playerStats ? this.playerStats.getMoney() : 0;
        const maxDmg = Math.max(...TOWER_DATA.map(t => t.damage));
        const maxRng = Math.max(...TOWER_DATA.map(t => t.range));
        const maxSpd = Math.max(...TOWER_DATA.map(t => t.fireRate));

        // Card offsets from anchor (in GUI pixels): left card negative, right card positive
        const offsets = TOWER_DATA.map((_, idx) => ({
            x: idx === 0 ? -(cardW / 2 + gap) : (cardW / 2 + gap),
            y: -(cardH / 2 + 30)
        }));

        // Create two floating cards — manually positioned (no linkWithMesh)
        const cards: Rectangle[] = [];
        TOWER_DATA.forEach((tower, idx) => {
            const card = this.createFloatingCard(tower, cardW, cardH, previewSize, isMobile, playerMoney, maxDmg, maxRng, maxSpd, position);
            card.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            card.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            this.ui!.addControl(card);
            cards.push(card);
            this.selectorCards.push(card);
        });

        // Helper: compute GUI scale factor
        const getGuiScale = (): number => {
            if (!this.ui || !this.scene) return 1;
            const engine = this.scene.getEngine();
            const cw = engine.getRenderWidth();
            const ch = engine.getRenderHeight();
            if (this.ui.idealWidth) {
                const minDim = this.ui.useSmallestIdeal ? Math.min(cw, ch) : cw;
                return this.ui.idealWidth / minDim;
            }
            return 1;
        };

        // Helper: project anchor to GUI coords and position cards
        const positionCards = () => {
            if (!this.selectorAnchor || !this.scene) return;
            const engine = this.scene.getEngine();
            const camera = this.scene.activeCamera;
            if (!camera) return;

            const screenPos = Vector3.Project(
                this.selectorAnchor.position,
                Matrix.Identity(),
                this.scene.getTransformMatrix(),
                camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
            );

            const scale = getGuiScale();
            for (let i = 0; i < cards.length; i++) {
                const guiX = screenPos.x * scale + offsets[i].x - cardW / 2;
                const guiY = screenPos.y * scale + offsets[i].y - cardH / 2;
                cards[i].left = guiX + 'px';
                cards[i].top = guiY + 'px';
            }
        };

        // Position immediately + every frame for camera tracking
        positionCards();
        this._selectorPositionObs = this.scene.onBeforeRenderObservable.add(() => positionCards());
    }

    private createFloatingCard(
        tower: TowerData, cardW: number, cardH: number, previewSize: number,
        isMobile: boolean, playerMoney: number,
        maxDmg: number, maxRng: number, maxSpd: number, position: Vector3
    ): Rectangle {
        const canAfford = playerMoney >= tower.cost;

        const card = new Rectangle(`floatCard_${tower.id}`);
        card.width = cardW + 'px';
        card.height = cardH + 'px';
        card.background = PALETTE.UI_CARD_BG;
        card.cornerRadius = 10;
        card.thickness = 1.5;
        card.color = canAfford ? tower.color : PALETTE.UI_BORDER;
        card.alpha = canAfford ? 1.0 : 0.45;
        card.isPointerBlocker = true;
        card.zIndex = 20;
        card.shadowBlur = 12;
        card.shadowColor = 'rgba(0,0,0,0.5)';

        // Color accent bar at top
        const accent = new Rectangle(`accent_${tower.id}`);
        accent.width = '100%';
        accent.height = '4px';
        accent.background = tower.color;
        accent.thickness = 0;
        accent.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        card.addControl(accent);

        // 3D Tower preview image
        const previewUrl = this.towerPreviewRenderer?.getDataUrl(tower.id);
        if (previewUrl) {
            const previewImg = new Image(`preview_${tower.id}`, previewUrl);
            previewImg.width = previewSize + 'px';
            previewImg.height = previewSize + 'px';
            previewImg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            previewImg.top = '8px';
            card.addControl(previewImg);
        } else {
            const fallback = new Rectangle(`preview_${tower.id}`);
            fallback.width = (previewSize * 0.6) + 'px';
            fallback.height = (previewSize * 0.6) + 'px';
            fallback.cornerRadius = previewSize * 0.3;
            fallback.background = tower.color;
            fallback.thickness = 0;
            fallback.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            fallback.top = (8 + previewSize * 0.2) + 'px';
            card.addControl(fallback);
        }

        // Tower name
        const nameTop = 8 + previewSize + 4;
        const nameText = new TextBlock(`name_${tower.id}`, tower.name);
        nameText.color = '#FFFFFF';
        nameText.fontSize = isMobile ? 11 : 12;
        nameText.fontFamily = 'Arial';
        nameText.fontWeight = 'bold';
        nameText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        nameText.top = nameTop + 'px';
        nameText.resizeToFit = true;
        card.addControl(nameText);

        // Cost
        const costText = new TextBlock(`cost_${tower.id}`, `$${tower.cost}`);
        costText.color = '#F5A623';
        costText.fontSize = isMobile ? 11 : 12;
        costText.fontFamily = 'Arial';
        costText.fontWeight = 'bold';
        costText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        costText.top = (nameTop + 16) + 'px';
        costText.resizeToFit = true;
        card.addControl(costText);

        // Stat bars
        const statsTop = nameTop + 32;
        const barHeight = isMobile ? 5 : 6;
        const barGap = isMobile ? 10 : 11;
        const barMaxWidth = cardW - 24;

        const createStatBar = (label: string, value: number, maxValue: number, barColor: string, yOffset: number) => {
            const lbl = new TextBlock(`${tower.id}_${label}_lbl`, label);
            lbl.color = '#888';
            lbl.fontSize = isMobile ? 7 : 8;
            lbl.fontFamily = 'Arial';
            lbl.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            lbl.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            lbl.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            lbl.top = yOffset + 'px';
            lbl.left = '8px';
            lbl.resizeToFit = true;
            card.addControl(lbl);

            const barBg = new Rectangle(`${tower.id}_${label}_bg`);
            barBg.width = barMaxWidth + 'px';
            barBg.height = barHeight + 'px';
            barBg.background = 'rgba(255,255,255,0.08)';
            barBg.cornerRadius = 3;
            barBg.thickness = 0;
            barBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            barBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            barBg.top = (yOffset + 9) + 'px';
            card.addControl(barBg);

            const fillPct = Math.min(1, value / maxValue);
            const fillWidth = Math.max(4, Math.floor(barMaxWidth * fillPct));
            const bar = new Rectangle(`${tower.id}_${label}_fill`);
            bar.width = fillWidth + 'px';
            bar.height = barHeight + 'px';
            bar.background = barColor;
            bar.cornerRadius = 3;
            bar.thickness = 0;
            bar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bar.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            bar.top = (yOffset + 9) + 'px';
            bar.left = ((cardW - barMaxWidth) / 2) + 'px';
            card.addControl(bar);
        };

        createStatBar('DMG', tower.damage, maxDmg, '#E53935', statsTop);
        createStatBar('RNG', tower.range, maxRng, '#2196F3', statsTop + barGap);
        createStatBar('SPD', tower.fireRate, maxSpd, '#4CAF50', statsTop + barGap * 2);

        // Description text
        const descText = new TextBlock(`desc_${tower.id}`, tower.description);
        descText.color = '#888';
        descText.fontSize = isMobile ? 7 : 8;
        descText.fontFamily = 'Arial';
        descText.textWrapping = true;
        descText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        descText.top = '-4px';
        descText.height = isMobile ? '22px' : '26px';
        descText.paddingLeft = '6px';
        descText.paddingRight = '6px';
        card.addControl(descText);

        // Desktop hover effects
        if (!isMobile) {
            card.onPointerEnterObservable.add(() => {
                card.thickness = 2;
                card.color = tower.color;
                card.background = PALETTE.UI_CARD_HOVER;
            });
            card.onPointerOutObservable.add(() => {
                card.thickness = 1.5;
                card.color = canAfford ? tower.color : PALETTE.UI_BORDER;
                card.background = PALETTE.UI_CARD_BG;
            });
        }

        // Click: place tower
        card.onPointerClickObservable.add(() => {
            if (!canAfford) {
                this.shakeElement(card);
                return;
            }
            this.selectedTowerType = tower.id;
            this.hideTowerSelector();
            this.hideDetailPopup();
            this.placeTowerAtPosition(position);
            this.hidePlacementOutline();
        });

        return card;
    }

    private showDetailPopup(tower: TowerData, isMobile: boolean): void {
        if (!this.ui) return;
        this.hideDetailPopup();

        this.towerDetailPopup = new Rectangle('detailPopup');
        this.towerDetailPopup.width = '200px';
        this.towerDetailPopup.height = '100px';
        this.towerDetailPopup.background = 'rgba(28, 32, 40, 0.96)';
        this.towerDetailPopup.cornerRadius = 10;
        this.towerDetailPopup.thickness = 1;
        this.towerDetailPopup.color = tower.color;
        this.towerDetailPopup.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.towerDetailPopup.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.towerDetailPopup.top = isMobile ? '-215px' : '-245px';
        this.towerDetailPopup.zIndex = 15;
        this.towerDetailPopup.isPointerBlocker = false;
        this.ui.addControl(this.towerDetailPopup);

        const detailText = new TextBlock('detailText');
        detailText.text = `${tower.name}  -  $${tower.cost}\n` +
            `DMG: ${tower.damage}  RNG: ${tower.range}  SPD: ${tower.fireRate}/s\n` +
            (tower.element !== 'none' ? `Element: ${tower.element}\n` : '') +
            `${tower.description}`;
        detailText.color = '#B0B8C8';
        detailText.fontSize = 11;
        detailText.fontFamily = 'Arial';
        detailText.textWrapping = true;
        detailText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        detailText.paddingLeft = '10px';
        detailText.paddingRight = '10px';
        detailText.paddingTop = '8px';
        this.towerDetailPopup.addControl(detailText);
    }

    private hideDetailPopup(): void {
        if (this.towerDetailPopup && this.ui) {
            this.ui.removeControl(this.towerDetailPopup);
            this.towerDetailPopup = null;
        }
    }

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

    private lightenColor(color: string, amount: number): string {
        let r = parseInt(color.substring(1, 3), 16);
        let g = parseInt(color.substring(3, 5), 16);
        let b = parseInt(color.substring(5, 7), 16);
        r = Math.min(255, r + amount);
        g = Math.min(255, g + amount);
        b = Math.min(255, b + amount);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // ========================================================================
    // CAMERA CONTROLS (preserved exactly)
    // ========================================================================

    /**
     * Hide the tower selector UI
     */
    private hideTowerSelector(): void {
        this.hideDetailPopup();
        // Remove position-update observer
        if (this._selectorPositionObs && this.scene) {
            this.scene.onBeforeRenderObservable.remove(this._selectorPositionObs);
            this._selectorPositionObs = null;
        }
        // Remove floating cards and backdrop
        for (const card of this.selectorCards) {
            if (this.ui) this.ui.removeControl(card);
        }
        this.selectorCards = [];
        // Dispose anchor TransformNode
        if (this.selectorAnchor) {
            this.selectorAnchor.dispose();
            this.selectorAnchor = null;
        }
        // Legacy panel cleanup
        if (this.towerSelectorPanel && this.ui) {
            this.ui.removeControl(this.towerSelectorPanel);
            this.towerSelectorPanel = null;
        }
    }

    // ========================================================================
    // MOBILE UI — Completely separate creation methods
    // ========================================================================

    private createMobileHUD(): void {
        if (!this.ui) return;

        const isLandscape = window.innerWidth > window.innerHeight;

        // ====== STATS BAR (full-width, top) ======
        const statsBarHeight = isLandscape ? 24 : 30;
        const statsBar = new Rectangle('statsContainer');
        statsBar.width = '100%';
        statsBar.height = statsBarHeight + 'px';
        statsBar.background = 'rgba(16,20,28,0.72)';
        statsBar.cornerRadius = 0;
        statsBar.thickness = 0;
        statsBar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        statsBar.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        statsBar.top = '0px';
        this.ui.addControl(statsBar);

        // Helper: compact stat group with small circle + label + value
        const circleSize = isLandscape ? 14 : 18;
        const labelFs = isLandscape ? 6 : 7;
        const valueFs = isLandscape ? 9 : 11;
        const createStatGroup = (
            circleColor: string, label: string, valueName: string,
            defaultValue: string, leftPos: number, groupWidth: number
        ) => {
            const group = new Rectangle(`${valueName}Group`);
            group.width = groupWidth + 'px';
            group.height = (statsBarHeight - 4) + 'px';
            group.thickness = 0;
            group.background = 'transparent';
            group.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            group.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            group.left = leftPos + 'px';
            statsBar.addControl(group);

            const circle = new Rectangle(`${valueName}Dot`);
            circle.width = circleSize + 'px';
            circle.height = circleSize + 'px';
            circle.cornerRadius = circleSize / 2;
            circle.background = circleColor;
            circle.thickness = 0;
            circle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            circle.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            circle.left = '0px';
            group.addControl(circle);

            const circleLabel = new TextBlock(`${valueName}Label`, label);
            circleLabel.color = '#FFFFFF';
            circleLabel.fontSize = labelFs;
            circleLabel.fontFamily = 'Arial';
            circleLabel.fontWeight = 'bold';
            circle.addControl(circleLabel);

            const valueText = new TextBlock(valueName);
            valueText.text = defaultValue;
            valueText.color = '#FFFFFF';
            valueText.fontSize = valueFs;
            valueText.fontFamily = 'Arial';
            valueText.fontWeight = 'bold';
            valueText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            valueText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            valueText.left = (circleSize + 3) + 'px';
            valueText.width = (groupWidth - circleSize - 4) + 'px';
            valueText.resizeToFit = true;
            group.addControl(valueText);
        };

        if (isLandscape) {
            createStatGroup('#E53935', 'HP', 'healthText', '100', 6, 50);
            createStatGroup('#F5A623', '$', 'moneyText', '200', 58, 56);
            createStatGroup('#42A5F5', 'W', 'waveText', 'S1-1/10', 116, 90);
        } else {
            createStatGroup('#E53935', 'HP', 'healthText', '100', 6, 62);
            createStatGroup('#F5A623', '$', 'moneyText', '200', 70, 68);
            createStatGroup('#42A5F5', 'W', 'waveText', 'S1-1/10', 140, 110);
        }

        // Rename health dot for updateUI compat
        const hGroup = statsBar.getChildByName('healthTextGroup') as Rectangle;
        if (hGroup) {
            const hDot = hGroup.getChildByName('healthTextDot');
            if (hDot) hDot.name = 'healthDot';
        }

        // Money text gold color
        const moneyCtrl = this.ui.getControlByName('moneyText') as TextBlock;
        if (moneyCtrl) moneyCtrl.color = '#F5A623';
        // Wave text blue color
        const waveCtrl = this.ui.getControlByName('waveText') as TextBlock;
        if (waveCtrl) waveCtrl.color = '#42A5F5';

        // Kill text (right-aligned in stats bar)
        const killText = new TextBlock('killText');
        killText.text = '0';
        killText.color = '#B0B8C8';
        killText.fontSize = isLandscape ? 8 : 9;
        killText.fontFamily = 'Arial';
        killText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        killText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        killText.left = '-6px';
        killText.width = '30px';
        statsBar.addControl(killText);

        // Fade-in
        statsBar.alpha = 0;
        let fadeIn = 0;
        const fadeObs = this.scene!.onBeforeRenderObservable.add(() => {
            fadeIn += 0.05;
            statsBar.alpha = Math.min(1, fadeIn);
            if (fadeIn >= 1) this.scene?.onBeforeRenderObservable.remove(fadeObs);
        });

        // ====== WAVE INFO BAR (full-width, below stats) ======
        const waveInfoHeight = isLandscape ? 18 : 22;
        const waveInfoBar = new Rectangle('waveInfoContainer');
        waveInfoBar.width = '100%';
        waveInfoBar.height = waveInfoHeight + 'px';
        waveInfoBar.background = 'rgba(16,20,28,0.72)';
        waveInfoBar.cornerRadius = 0;
        waveInfoBar.thickness = 0;
        waveInfoBar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        waveInfoBar.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveInfoBar.top = statsBarHeight + 'px';
        this.ui.addControl(waveInfoBar);

        const waveInfoFs = isLandscape ? 8 : 10;
        const countdownText = new TextBlock('countdownText');
        countdownText.text = '';
        countdownText.color = '#F5A623';
        countdownText.fontSize = waveInfoFs;
        countdownText.fontFamily = 'Arial';
        countdownText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        countdownText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        countdownText.left = '8px';
        waveInfoBar.addControl(countdownText);

        const enemiesText = new TextBlock('enemiesText');
        enemiesText.text = '';
        enemiesText.color = '#B0B8C8';
        enemiesText.fontSize = waveInfoFs;
        enemiesText.fontFamily = 'Arial';
        enemiesText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        enemiesText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        enemiesText.left = '-8px';
        waveInfoBar.addControl(enemiesText);

        // ====== BOTTOM TOOLBAR ======
        // Landscape: single 48px row | Portrait: two-row 132px
        const toolbarHeight = isLandscape ? 48 : 132;
        this.bottomToolbar = new Rectangle('bottomToolbar');
        this.bottomToolbar.width = '100%';
        this.bottomToolbar.height = toolbarHeight + 'px';
        this.bottomToolbar.background = 'rgba(16,20,28,0.92)';
        this.bottomToolbar.cornerRadius = 0;
        this.bottomToolbar.thickness = 0;
        this.bottomToolbar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.bottomToolbar.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.bottomToolbar.zIndex = 50;
        this.bottomToolbar.shadowColor = 'rgba(0,0,0,0.5)';
        this.bottomToolbar.shadowBlur = 12;
        this.bottomToolbar.shadowOffsetY = -4;
        this.ui.addControl(this.bottomToolbar);

        // 1px divider at top of toolbar
        const divider = new Rectangle('toolbarDivider');
        divider.width = '100%';
        divider.height = '1px';
        divider.background = 'rgba(80,90,110,0.4)';
        divider.thickness = 0;
        divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.bottomToolbar.addControl(divider);

        // ---- ACTION ROW ----
        const actionBtnSize = isLandscape ? 36 : 44;
        const actionTop = isLandscape ? 6 : 4;

        // Pause button
        const pauseButton = Button.CreateSimpleButton('pauseButton', 'II');
        pauseButton.width = actionBtnSize + 'px';
        pauseButton.height = actionBtnSize + 'px';
        pauseButton.color = '#FFFFFF';
        pauseButton.background = '#2196F3';
        pauseButton.cornerRadius = isLandscape ? 8 : 10;
        pauseButton.thickness = 0;
        pauseButton.fontFamily = 'Arial';
        pauseButton.fontSize = isLandscape ? 10 : 12;
        pauseButton.fontWeight = 'bold';
        pauseButton.zIndex = 100;
        pauseButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        pauseButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        pauseButton.left = '6px';
        pauseButton.top = actionTop + 'px';
        pauseButton.onPointerClickObservable.add(() => { this.game.togglePause(); });
        this.bottomToolbar.addControl(pauseButton);
        this.registerPauseButtonUpdate(pauseButton);

        // Wave button
        const waveButton = Button.CreateSimpleButton('waveButton', '>');
        waveButton.width = actionBtnSize + 'px';
        waveButton.height = actionBtnSize + 'px';
        waveButton.color = '#FFFFFF';
        waveButton.background = '#E53935';
        waveButton.cornerRadius = isLandscape ? 8 : 10;
        waveButton.thickness = 0;
        waveButton.fontFamily = 'Arial';
        waveButton.fontSize = isLandscape ? 12 : 14;
        waveButton.fontWeight = 'bold';
        waveButton.zIndex = 100;
        waveButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveButton.left = (6 + actionBtnSize + 4) + 'px';
        waveButton.top = actionTop + 'px';

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
                } else {
                    this.waveManager.startNextWave();
                }
            }
        });
        this.bottomToolbar.addControl(waveButton);
        this.registerWaveButtonUpdate(waveButton);

        // 1px separator
        const sepLeft = 6 + actionBtnSize * 2 + 8 + 2;
        const separator = new Rectangle('actionSeparator');
        separator.width = '1px';
        separator.height = (actionBtnSize - 8) + 'px';
        separator.background = 'rgba(80,90,110,0.4)';
        separator.thickness = 0;
        separator.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        separator.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        separator.left = sepLeft + 'px';
        separator.top = (actionTop + 4) + 'px';
        this.bottomToolbar.addControl(separator);

        // Speed buttons
        const speedBtnSize = isLandscape ? 30 : 38;
        const speedGap = isLandscape ? 34 : 42;
        const speedStartLeft = sepLeft + 6;
        const speeds = [1, 2, 3];
        speeds.forEach((speed, index) => {
            const speedBtn = Button.CreateSimpleButton(`speed${speed}Btn`, `${speed}x`);
            speedBtn.width = speedBtnSize + 'px';
            speedBtn.height = speedBtnSize + 'px';
            speedBtn.color = '#FFFFFF';
            speedBtn.background = speed === 1 ? '#4CAF50' : '#3A3F4B';
            speedBtn.cornerRadius = isLandscape ? 6 : 8;
            speedBtn.thickness = 0;
            speedBtn.fontSize = isLandscape ? 10 : 12;
            speedBtn.fontFamily = 'Arial';
            speedBtn.fontWeight = 'bold';
            speedBtn.zIndex = 100;
            speedBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            speedBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            speedBtn.left = (speedStartLeft + index * speedGap) + 'px';
            speedBtn.top = (actionTop + (actionBtnSize - speedBtnSize) / 2) + 'px';

            speedBtn.onPointerUpObservable.add(() => {
                this.game.setTimeScale(speed);
                speeds.forEach(s => {
                    const btn = this.ui?.getControlByName(`speed${s}Btn`) as Button;
                    if (btn) btn.background = s === speed ? '#4CAF50' : '#3A3F4B';
                });
            });

            this.bottomToolbar!.addControl(speedBtn);
        });

        // Champion button anchored RIGHT in action row
        const champWidth = isLandscape ? 110 : 150;
        const champHeight = isLandscape ? 36 : 44;
        const champBtn = new Rectangle('championButton');
        champBtn.width = champWidth + 'px';
        champBtn.height = champHeight + 'px';
        champBtn.cornerRadius = isLandscape ? 8 : 10;
        champBtn.background = '#1A3A2A';
        champBtn.color = '#FFD700';
        champBtn.thickness = 2;
        champBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        champBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        champBtn.left = '-6px';
        champBtn.top = actionTop + 'px';
        champBtn.zIndex = 100;
        champBtn.isPointerBlocker = true;

        const champIcon = new TextBlock('championIcon', '\u2694');
        champIcon.fontSize = isLandscape ? 12 : 14;
        champIcon.color = '#FFD700';
        champIcon.left = isLandscape ? '-34px' : '-50px';
        champBtn.addControl(champIcon);

        const champLabel = new TextBlock('championLabel', 'CHAMPION');
        champLabel.fontSize = isLandscape ? 9 : 11;
        champLabel.color = '#FFD700';
        champLabel.fontFamily = 'Arial';
        champLabel.fontWeight = 'bold';
        champLabel.top = isLandscape ? '-6px' : '-8px';
        champLabel.left = isLandscape ? '6px' : '10px';
        champBtn.addControl(champLabel);

        const champStatus = new TextBlock('championStatus', 'READY!');
        champStatus.fontSize = isLandscape ? 8 : 10;
        champStatus.color = '#66FF66';
        champStatus.fontFamily = 'Arial';
        champStatus.top = isLandscape ? '6px' : '8px';
        champStatus.left = isLandscape ? '6px' : '10px';
        champBtn.addControl(champStatus);

        champBtn.onPointerClickObservable.add(() => {
            if (this.championManager && this.championManager.canSummon() && this.levelManager) {
                const path = this.levelManager.getCompositePath();
                this.championManager.summon(path);
            }
        });

        this.bottomToolbar.addControl(champBtn);
        this.championButton = champBtn;
    }

    private createMobileAbilityButtons(): void {
        if (!this.ui || !this.bottomToolbar) return;

        const isLandscape = window.innerWidth > window.innerHeight;
        // Landscape: small 38×38 buttons in the single row, positioned after speed buttons
        // Portrait: 64×64 buttons in the bottom row of the toolbar
        const btnSize = isLandscape ? 38 : 64;
        const btnGap = isLandscape ? 42 : 70;
        // In landscape, place after speed buttons (~sepLeft + 6 + 3*34 = ~96 + 108 = ~310px from left)
        // Calculate: pause(36+4) + wave(36+4) + sep(8) + speeds(3*34) = 190
        const baseLeft = isLandscape ? 196 : 8;

        const abilityConfigs = [
            { id: 'meteor', icon: '\u2604', label: 'METEOR', iconColor: '#FF6600', labelColor: '#FFB380', bg: '#B34000', border: '#FF6600', needsTargeting: true },
            { id: 'frostNova', icon: '\u2744', label: 'FROST', iconColor: '#66BBEE', labelColor: '#88CCEE', bg: '#1A4D7A', border: '#4499DD', needsTargeting: false },
            { id: 'chainLightning', icon: '\u26A1', label: 'CHAIN', iconColor: '#AAAAFF', labelColor: '#BBBBFF', bg: '#2A2A5A', border: '#7777CC', needsTargeting: true },
            { id: 'fortify', icon: '\uD83D\uDEE1', label: 'FORT', iconColor: '#FFD700', labelColor: '#FFE066', bg: '#5A4A10', border: '#CCAA00', needsTargeting: false },
            { id: 'goldRush', icon: '\uD83D\uDCB0', label: 'GOLD', iconColor: '#FFD700', labelColor: '#FFE066', bg: '#4A3A00', border: '#BB9900', needsTargeting: false },
        ];

        const buttonRefs = ['meteorButton', 'frostNovaButton', 'chainLightningButton', 'fortifyButton', 'goldRushButton'] as const;

        for (let i = 0; i < abilityConfigs.length; i++) {
            const cfg = abilityConfigs[i];
            const btn = new Rectangle(`${cfg.id}Button`);
            btn.width = btnSize + 'px';
            btn.height = btnSize + 'px';
            btn.cornerRadius = isLandscape ? 8 : 12;
            btn.background = cfg.bg;
            btn.color = cfg.border;
            btn.thickness = 2;
            btn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            btn.verticalAlignment = isLandscape ? Control.VERTICAL_ALIGNMENT_CENTER : Control.VERTICAL_ALIGNMENT_BOTTOM;
            btn.left = `${baseLeft + i * btnGap}px`;
            btn.top = isLandscape ? '0px' : '-6px';
            btn.zIndex = 100;
            btn.isPointerBlocker = true;

            const icon = new TextBlock(`${cfg.id}Icon`, cfg.icon);
            icon.fontSize = isLandscape ? 16 : 22;
            icon.color = cfg.iconColor;
            icon.top = isLandscape ? '-4px' : '-10px';
            btn.addControl(icon);

            const label = new TextBlock(`${cfg.id}Label`, cfg.label);
            label.fontSize = isLandscape ? 6 : 8;
            label.color = cfg.labelColor;
            label.fontFamily = 'Arial';
            label.fontWeight = 'bold';
            label.top = isLandscape ? '10px' : '12px';
            btn.addControl(label);

            const cooldown = new TextBlock(`${cfg.id}Cooldown`, '');
            cooldown.fontSize = isLandscape ? 6 : 8;
            cooldown.color = '#FFFFFF';
            cooldown.fontFamily = 'Arial';
            cooldown.top = isLandscape ? '16px' : '22px';
            btn.addControl(cooldown);

            btn.onPointerClickObservable.add(() => {
                if (this.abilityManager) {
                    const ability = this.abilityManager.getAbility(cfg.id);
                    if (ability && ability.isReady) {
                        if (cfg.needsTargeting) {
                            this.abilityManager.startTargeting(cfg.id);
                        } else {
                            this.abilityManager.activate(cfg.id);
                        }
                    }
                }
            });

            this.bottomToolbar.addControl(btn);
            (this as any)[buttonRefs[i]] = btn;
        }
    }

    private createMobileUpgradeGuideButton(): void {
        if (!this.ui) return;

        // Toggle button: 44×44
        const toggleBtn = Button.CreateSimpleButton('upgradeGuideToggle', '\uD83D\uDCD6');
        toggleBtn.width = '44px';
        toggleBtn.height = '44px';
        toggleBtn.fontSize = 20;
        toggleBtn.cornerRadius = 12;
        toggleBtn.background = '#2A2040';
        toggleBtn.color = '#C8A0FF';
        toggleBtn.thickness = 0;
        toggleBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        toggleBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        toggleBtn.left = '-8px';
        const isLandscapeFG = window.innerWidth > window.innerHeight;
        toggleBtn.top = isLandscapeFG ? '-56px' : '-140px';
        toggleBtn.shadowColor = '#000000';
        toggleBtn.shadowBlur = 6;
        toggleBtn.shadowOffsetY = 2;
        toggleBtn.zIndex = 100;
        toggleBtn.onPointerEnterObservable.add(() => { toggleBtn.background = '#3A3060'; });
        toggleBtn.onPointerOutObservable.add(() => { toggleBtn.background = '#2A2040'; });
        toggleBtn.onPointerClickObservable.add(() => {
            if (this.upgradeGuidePanel) {
                this.upgradeGuidePanel.isVisible = !this.upgradeGuidePanel.isVisible;
            }
        });
        this.ui.addControl(toggleBtn);
        this.upgradeGuideToggle = toggleBtn;

        // Guide panel: 260px wide, 420px tall
        const panel = new Rectangle('upgradeGuidePanel');
        panel.width = '260px';
        panel.height = '420px';
        panel.cornerRadius = 14;
        panel.background = '#141820';
        panel.color = '#2A2E38';
        panel.thickness = 1;
        panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        panel.left = '-8px';
        panel.top = isLandscapeFG ? '-100px' : '-184px';
        panel.shadowColor = '#000000';
        panel.shadowBlur = 14;
        panel.shadowOffsetY = 3;
        panel.zIndex = 200;
        panel.isVisible = false;
        panel.isPointerBlocker = true;
        this.ui.addControl(panel);
        this.upgradeGuidePanel = panel;

        // Panel content — upgrade tree paths, sized for 260px panel
        const title = new TextBlock('guideTitle', 'UPGRADE PATHS');
        title.color = '#FFD54F';
        title.fontSize = 16;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.height = '28px';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        title.top = '12px';
        panel.addControl(title);

        const divider = new Rectangle('guideDivider');
        divider.width = '50px';
        divider.height = '2px';
        divider.background = '#FFD54F';
        divider.thickness = 0;
        divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        divider.top = '38px';
        panel.addControl(divider);

        const fs = 11;
        const rowH = 20;
        let y = 50;

        const treeLines = [
            { text: 'MEDIEVAL TREE', color: '#8B7355', bold: true },
            { text: '  Archer \u2192 Longbow \u2192 Marksman', color: '#A0A8B8', bold: false },
            { text: '    Hawkeye \u2192 Zenith Spire', color: '#FFD54F', bold: false },
            { text: '    Volley \u2192 Arrow Maelstrom', color: '#C0A878', bold: false },
            { text: '  Archer \u2192 Repeater \u2192 Scorpion', color: '#A0A8B8', bold: false },
            { text: '    Gatling \u2192 Perpetual Engine', color: '#808890', bold: false },
            { text: '    Ballista \u2192 Kingdom Breaker', color: '#808890', bold: false },
            { text: '  Garrison \u2192 Barracks \u2192 War Hall', color: '#A0A8B8', bold: false },
            { text: '    Commander \u2192 Grand Marshal', color: '#FFD54F', bold: false },
            { text: '    Warden \u2192 Black Tower', color: '#9966CC', bold: false },
            { text: '  Garrison \u2192 Bulwark \u2192 Rampart', color: '#A0A8B8', bold: false },
            { text: '    Catapult \u2192 Doom Trebuchet', color: '#FF6633', bold: false },
            { text: '    Saboteur \u2192 Grand Architect', color: '#FFD54F', bold: false },
            { text: '', color: '', bold: false },
            { text: 'ELEMENTAL TREE', color: '#9B59B6', bold: true },
            { text: '  Pyroclast \u2192 Inferno Pyre', color: '#FF5722', bold: false },
            { text: '    Hellfire \u2192 Infernal Bastion', color: '#FF4400', bold: false },
            { text: '    Ember \u2192 Dwarven Hellforge', color: '#FF8844', bold: false },
            { text: '  Pyroclast \u2192 Storm Needle', color: '#7777FF', bold: false },
            { text: '    Tempest \u2192 Stormcaller Apex', color: '#9999FF', bold: false },
            { text: '    Plasma \u2192 Annihilation Lens', color: '#CC77FF', bold: false },
            { text: '  Cryomancer \u2192 Glacier Monolith', color: '#55AAFF', bold: false },
            { text: '    Permafrost \u2192 Absolute Zero', color: '#66CCFF', bold: false },
            { text: '    Tidal \u2192 Leviathan\'s Maw', color: '#3388CC', bold: false },
            { text: '  Cryomancer \u2192 Verdant Totem', color: '#55AA55', bold: false },
            { text: '    Thornweald \u2192 World Tree', color: '#66BB44', bold: false },
            { text: '    Shadowgrove \u2192 Void Sentinel', color: '#8844AA', bold: false },
        ];

        for (const line of treeLines) {
            if (line.text === '') { y += 6; continue; }
            const t = new TextBlock();
            t.text = line.text;
            t.color = line.color;
            t.fontSize = fs;
            t.fontWeight = line.bold ? 'bold' : 'normal';
            t.fontFamily = 'monospace';
            t.height = `${rowH}px`;
            t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            t.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            t.left = '10px';
            t.top = `${y}px`;
            panel.addControl(t);
            y += rowH;
        }

        const closeHint = new TextBlock('guideCloseHint', 'tap book to close');
        closeHint.color = '#4A5060';
        closeHint.fontSize = 10;
        closeHint.fontFamily = 'Arial';
        closeHint.height = '16px';
        closeHint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        closeHint.top = '-8px';
        panel.addControl(closeHint);
    }

    private createMobileTowerInfoPanel(): void {
        if (!this.ui) return;

        // Hide bottom toolbar and upgrade guide when tower info is shown
        if (this.bottomToolbar) this.bottomToolbar.isVisible = false;
        if (this.upgradeGuideToggle) this.upgradeGuideToggle.isVisible = false;
        if (this.upgradeGuidePanel) this.upgradeGuidePanel.isVisible = false;

        // Panel: 100% width, bottom-anchored
        const isLandscapeTI = window.innerWidth > window.innerHeight;
        const towerInfoHeight = isLandscapeTI ? 85 : 165;
        this.towerInfoPanel = new Rectangle('towerInfoPanel');
        this.towerInfoPanel.width = '100%';
        this.towerInfoPanel.height = towerInfoHeight + 'px';
        this.towerInfoPanel.cornerRadius = 0;
        this.towerInfoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.towerInfoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.towerInfoPanel.top = '0px';
        this.towerInfoPanel.left = '0px';
        this.towerInfoPanel.color = PALETTE.UI_BORDER;
        this.towerInfoPanel.thickness = 1;
        this.towerInfoPanel.background = PALETTE.UI_PANEL_SOLID;
        this.towerInfoPanel.shadowColor = 'rgba(0, 0, 0, 0.5)';
        this.towerInfoPanel.shadowBlur = 12;
        this.towerInfoPanel.shadowOffsetY = 4;
        this.ui.addControl(this.towerInfoPanel);

        // Slide-in from bottom
        let slideY = towerInfoHeight;
        this.towerInfoPanel.top = slideY + 'px';
        const slideObs = this.scene!.onBeforeRenderObservable.add(() => {
            slideY *= 0.78;
            if (slideY < 1) {
                slideY = 0;
                this.scene?.onBeforeRenderObservable.remove(slideObs);
            }
            if (this.towerInfoPanel) this.towerInfoPanel.top = slideY + 'px';
        });

        // Left section: Preview + Name + Level dots + Stats
        const leftSection = new Rectangle('mobileLeftSection');
        leftSection.width = '50%';
        leftSection.height = '100%';
        leftSection.thickness = 0;
        leftSection.background = 'transparent';
        leftSection.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.towerInfoPanel.addControl(leftSection);

        // Tower preview
        const prevSz = isLandscapeTI ? 28 : 52;
        const previewContainer = new Rectangle('towerInfoPreview');
        previewContainer.width = prevSz + 'px';
        previewContainer.height = prevSz + 'px';
        previewContainer.cornerRadius = 8;
        previewContainer.background = 'rgba(40, 44, 52, 0.8)';
        previewContainer.thickness = 1;
        previewContainer.color = 'rgba(80, 90, 110, 0.3)';
        previewContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        previewContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        previewContainer.top = '6px';
        previewContainer.left = '8px';
        leftSection.addControl(previewContainer);

        // Tower name
        const nameLeft = (prevSz + 14) + 'px';
        this.towerTypeText = new TextBlock('typeValue', '-');
        this.towerTypeText.color = '#FFFFFF';
        this.towerTypeText.fontSize = isLandscapeTI ? 12 : 14;
        this.towerTypeText.fontFamily = 'Arial';
        this.towerTypeText.fontWeight = 'bold';
        this.towerTypeText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.towerTypeText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.towerTypeText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.towerTypeText.top = '8px';
        this.towerTypeText.left = nameLeft;
        this.towerTypeText.width = '100px';
        this.towerTypeText.resizeToFit = true;
        leftSection.addControl(this.towerTypeText);

        // Level text (hidden data)
        this.towerLevelText = new TextBlock('levelValue', '1');
        this.towerLevelText.color = 'transparent';
        this.towerLevelText.fontSize = 1;
        this.towerLevelText.width = '0px';
        this.towerLevelText.height = '0px';
        leftSection.addControl(this.towerLevelText);

        // Level dots
        const levelDotsContainer = new Rectangle('levelDots');
        levelDotsContainer.width = '70px';
        levelDotsContainer.height = '12px';
        levelDotsContainer.thickness = 0;
        levelDotsContainer.background = 'transparent';
        levelDotsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        levelDotsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        levelDotsContainer.top = isLandscapeTI ? '24px' : '30px';
        levelDotsContainer.left = nameLeft;
        leftSection.addControl(levelDotsContainer);

        for (let i = 0; i < 3; i++) {
            const dot = new Rectangle(`levelDot_${i}`);
            dot.width = '8px';
            dot.height = '8px';
            dot.cornerRadius = 4;
            dot.background = 'rgba(80, 90, 110, 0.4)';
            dot.thickness = 0;
            dot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            dot.left = (i * 12) + 'px';
            levelDotsContainer.addControl(dot);
        }

        const levelLabel = new TextBlock('levelLabel', 'LVL');
        levelLabel.color = '#B0B8C8';
        levelLabel.fontSize = 7;
        levelLabel.fontFamily = 'Arial';
        levelLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        levelLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        levelLabel.left = '40px';
        levelDotsContainer.addControl(levelLabel);

        // Stats row: DMG, RNG, RATE, SELL
        const statsGrid = new Grid('statsGrid');
        statsGrid.addColumnDefinition(0.25);
        statsGrid.addColumnDefinition(0.25);
        statsGrid.addColumnDefinition(0.25);
        statsGrid.addColumnDefinition(0.25);
        statsGrid.addRowDefinition(1.0);
        statsGrid.width = '95%';
        statsGrid.height = isLandscapeTI ? '26px' : '50px';
        statsGrid.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsGrid.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        statsGrid.top = '-4px';
        statsGrid.left = '4px';
        leftSection.addControl(statsGrid);

        const statLabelFs = isLandscapeTI ? 7 : 9;
        const statValFs = isLandscapeTI ? 11 : 13;
        const createStatCell = (label: string, valueId: string, row: number, col: number): TextBlock => {
            const container = new Rectangle(`stat_${valueId}`);
            container.thickness = 0;
            container.background = 'transparent';
            statsGrid.addControl(container, row, col);

            const lbl = new TextBlock(`${valueId}_lbl`, label);
            lbl.color = '#B0B8C8';
            lbl.fontSize = statLabelFs;
            lbl.fontFamily = 'Arial';
            lbl.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            lbl.top = '2px';
            container.addControl(lbl);

            const val = new TextBlock(valueId, '-');
            val.color = '#FFFFFF';
            val.fontSize = statValFs;
            val.fontFamily = 'Arial';
            val.fontWeight = 'bold';
            val.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            val.top = '-2px';
            container.addControl(val);

            return val;
        };

        this.towerDamageText = createStatCell('DMG', 'damageValue', 0, 0);
        this.towerRangeText = createStatCell('RNG', 'rangeValue', 0, 1);
        this.towerRateText = createStatCell('RATE', 'rateValue', 0, 2);
        createStatCell('SELL', 'sellDisplayValue', 0, 3);

        // Right section: Buttons + Close
        const rightSection = new Rectangle('mobileRightSection');
        rightSection.width = '50%';
        rightSection.height = '100%';
        rightSection.thickness = 0;
        rightSection.background = 'transparent';
        rightSection.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.towerInfoPanel.addControl(rightSection);

        // Upgrade button
        const actionBtnH = isLandscapeTI ? 26 : 44;
        this.upgradeButton = new Rectangle('upgradeButton');
        this.upgradeButton.width = '92%';
        this.upgradeButton.height = actionBtnH + 'px';
        this.upgradeButton.cornerRadius = isLandscapeTI ? 8 : 12;
        this.upgradeButton.color = 'transparent';
        this.upgradeButton.thickness = 0;
        this.upgradeButton.background = '#4CAF50';
        this.upgradeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.upgradeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.upgradeButton.top = '6px';
        this.upgradeButton.isPointerBlocker = true;
        this.upgradeButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        this.upgradeButton.shadowBlur = 5;
        this.upgradeButton.shadowOffsetY = 2;

        const upgradeText = new TextBlock('upgradeText', 'UPGRADE');
        upgradeText.color = '#FFFFFF';
        upgradeText.fontSize = isLandscapeTI ? 11 : 13;
        upgradeText.fontFamily = 'Arial';
        upgradeText.fontWeight = 'bold';
        upgradeText.top = isLandscapeTI ? '-4px' : '-6px';
        this.upgradeButton.addControl(upgradeText);

        const upgradeCostText = new TextBlock('upgradeCostText', '');
        upgradeCostText.color = '#B0B8C8';
        upgradeCostText.fontSize = isLandscapeTI ? 9 : 11;
        upgradeCostText.fontFamily = 'Arial';
        upgradeCostText.top = isLandscapeTI ? '6px' : '8px';
        this.upgradeButton.addControl(upgradeCostText);

        this.upgradeButton.onPointerDownObservable.add(() => {
            if (this.upgradeButton && this.playerStats && this.selectedTower &&
                this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                this.upgradeButton.alpha = 0.8;
            }
        });
        this.upgradeButton.onPointerClickObservable.add(() => {
            this.upgradeSelectedTower();
        });
        this.upgradeButton.onPointerUpObservable.add(() => {
            if (this.upgradeButton && this.playerStats && this.selectedTower) {
                if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.alpha = 1.0;
                }
            }
        });
        rightSection.addControl(this.upgradeButton);

        // Sell button
        this.sellButton = new Rectangle('sellButton');
        this.sellButton.width = '92%';
        this.sellButton.height = actionBtnH + 'px';
        this.sellButton.cornerRadius = isLandscapeTI ? 8 : 12;
        this.sellButton.color = 'transparent';
        this.sellButton.thickness = 0;
        this.sellButton.background = '#E53935';
        this.sellButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.sellButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.sellButton.top = (6 + actionBtnH + 4) + 'px';
        this.sellButton.isPointerBlocker = true;
        this.sellButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        this.sellButton.shadowBlur = 5;
        this.sellButton.shadowOffsetY = 2;

        const sellText = new TextBlock('sellText', 'SELL');
        sellText.color = '#FFFFFF';
        sellText.fontSize = isLandscapeTI ? 11 : 13;
        sellText.fontFamily = 'Arial';
        sellText.fontWeight = 'bold';
        sellText.top = isLandscapeTI ? '-4px' : '-6px';
        this.sellButton.addControl(sellText);

        const sellValueText = new TextBlock('sellValueText', '');
        sellValueText.color = '#B0B8C8';
        sellValueText.fontSize = isLandscapeTI ? 9 : 11;
        sellValueText.fontFamily = 'Arial';
        sellValueText.top = isLandscapeTI ? '6px' : '8px';
        this.sellButton.addControl(sellValueText);

        this.sellButton.onPointerDownObservable.add(() => {
            if (this.sellButton) this.sellButton.alpha = 0.8;
        });
        this.sellButton.onPointerClickObservable.add(() => {
            this.sellSelectedTower();
        });
        this.sellButton.onPointerUpObservable.add(() => {
            if (this.sellButton) this.sellButton.alpha = 1.0;
            this.sellSelectedTower();
        });
        rightSection.addControl(this.sellButton);

        // Close button
        const infCloseSz = isLandscapeTI ? 24 : 44;
        const closeBtn = new Rectangle('towerInfoClose');
        closeBtn.width = infCloseSz + 'px';
        closeBtn.height = infCloseSz + 'px';
        closeBtn.cornerRadius = infCloseSz / 2;
        closeBtn.background = 'rgba(60, 65, 75, 0.8)';
        closeBtn.thickness = 0;
        closeBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        closeBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        closeBtn.top = '-4px';
        closeBtn.left = '-6px';
        closeBtn.isPointerBlocker = true;
        rightSection.addControl(closeBtn);

        const closeTxt = new TextBlock('towerInfoCloseTxt', '\u2715');
        closeTxt.color = '#B0B8C8';
        closeTxt.fontSize = isLandscapeTI ? 13 : 16;
        closeTxt.fontFamily = 'Arial';
        closeBtn.addControl(closeTxt);

        closeBtn.onPointerClickObservable.add(() => {
            this.deselectTower();
        });

        // Targeting mode button
        const targetH = isLandscapeTI ? 20 : 36;
        this.targetingButton = new Rectangle('targetingButton');
        this.targetingButton.width = isLandscapeTI ? '80px' : '100px';
        this.targetingButton.height = targetH + 'px';
        this.targetingButton.cornerRadius = 6;
        this.targetingButton.background = '#3A3F4B';
        this.targetingButton.color = '#555';
        this.targetingButton.thickness = 1;
        this.targetingButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.targetingButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.targetingButton.top = '-4px';

        const targetText = new TextBlock('targetingText', 'CLOSEST');
        targetText.color = '#B0B8C8';
        targetText.fontSize = isLandscapeTI ? 8 : 10;
        targetText.fontFamily = 'Arial';
        targetText.fontWeight = 'bold';
        this.targetingButton.addControl(targetText);

        this.targetingButton.onPointerClickObservable.add(() => {
            if (this.selectedTower) {
                this.selectedTower.cycleTargetingMode();
                this.updateTargetingButtonText();
            }
        });
        this.towerInfoPanel.addControl(this.targetingButton);
    }



    /**
     * Detect if the current device is a mobile device
     */
    private isMobileDevice(): boolean {
        return ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
               window.innerWidth < 1024;
    }
}
