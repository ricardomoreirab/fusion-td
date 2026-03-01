import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ArcRotateCamera, ParticleSystem, Texture, Mesh, HemisphericLight, Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle, StackPanel } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { PALETTE, FONTS, UI } from '../rendering/StyleConstants';
import { createLowPolyMaterial, makeFlatShaded } from '../rendering/LowPolyMaterial';

export class MenuState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private sceneObjects: Mesh[] = [];
    private particleSystems: ParticleSystem[] = [];
    private animationCallback: (() => void) | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering menu state');
        this.createBackground();
        this.createUI();
        this.game.getAssetManager().playSound('bgMusic');
    }

    public exit(): void {
        console.log('Exiting menu state');

        if (this.animationCallback) {
            this.game.getScene().unregisterBeforeRender(this.animationCallback);
            this.animationCallback = null;
        }

        for (const ps of this.particleSystems) {
            ps.stop();
            ps.dispose();
        }
        this.particleSystems = [];

        for (const mesh of this.sceneObjects) {
            mesh.dispose();
        }
        this.sceneObjects = [];

        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
    }

    public update(deltaTime: number): void {
        // Background animation is handled via registerBeforeRender
    }

    private createBackground(): void {
        const scene = this.game.getScene();

        const camera = scene.activeCamera as ArcRotateCamera;
        if (camera) {
            camera.target = new Vector3(10, 0, 10);
            camera.alpha = Math.PI / 4;
            camera.metadata = { ...camera.metadata, orthoZoom: 15 };
            this.game.updateOrthoBounds();
        }

        // Ground plane
        const ground = MeshBuilder.CreateGround('menuGround', { width: 40, height: 40 }, scene);
        const groundMat = createLowPolyMaterial('menuGroundMat', PALETTE.GROUND, scene);
        ground.material = groundMat;
        ground.position = new Vector3(10, -0.1, 10);
        ground.receiveShadows = true;
        this.sceneObjects.push(ground);

        // Central tower (hero piece) - more detailed
        const towerBase = MeshBuilder.CreateCylinder('menuTowerBase', {
            height: 0.8, diameterTop: 2.0, diameterBottom: 2.4, tessellation: 8
        }, scene);
        towerBase.position = new Vector3(10, 0.4, 10);
        towerBase.material = createLowPolyMaterial('menuTowerBaseMat', new Color3(0.60, 0.56, 0.50), scene);
        makeFlatShaded(towerBase);
        this.sceneObjects.push(towerBase);

        const towerBody = MeshBuilder.CreateCylinder('menuTowerBody', {
            height: 3.0, diameterTop: 1.0, diameterBottom: 1.6, tessellation: 8
        }, scene);
        towerBody.position = new Vector3(10, 2.3, 10);
        const towerBodyMat = createLowPolyMaterial('menuTowerBodyMat', new Color3(0.72, 0.68, 0.62), scene);
        towerBodyMat.emissiveColor = new Color3(0.05, 0.05, 0.04);
        towerBody.material = towerBodyMat;
        makeFlatShaded(towerBody);
        this.sceneObjects.push(towerBody);

        // Tower battlements
        const towerTop = MeshBuilder.CreateCylinder('menuTowerTop', {
            height: 0.6, diameterTop: 1.4, diameterBottom: 1.0, tessellation: 8
        }, scene);
        towerTop.position = new Vector3(10, 4.1, 10);
        const topMat = createLowPolyMaterial('menuTowerTopMat', new Color3(0.55, 0.30, 0.15), scene);
        topMat.emissiveColor = new Color3(0.1, 0.04, 0);
        towerTop.material = topMat;
        makeFlatShaded(towerTop);
        this.sceneObjects.push(towerTop);

        // Banner on tower
        const banner = MeshBuilder.CreatePlane('menuBanner', { width: 0.6, height: 0.8 }, scene);
        banner.position = new Vector3(10.5, 4.0, 10);
        banner.rotation.y = Math.PI / 4;
        const bannerMat = createLowPolyMaterial('menuBannerMat', new Color3(0.85, 0.68, 0.18), scene);
        bannerMat.emissiveColor = new Color3(0.2, 0.15, 0.03);
        bannerMat.backFaceCulling = false;
        banner.material = bannerMat;
        this.sceneObjects.push(banner);

        // Decorative smaller towers flanking
        const createSmallTower = (pos: Vector3, color: Color3, idx: number) => {
            const base = MeshBuilder.CreateCylinder(`smallTower${idx}`, {
                height: 1.8, diameterTop: 0.6, diameterBottom: 0.9, tessellation: 6
            }, scene);
            base.position = pos;
            const mat = createLowPolyMaterial(`smallTowerMat${idx}`, color, scene);
            mat.emissiveColor = color.scale(0.1);
            base.material = mat;
            makeFlatShaded(base);
            this.sceneObjects.push(base);

            const roof = MeshBuilder.CreateCylinder(`smallTowerRoof${idx}`, {
                height: 0.6, diameterTop: 0.1, diameterBottom: 0.8, tessellation: 6
            }, scene);
            roof.position = new Vector3(pos.x, pos.y + 1.2, pos.z);
            const roofMat = createLowPolyMaterial(`smallTowerRoofMat${idx}`, new Color3(0.55, 0.30, 0.15), scene);
            roofMat.emissiveColor = new Color3(0.08, 0.03, 0);
            roof.material = roofMat;
            makeFlatShaded(roof);
            this.sceneObjects.push(roof);
        };

        createSmallTower(new Vector3(6, 0.9, 8), new Color3(0.90, 0.35, 0.12), 0);
        createSmallTower(new Vector3(14, 0.9, 8), new Color3(0.20, 0.55, 0.90), 1);
        createSmallTower(new Vector3(6, 0.9, 12), new Color3(0.60, 0.88, 0.65), 2);
        createSmallTower(new Vector3(14, 0.9, 12), new Color3(0.58, 0.48, 0.32), 3);

        // Path segments for visual interest
        const createPathSegment = (from: Vector3, to: Vector3, idx: number) => {
            const mid = from.add(to).scale(0.5);
            const length = Vector3.Distance(from, to);
            const path = MeshBuilder.CreateBox(`menuPath${idx}`, {
                width: 1.5, height: 0.05, depth: length
            }, scene);
            path.position = new Vector3(mid.x, 0.01, mid.z);
            const angle = Math.atan2(to.x - from.x, to.z - from.z);
            path.rotation.y = angle;
            path.material = createLowPolyMaterial(`menuPathMat${idx}`, PALETTE.PATH, scene);
            this.sceneObjects.push(path);
        };

        createPathSegment(new Vector3(2, 0, 10), new Vector3(8, 0, 10), 0);
        createPathSegment(new Vector3(12, 0, 10), new Vector3(18, 0, 10), 1);

        // Enemies walking along paths
        const enemyColors = [
            new Color3(0.45, 0.58, 0.28),  // Goblin
            new Color3(0.25, 0.72, 0.78),  // Wraith
            new Color3(0.35, 0.32, 0.38),  // Beetle
            new Color3(0.35, 0.10, 0.42),  // Titan
        ];

        const enemies: { mesh: Mesh, angle: number, speed: number, radius: number }[] = [];

        for (let i = 0; i < 8; i++) {
            const colorIdx = i % enemyColors.length;
            const size = colorIdx === 2 ? 0.7 : (colorIdx === 3 ? 0.9 : (colorIdx === 1 ? 0.4 : 0.5));
            const enemy = MeshBuilder.CreateIcoSphere(`menuEnemy${i}`, {
                radius: size / 2, subdivisions: 1
            }, scene);
            const enemyMat = createLowPolyMaterial(`menuEnemyMat${i}`, enemyColors[colorIdx], scene);
            enemyMat.emissiveColor = enemyColors[colorIdx].scale(0.15);
            enemy.material = enemyMat;
            makeFlatShaded(enemy);

            const radius = 5.5 + Math.random() * 4;
            const startAngle = (i / 8) * Math.PI * 2;
            enemy.position = new Vector3(
                10 + Math.cos(startAngle) * radius,
                size / 2 + 0.1,
                10 + Math.sin(startAngle) * radius
            );

            this.sceneObjects.push(enemy);
            enemies.push({
                mesh: enemy,
                angle: startAngle,
                speed: 0.12 + Math.random() * 0.12,
                radius: radius
            });
        }

        // Decorative trees
        const treePositions = [
            new Vector3(3, 0, 4), new Vector3(17, 0, 4),
            new Vector3(3, 0, 16), new Vector3(17, 0, 16),
            new Vector3(1, 0, 10), new Vector3(19, 0, 10),
        ];

        treePositions.forEach((pos, i) => {
            const trunk = MeshBuilder.CreateCylinder(`menuTreeTrunk${i}`, {
                height: 1.2, diameterTop: 0.15, diameterBottom: 0.25, tessellation: 5
            }, scene);
            trunk.position = new Vector3(pos.x, 0.6, pos.z);
            trunk.material = createLowPolyMaterial(`menuTreeTrunkMat${i}`, PALETTE.TREE_TRUNK, scene);
            makeFlatShaded(trunk);
            this.sceneObjects.push(trunk);

            const foliage = MeshBuilder.CreateIcoSphere(`menuTreeFoliage${i}`, {
                radius: 0.8 + Math.random() * 0.3, subdivisions: 1
            }, scene);
            foliage.position = new Vector3(pos.x, 1.6 + Math.random() * 0.3, pos.z);
            const foliageMat = createLowPolyMaterial(`menuTreeFoliageMat${i}`, PALETTE.TREE_FOLIAGE, scene);
            foliageMat.emissiveColor = PALETTE.TREE_FOLIAGE.scale(0.05);
            foliage.material = foliageMat;
            makeFlatShaded(foliage);
            this.sceneObjects.push(foliage);
        });

        // Tower glow particles
        const towerParticles = new ParticleSystem('menuTowerParticles', 40, scene);
        towerParticles.particleTexture = new Texture('assets/textures/particle.png', scene);
        towerParticles.emitter = new Vector3(10, 4.4, 10);
        towerParticles.minEmitBox = new Vector3(-0.4, 0, -0.4);
        towerParticles.maxEmitBox = new Vector3(0.4, 0.3, 0.4);
        towerParticles.color1 = new Color4(1, 0.85, 0.3, 1);
        towerParticles.color2 = new Color4(1, 0.5, 0.1, 0.8);
        towerParticles.colorDead = new Color4(0.8, 0.2, 0, 0);
        towerParticles.minSize = 0.04;
        towerParticles.maxSize = 0.12;
        towerParticles.minLifeTime = 0.6;
        towerParticles.maxLifeTime = 1.8;
        towerParticles.emitRate = 20;
        towerParticles.direction1 = new Vector3(-0.3, 1.5, -0.3);
        towerParticles.direction2 = new Vector3(0.3, 2.5, 0.3);
        towerParticles.minEmitPower = 0.2;
        towerParticles.maxEmitPower = 0.6;
        towerParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        towerParticles.start();
        this.particleSystems.push(towerParticles);

        // Ambient floating particles (fireflies/motes)
        const ambientParticles = new ParticleSystem('menuAmbient', 30, scene);
        ambientParticles.particleTexture = new Texture('assets/textures/particle.png', scene);
        ambientParticles.emitter = new Vector3(10, 0.5, 10);
        ambientParticles.minEmitBox = new Vector3(-15, 0, -15);
        ambientParticles.maxEmitBox = new Vector3(15, 0, 15);
        ambientParticles.color1 = new Color4(0.4, 0.85, 0.35, 0.6);
        ambientParticles.color2 = new Color4(0.3, 0.7, 0.25, 0.4);
        ambientParticles.colorDead = new Color4(0.1, 0.3, 0.05, 0);
        ambientParticles.minSize = 0.04;
        ambientParticles.maxSize = 0.09;
        ambientParticles.minLifeTime = 3;
        ambientParticles.maxLifeTime = 6;
        ambientParticles.emitRate = 8;
        ambientParticles.direction1 = new Vector3(-0.1, 0.8, -0.1);
        ambientParticles.direction2 = new Vector3(0.1, 1.2, 0.1);
        ambientParticles.minEmitPower = 0.05;
        ambientParticles.maxEmitPower = 0.2;
        ambientParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ambientParticles.start();
        this.particleSystems.push(ambientParticles);

        // Elemental tower sparks
        const elementColors = [
            { pos: new Vector3(6, 2.2, 8), c1: new Color4(1, 0.4, 0.1, 0.9), c2: new Color4(1, 0.2, 0, 0.6) },
            { pos: new Vector3(14, 2.2, 8), c1: new Color4(0.3, 0.6, 1, 0.9), c2: new Color4(0.1, 0.4, 0.9, 0.6) },
            { pos: new Vector3(6, 2.2, 12), c1: new Color4(0.5, 1, 0.5, 0.9), c2: new Color4(0.3, 0.8, 0.3, 0.6) },
            { pos: new Vector3(14, 2.2, 12), c1: new Color4(0.7, 0.5, 0.2, 0.9), c2: new Color4(0.5, 0.4, 0.15, 0.6) },
        ];

        elementColors.forEach((elem, i) => {
            const ps = new ParticleSystem(`menuElemParticle${i}`, 12, scene);
            ps.particleTexture = new Texture('assets/textures/particle.png', scene);
            ps.emitter = elem.pos;
            ps.minEmitBox = new Vector3(-0.2, 0, -0.2);
            ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
            ps.color1 = elem.c1;
            ps.color2 = elem.c2;
            ps.colorDead = new Color4(0, 0, 0, 0);
            ps.minSize = 0.03;
            ps.maxSize = 0.08;
            ps.minLifeTime = 0.4;
            ps.maxLifeTime = 1.0;
            ps.emitRate = 6;
            ps.direction1 = new Vector3(-0.2, 1, -0.2);
            ps.direction2 = new Vector3(0.2, 1.8, 0.2);
            ps.minEmitPower = 0.15;
            ps.maxEmitPower = 0.4;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.start();
            this.particleSystems.push(ps);
        });

        // Animate: slow camera rotation and enemy movement
        let time = 0;
        this.animationCallback = () => {
            time += 0.016;

            if (camera) {
                camera.alpha += 0.0008;
            }

            for (const enemy of enemies) {
                enemy.angle += enemy.speed * 0.016;
                enemy.mesh.position.x = 10 + Math.cos(enemy.angle) * enemy.radius;
                enemy.mesh.position.z = 10 + Math.sin(enemy.angle) * enemy.radius;
                enemy.mesh.position.y = (enemy.mesh.getBoundingInfo().boundingBox.extendSize.y) + 0.1 + Math.sin(enemy.angle * 3) * 0.12;
                // Slight rotation
                enemy.mesh.rotation.y = enemy.angle + Math.PI;
            }

            // Banner wave
            if (banner) {
                banner.rotation.z = Math.sin(time * 2) * 0.1;
            }
        };
        scene.registerBeforeRender(this.animationCallback);
    }

    private createUI(): void {
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('menuUI', true, this.game.getScene());

        // Gradient overlay at top for title readability
        const topGradient = new Rectangle('topGradient');
        topGradient.width = '100%';
        topGradient.height = '55%';
        topGradient.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        topGradient.background = 'rgba(13, 17, 23, 0.5)';
        topGradient.thickness = 0;
        this.ui.addControl(topGradient);

        // Title container
        const titleContainer = new Rectangle('titleContainer');
        titleContainer.width = '500px';
        titleContainer.height = '160px';
        titleContainer.thickness = 0;
        titleContainer.background = 'transparent';
        titleContainer.top = '-160px';
        this.ui.addControl(titleContainer);

        // Main title: "FUSION TD"
        const titleText = new TextBlock('titleText');
        titleText.text = 'FUSION TD';
        titleText.color = '#FFD54F';
        titleText.fontSize = 80;
        titleText.fontFamily = FONTS.TITLE;
        titleText.fontWeight = '900';
        titleText.shadowColor = 'rgba(245, 166, 35, 0.35)';
        titleText.shadowBlur = 20;
        titleText.shadowOffsetX = 0;
        titleText.shadowOffsetY = 4;
        titleText.outlineWidth = 3;
        titleText.outlineColor = '#B8860B';
        titleText.top = '-20px';
        titleContainer.addControl(titleText);

        // Subtitle
        const subtitleText = new TextBlock('subtitleText');
        subtitleText.text = 'T O W E R   D E F E N S E';
        subtitleText.color = PALETTE.UI_TEXT_SECONDARY;
        subtitleText.fontSize = 16;
        subtitleText.fontFamily = FONTS.UI;
        subtitleText.fontWeight = '600';
        subtitleText.top = '42px';
        titleContainer.addControl(subtitleText);

        // Decorative line under title
        const titleLine = new Rectangle('titleLine');
        titleLine.width = '200px';
        titleLine.height = '2px';
        titleLine.background = 'rgba(245, 166, 35, 0.4)';
        titleLine.thickness = 0;
        titleLine.top = '62px';
        titleContainer.addControl(titleLine);

        // Button container
        const buttonContainer = new Rectangle('buttonContainer');
        buttonContainer.width = '320px';
        buttonContainer.height = '180px';
        buttonContainer.thickness = 0;
        buttonContainer.background = 'transparent';
        buttonContainer.top = '40px';
        this.ui.addControl(buttonContainer);

        // START GAME button
        this.createMenuButton(
            buttonContainer,
            'startButton',
            'START GAME',
            PALETTE.UI_BUTTON_PRIMARY,
            PALETTE.UI_BUTTON_PRIMARY_HOVER,
            UI.SHADOW_GLOW_GREEN,
            '-28px',
            () => { this.game.getStateManager().changeState('gameplay'); }
        );

        // HOW TO PLAY button
        this.createMenuButton(
            buttonContainer,
            'instructionsButton',
            'HOW TO PLAY',
            PALETTE.UI_BUTTON_SECONDARY,
            PALETTE.UI_BUTTON_SECONDARY_HOVER,
            UI.SHADOW_GLOW_BLUE,
            '52px',
            () => { this.showInstructions(); }
        );

        // Version / credit text at bottom
        const versionText = new TextBlock('versionText');
        versionText.text = 'v1.0';
        versionText.color = PALETTE.UI_TEXT_TERTIARY;
        versionText.fontSize = 11;
        versionText.fontFamily = FONTS.UI;
        versionText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        versionText.top = '-12px';
        this.ui.addControl(versionText);
    }

    private createMenuButton(
        parent: Rectangle,
        name: string,
        label: string,
        bgColor: string,
        hoverColor: string,
        glowColor: string,
        top: string,
        onClick: () => void
    ): void {
        const btn = Button.CreateSimpleButton(name, label);
        btn.width = '300px';
        btn.height = '58px';
        btn.color = '#FFFFFF';
        btn.background = bgColor;
        btn.cornerRadius = UI.RADIUS_LG;
        btn.thickness = 0;
        btn.fontFamily = FONTS.UI;
        btn.fontSize = 18;
        btn.fontWeight = '700';
        btn.top = top;
        btn.shadowColor = glowColor;
        btn.shadowBlur = 16;
        btn.shadowOffsetY = 4;

        btn.onPointerEnterObservable.add(() => {
            btn.background = hoverColor;
            btn.scaleX = 1.03;
            btn.scaleY = 1.03;
            btn.shadowBlur = 24;
        });
        btn.onPointerOutObservable.add(() => {
            btn.background = bgColor;
            btn.scaleX = 1.0;
            btn.scaleY = 1.0;
            btn.shadowBlur = 16;
        });
        btn.onPointerUpObservable.add(onClick);

        parent.addControl(btn);
    }

    private showInstructions(): void {
        if (!this.ui) return;

        // Overlay
        const overlay = new Rectangle('instructOverlay');
        overlay.width = '100%';
        overlay.height = '100%';
        overlay.background = 'rgba(0, 0, 0, 0.7)';
        overlay.thickness = 0;
        overlay.isPointerBlocker = true;
        this.ui.addControl(overlay);

        // Panel
        const panel = new Rectangle('instructPanel');
        panel.width = '560px';
        panel.height = '440px';
        panel.cornerRadius = UI.RADIUS_LG;
        panel.background = PALETTE.UI_PANEL_SOLID;
        panel.thickness = 1;
        panel.color = PALETTE.UI_PANEL_BORDER;
        panel.shadowColor = UI.SHADOW_LG;
        panel.shadowBlur = UI.BLUR_XL;
        panel.shadowOffsetY = 8;
        overlay.addControl(panel);

        // Title
        const titleText = new TextBlock('instructionsTitle');
        titleText.text = 'HOW TO PLAY';
        titleText.color = PALETTE.UI_ACCENT_GOLD;
        titleText.fontSize = 28;
        titleText.fontWeight = '700';
        titleText.fontFamily = FONTS.TITLE;
        titleText.top = '-175px';
        panel.addControl(titleText);

        // Decorative line
        const line = new Rectangle('instructLine');
        line.width = '120px';
        line.height = '2px';
        line.background = PALETTE.UI_ACCENT_GOLD_DIM;
        line.thickness = 0;
        line.top = '-148px';
        panel.addControl(line);

        // Instructions content
        const instructions = [
            { icon: '1', text: 'Tap an empty tile to place towers and defend your base' },
            { icon: '2', text: 'Enemies follow the path from start to your base' },
            { icon: '3', text: 'Each enemy that passes reduces your health' },
            { icon: '4', text: 'Destroy enemies to earn gold for more towers' },
            { icon: '5', text: 'Upgrade towers to increase damage, range, and fire rate' },
            { icon: '6', text: 'Combine elemental towers for powerful hybrid fusions!' },
        ];

        instructions.forEach((item, i) => {
            const row = new Rectangle(`instructRow${i}`);
            row.width = '460px';
            row.height = '36px';
            row.thickness = 0;
            row.background = 'transparent';
            row.top = (-110 + i * 42) + 'px';
            panel.addControl(row);

            // Number badge
            const badge = new Rectangle(`instructBadge${i}`);
            badge.width = '26px';
            badge.height = '26px';
            badge.cornerRadius = 13;
            badge.background = PALETTE.UI_ACCENT_GOLD_DIM;
            badge.thickness = 0;
            badge.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            badge.left = '0px';
            row.addControl(badge);

            const badgeText = new TextBlock(`instructBadgeText${i}`);
            badgeText.text = item.icon;
            badgeText.color = PALETTE.UI_TEXT_PRIMARY;
            badgeText.fontSize = 13;
            badgeText.fontFamily = FONTS.UI;
            badgeText.fontWeight = '700';
            badge.addControl(badgeText);

            // Instruction text
            const text = new TextBlock(`instructText${i}`);
            text.text = item.text;
            text.color = PALETTE.UI_TEXT_SECONDARY;
            text.fontSize = 14;
            text.fontFamily = FONTS.UI;
            text.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            text.left = '38px';
            text.width = '420px';
            row.addControl(text);
        });

        // Close button
        const closeButton = Button.CreateSimpleButton('closeButton', 'GOT IT');
        closeButton.width = '180px';
        closeButton.height = '48px';
        closeButton.color = '#FFFFFF';
        closeButton.background = PALETTE.UI_BUTTON_PRIMARY;
        closeButton.cornerRadius = UI.RADIUS_LG;
        closeButton.thickness = 0;
        closeButton.fontFamily = FONTS.UI;
        closeButton.fontSize = 16;
        closeButton.fontWeight = '700';
        closeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        closeButton.top = '-20px';
        closeButton.shadowColor = UI.SHADOW_GLOW_GREEN;
        closeButton.shadowBlur = 12;
        closeButton.shadowOffsetY = 3;

        closeButton.onPointerEnterObservable.add(() => {
            closeButton.background = PALETTE.UI_BUTTON_PRIMARY_HOVER;
            closeButton.scaleX = 1.03;
            closeButton.scaleY = 1.03;
        });
        closeButton.onPointerOutObservable.add(() => {
            closeButton.background = PALETTE.UI_BUTTON_PRIMARY;
            closeButton.scaleX = 1.0;
            closeButton.scaleY = 1.0;
        });
        closeButton.onPointerUpObservable.add(() => {
            this.ui?.removeControl(overlay);
        });
        panel.addControl(closeButton);
    }
}
