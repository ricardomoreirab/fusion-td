import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { Game } from '../Game';
import { PowerSlot } from '../gameplay/PowerSlotManager';
import { AbilityManager } from '../gameplay/AbilityManager';
import { getLayoutMode } from './responsive';
import { makePill, makeFrame, addPressFeedback, flashControl, pulseScale, tryHaptic, STYLE } from './HudStyle';

// ─── Element glyph map ─────────────────────────────────────────────────────────
// These are unicode characters that render reliably in most browsers via Canvas2D.
const ELEMENT_GLYPH: Record<string, string> = {
    fire:     '🔥',   // orange flame
    ice:      '◆',   // cyan diamond
    arcane:   '◉',   // purple ring/bullseye
    physical: '➤',   // white arrow (piercing) / use ✦ for blades
    storm:    '⚡',   // yellow lightning bolt
};

// Per-power override (whirling blades gets a different physical glyph)
const POWER_GLYPH: Record<string, string> = {
    fireball:        '🔥',
    frost_shards:    '◆',
    arcane_nova:     '◉',
    piercing_arrow:  '➤',
    whirling_blades: '✦',
    lightning_chain: '⚡',
};

const ELEMENT_COLOR: Record<string, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

export class HeroHud {
    private ui: AdvancedDynamicTexture;
    private game: Game | null = null;
    private hpFill!: Rectangle;
    private hpDangerZone!: Rectangle;
    private hpText!: TextBlock;
    private goldText!: TextBlock;
    private waveText!: TextBlock;
    private pauseButtonIcon: TextBlock | null = null;
    private prevPaused: boolean | null = null;
    private slotContainers: {
        bg: Rectangle;
        icon: TextBlock;
        level: TextBlock;
        cdMask: Rectangle;
    }[] = [];
    private abilityManager: AbilityManager | null = null;
    private ultimateContainers: { bg: Rectangle; label: TextBlock; cdMask: Rectangle }[] = [];
    private lowHpVignette!: Rectangle;
    private lowHpPulseTime: number = 0;

    // Diff-based feedback tracking
    private prevHp: number = -1;
    private prevGold: number = -1;
    private prevWaveInProgress: boolean = false;
    private hpBg: Rectangle | null = null;
    private goldPillBg: Rectangle | null = null;
    private wavePillBg: Rectangle | null = null;

    // Fire-pulse animation tracking
    private slotPulseTime: number[] = [0, 0, 0, 0];
    private slotPulseActive: boolean[] = [false, false, false, false];
    private prevCooldownRemaining: number[] = [-1, -1, -1, -1];

    // Cached danger-HP rgb components to skip redundant GUI prop-sets
    private _lastDangerHpR: number = -1;
    private _lastDangerHpG: number = -1;

    // Controls that need to be rebuilt on resize (includes TextBlock etc via Control base)
    private builtControls: Control[] = [];
    private resizeObserver: (() => void) | null = null;

    // Track layout for rebuild
    private isMobile: boolean = false;

    constructor(ui: AdvancedDynamicTexture, abilityManager?: AbilityManager, game?: Game) {
        this.ui = ui;
        this.abilityManager = abilityManager ?? null;
        this.game = game ?? null;
        this.build();

        // Register resize listener
        const engine = this.ui.getScene()?.getEngine();
        if (engine) {
            const handler = () => {
                this.rebuild();
            };
            engine.onResizeObservable.add(handler);
            this.resizeObserver = () => engine.onResizeObservable.removeCallback(handler);
        }
    }

    private build(): void {
        this.isMobile = getLayoutMode(this.ui) === 'mobile';
        this.slotContainers = [];
        this.ultimateContainers = [];
        this.builtControls = [];

        // Low-HP danger pulse vignette — full screen red overlay, hidden by default
        this.lowHpVignette = new Rectangle('lowHpVignette');
        this.lowHpVignette.width = '100%';
        this.lowHpVignette.height = '100%';
        this.lowHpVignette.thickness = 0;
        this.lowHpVignette.background = '#ff0000';
        this.lowHpVignette.alpha = 0;
        this.lowHpVignette.isPointerBlocker = false;
        this.ui.addControl(this.lowHpVignette);

        if (this.isMobile) {
            this._buildMobile();
        } else {
            this._buildDesktop();
        }
    }

    /** Dispose layout controls and rebuild with current viewport size. */
    private rebuild(): void {
        // Dispose all layout controls
        if (this.lowHpVignette) {
            this.lowHpVignette.dispose();
        }
        for (const ctrl of this.builtControls) {
            ctrl.dispose();
        }
        this.prevHp = -1;
        this.prevGold = -1;
        this.prevWaveInProgress = false;
        this.hpBg = null;
        this.goldPillBg = null;
        this.wavePillBg = null;
        this.pauseButtonIcon = null;
        this.prevPaused = null;
        this.build();
    }

    // ─── Desktop layout (original) ─────────────────────────────────────────────

    private _buildDesktop(): void {
        // ── HP bar — top-left pill ─────────────────────────────────────────
        const hpW = 260;
        const hpH = 25;
        const hpBg = new Rectangle('hpBg');
        hpBg.width = `${hpW}px`;
        hpBg.height = `${hpH}px`;
        hpBg.thickness = STYLE.borderThickness;
        hpBg.color = '#c0c0d0';
        hpBg.background = STYLE.panelBg;
        hpBg.cornerRadius = STYLE.pillRadius;
        hpBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        hpBg.left = '10px';
        hpBg.top = '10px';
        this.ui.addControl(hpBg);
        this.builtControls.push(hpBg);
        this.hpBg = hpBg;

        this.hpFill = new Rectangle('hpFill');
        this.hpFill.width = 1.0;
        this.hpFill.height = 1.0;
        this.hpFill.thickness = 0;
        this.hpFill.background = '#c33';
        this.hpFill.cornerRadius = STYLE.pillRadius;
        this.hpFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.addControl(this.hpFill);

        // Danger-zone marker at 25%
        this.hpDangerZone = new Rectangle('hpDangerZone');
        this.hpDangerZone.width = '2px';
        this.hpDangerZone.height = '100%';
        this.hpDangerZone.thickness = 0;
        this.hpDangerZone.background = '#ffe040';
        this.hpDangerZone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hpDangerZone.left = `${Math.round(hpW * 0.25) - 1}px`;
        hpBg.addControl(this.hpDangerZone);

        this.hpText = new TextBlock('hpText', '');
        this.hpText.color = '#fff';
        this.hpText.fontSize = 13;
        this.hpText.fontStyle = 'bold';
        this.hpText.fontFamily = 'Arial';
        this.hpText.shadowColor = STYLE.textShadowColor;
        this.hpText.shadowBlur = STYLE.textShadowBlur;
        hpBg.addControl(this.hpText);

        // ── Wave pill — top-center ─────────────────────────────────────────
        const wavePill = makePill({
            name: 'wave',
            color: '#ffe040',
            initialText: '',
            fontSize: 13,
            height: 25,
            widthPx: 220,
            textColor: '#ffe040',
        });
        wavePill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        wavePill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        wavePill.bg.top = '10px';
        this.ui.addControl(wavePill.bg);
        this.builtControls.push(wavePill.bg);
        this.waveText = wavePill.text;
        this.wavePillBg = wavePill.bg;

        // ── Gold pill — top-right ──────────────────────────────────────────
        const goldPill = makePill({
            name: 'gold',
            color: '#ffd700',
            initialText: '◯ 0',
            fontSize: 13,
            height: 25,
            widthPx: 110,
            textColor: '#ffd700',
        });
        goldPill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        goldPill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        goldPill.bg.top = '10px';
        goldPill.bg.left = '-10px';
        this.ui.addControl(goldPill.bg);
        this.builtControls.push(goldPill.bg);
        this.goldText = goldPill.text;
        this.goldPillBg = goldPill.bg;

        // ── Pause/play button — top row, left of gold pill ────────────────
        this._buildPauseButton({ sizePx: 25, rightOffset: 10 + 110 + 8 });

        // ── 4 power-slot icons — bottom-center row ────────────────────────
        const slotSize = 56;
        const slotGap = 8;
        const slotRowWidth = slotSize * 4 + slotGap * 3;

        const slotRow = new Rectangle('slotRow');
        slotRow.width = `${slotRowWidth}px`;
        slotRow.height = `${slotSize}px`;
        slotRow.thickness = 0;
        slotRow.background = '';
        slotRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        slotRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        slotRow.top = '-10px';
        this.ui.addControl(slotRow);
        this.builtControls.push(slotRow);

        for (let i = 0; i < 4; i++) {
            const bg = makeFrame({
                name: `slotBg_${i}`,
                sizePx: slotSize,
                color: STYLE.panelBorderEmpty,
                isEmpty: true,
            });
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.left = `${i * (slotSize + slotGap)}px`;
            slotRow.addControl(bg);

            const icon = new TextBlock(`slotIcon_${i}`, '+');
            icon.color = '#666';
            icon.fontSize = 26;
            icon.fontFamily = 'Arial';
            icon.shadowColor = STYLE.textShadowColor;
            icon.shadowBlur = STYLE.textShadowBlur;
            bg.addControl(icon);

            const level = new TextBlock(`slotLvl_${i}`, '');
            level.color = '#fff';
            level.fontSize = 11;
            level.fontStyle = 'bold';
            level.fontFamily = 'Arial';
            level.shadowColor = STYLE.textShadowColor;
            level.shadowBlur = STYLE.textShadowBlur;
            level.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            level.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            level.paddingRight = '4px';
            level.paddingBottom = '2px';
            bg.addControl(level);

            const cdMask = new Rectangle(`slotCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0, 0, 0, 0.55)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = STYLE.frameRadius;
            cdMask.isPointerBlocker = false;
            bg.addControl(cdMask);

            this.slotContainers.push({ bg, icon, level, cdMask });
        }

        // ── Ultimate ability buttons ──────────────────────────────────────
        this._buildUltimateButtons({
            btnSize: 60,
            fontSize: 24,
            gap: 8,
            bottomOffset: 10,
            rightOffset: 10,
        });
    }

    // ─── Mobile layout ─────────────────────────────────────────────────────────
    //
    // HP bar:   top-center, 80% vw capped at 320px
    // Gold:     top-right corner
    // Slots:    bottom-left, 40×40, starting after the joystick zone (~120px)
    // Ultimates: bottom-right, 44×44

    private _buildMobile(): void {
        // ── HP bar — top-left pill ─────────────────────────────────────────
        const hpW = 140;
        const hpH = 28;
        const hpBg = new Rectangle('hpBg');
        hpBg.width = `${hpW}px`;
        hpBg.height = `${hpH}px`;
        hpBg.thickness = STYLE.borderThickness;
        hpBg.color = '#c0c0d0';
        hpBg.background = STYLE.panelBg;
        hpBg.cornerRadius = STYLE.pillRadius;
        hpBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        hpBg.left = '10px';
        hpBg.top = '10px';
        this.ui.addControl(hpBg);
        this.builtControls.push(hpBg);
        this.hpBg = hpBg;

        this.hpFill = new Rectangle('hpFill');
        this.hpFill.width = 1.0;
        this.hpFill.height = 1.0;
        this.hpFill.thickness = 0;
        this.hpFill.background = '#c33';
        this.hpFill.cornerRadius = STYLE.pillRadius;
        this.hpFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.addControl(this.hpFill);

        this.hpDangerZone = new Rectangle('hpDangerZone');
        this.hpDangerZone.width = '2px';
        this.hpDangerZone.height = '100%';
        this.hpDangerZone.thickness = 0;
        this.hpDangerZone.background = '#ffe040';
        this.hpDangerZone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hpDangerZone.left = `${Math.round(hpW * 0.25) - 1}px`;
        hpBg.addControl(this.hpDangerZone);

        this.hpText = new TextBlock('hpText', '');
        this.hpText.color = '#fff';
        this.hpText.fontSize = 10;
        this.hpText.fontStyle = 'bold';
        this.hpText.fontFamily = 'Arial';
        this.hpText.shadowColor = STYLE.textShadowColor;
        this.hpText.shadowBlur = STYLE.textShadowBlur;
        hpBg.addControl(this.hpText);

        // ── Wave pill — top-center ─────────────────────────────────────────
        const wavePill = makePill({
            name: 'wave',
            color: '#ffe040',
            initialText: '',
            fontSize: 11,
            height: 28,
            widthPx: 170,
            textColor: '#ffe040',
        });
        wavePill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        wavePill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        wavePill.bg.top = '10px';
        this.ui.addControl(wavePill.bg);
        this.builtControls.push(wavePill.bg);
        this.waveText = wavePill.text;
        this.wavePillBg = wavePill.bg;

        // ── Gold pill — top-right ──────────────────────────────────────────
        const goldPill = makePill({
            name: 'gold',
            color: '#ffd700',
            initialText: '◯ 0',
            fontSize: 11,
            height: 28,
            widthPx: 90,
            textColor: '#ffd700',
        });
        goldPill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        goldPill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        goldPill.bg.top = '10px';
        goldPill.bg.left = '-10px';
        this.ui.addControl(goldPill.bg);
        this.builtControls.push(goldPill.bg);
        this.goldText = goldPill.text;
        this.goldPillBg = goldPill.bg;

        // ── Pause/play button — top row, left of gold pill ────────────────
        this._buildPauseButton({ sizePx: 28, rightOffset: 10 + 90 + 8 });

        // ── 4 power-slot icons — bottom-center row ────────────────────────
        const slotSize = 42;
        const slotGap = 8;
        const slotRowWidth = slotSize * 4 + slotGap * 3;

        const slotRow = new Rectangle('slotRow');
        slotRow.width = `${slotRowWidth}px`;
        slotRow.height = `${slotSize}px`;
        slotRow.thickness = 0;
        slotRow.background = '';
        slotRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        slotRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        slotRow.top = '-10px';
        this.ui.addControl(slotRow);
        this.builtControls.push(slotRow);

        for (let i = 0; i < 4; i++) {
            const bg = makeFrame({
                name: `slotBg_${i}`,
                sizePx: slotSize,
                color: STYLE.panelBorderEmpty,
                isEmpty: true,
            });
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.left = `${i * (slotSize + slotGap)}px`;
            slotRow.addControl(bg);

            const icon = new TextBlock(`slotIcon_${i}`, '+');
            icon.color = '#666';
            icon.fontSize = 20;
            icon.fontFamily = 'Arial';
            icon.shadowColor = STYLE.textShadowColor;
            icon.shadowBlur = STYLE.textShadowBlur;
            bg.addControl(icon);

            const level = new TextBlock(`slotLvl_${i}`, '');
            level.color = '#fff';
            level.fontSize = 9;
            level.fontStyle = 'bold';
            level.fontFamily = 'Arial';
            level.shadowColor = STYLE.textShadowColor;
            level.shadowBlur = STYLE.textShadowBlur;
            level.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            level.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            level.paddingRight = '3px';
            level.paddingBottom = '2px';
            bg.addControl(level);

            const cdMask = new Rectangle(`slotCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0, 0, 0, 0.55)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = STYLE.frameRadius;
            cdMask.isPointerBlocker = false;
            bg.addControl(cdMask);

            this.slotContainers.push({ bg, icon, level, cdMask });
        }

        // ── Ultimate ability buttons — bottom-right ───────────────────────
        this._buildUltimateButtons({
            btnSize: 46,
            fontSize: 18,
            gap: 8,
            bottomOffset: 10,
            rightOffset: 10,
        });
    }

    // ─── Ultimate button display metadata ─────────────────────────────────────
    // Glyph, border color, and tooltip label for each known ability id.
    private static readonly ULT_DISPLAY: Record<string, { glyph: string; color: string; label: string }> = {
        meteor:         { glyph: '☄',  color: '#c04010', label: 'Meteor Strike (45s)' },
        frostNova:      { glyph: '❄',  color: '#3080c0', label: 'Frost Nova (30s)' },
        whirlwind:      { glyph: '\u{1F300}', color: '#4090d0', label: 'Whirlwind (35s)' },
        smash:          { glyph: '\u{1F4A5}', color: '#d06030', label: 'Smash (25s)' },
        volley:         { glyph: '\u{1F3F9}', color: '#60c060', label: 'Volley (30s)' },
        explosiveArrow: { glyph: '\u{1F4A2}', color: '#e06030', label: 'Explosive Arrow (25s)' },
    };

    /**
     * Resolve the registered ability IDs from the AbilityManager, mapping each
     * to display metadata. Falls back to mage defaults when no manager is set.
     */
    private _resolveUltimateDefs(): { id: string; label: string; color: string }[] {
        const fallback = [
            { id: 'meteor',    label: '☄', color: '#c04010' },
            { id: 'frostNova', label: '❄', color: '#3080c0' },
        ];
        if (!this.abilityManager) return fallback;
        const ids = this.abilityManager.getRegisteredAbilityIds();
        if (ids.length === 0) return fallback;
        return ids.map(id => {
            const meta = HeroHud.ULT_DISPLAY[id];
            return {
                id,
                label: meta?.glyph ?? '◉',
                color: meta?.color ?? '#808080',
            };
        });
    }

    private _buildPauseButton(opts: { sizePx: number; rightOffset: number }): void {
        const bg = makeFrame({
            name: 'pauseBtn',
            sizePx: opts.sizePx,
            color: '#c0c0d0',
            cornerRadius: STYLE.pillRadius,
        });
        bg.height = `${opts.sizePx}px`;
        bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        bg.top = '10px';
        bg.left = `-${opts.rightOffset}px`;

        const icon = new TextBlock('pauseIcon', '⏸');
        icon.color = '#fff';
        icon.fontSize = Math.round(opts.sizePx * 0.55);
        icon.fontStyle = 'bold';
        icon.fontFamily = 'Arial';
        icon.shadowColor = STYLE.textShadowColor;
        icon.shadowBlur = STYLE.textShadowBlur;
        bg.addControl(icon);

        addPressFeedback(bg, () => {
            if (!this.game) return;
            this.game.togglePause();
            icon.text = this.game.getIsPaused() ? '▶' : '⏸';
        });

        this.ui.addControl(bg);
        this.builtControls.push(bg);
        this.pauseButtonIcon = icon;
    }

    private _buildUltimateButtons(opts: {
        btnSize: number;
        fontSize: number;
        gap: number;
        bottomOffset: number;
        rightOffset: number;
    }): void {
        const ultimateDefs = this._resolveUltimateDefs();
        const rowWidth = ultimateDefs.length * opts.btnSize + Math.max(0, ultimateDefs.length - 1) * opts.gap;

        const ultRow = new Rectangle('ultRow');
        ultRow.width = `${rowWidth}px`;
        ultRow.height = `${opts.btnSize}px`;
        ultRow.thickness = 0;
        ultRow.background = '';
        ultRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        ultRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        ultRow.top = `-${opts.bottomOffset}px`;
        ultRow.left = `-${opts.rightOffset}px`;
        this.ui.addControl(ultRow);
        this.builtControls.push(ultRow);

        ultimateDefs.forEach((def, i) => {
            const bg = makeFrame({
                name: `ultBg_${i}`,
                sizePx: opts.btnSize,
                color: def.color,
                cornerRadius: 12,
            });
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.left = `${i * (opts.btnSize + opts.gap)}px`;
            ultRow.addControl(bg);

            const label = new TextBlock(`ultLbl_${i}`, def.label);
            label.color = '#fff';
            label.fontSize = opts.fontSize;
            label.fontFamily = 'Arial';
            label.shadowColor = STYLE.textShadowColor;
            label.shadowBlur = STYLE.textShadowBlur;
            bg.addControl(label);

            const cdMask = new Rectangle(`ultCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0, 0, 0, 0.65)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = 12;
            cdMask.isPointerBlocker = false;
            bg.addControl(cdMask);

            const capturedId = def.id;
            addPressFeedback(bg, () => {
                if (!this.abilityManager) return;
                const fired = this.abilityManager.activate(capturedId);
                if (fired) {
                    flashControl(bg, '#ffffff', 200);
                    tryHaptic(15);
                }
            });

            this.ultimateContainers.push({ bg, label, cdMask });
        });
    }

    public update(
        hp: { current: number; max: number },
        gold: number,
        slots: (PowerSlot | null)[],
        deltaTime: number = 0,
        waveInfo?: { wave: number; enemiesAlive: number; inProgress: boolean },
    ): void {
        const ratio = Math.max(0, hp.current / hp.max);

        // ── Pause button glyph sync ─────────────────────────────────────────
        if (this.game && this.pauseButtonIcon) {
            const isPaused = this.game.getIsPaused();
            if (isPaused !== this.prevPaused) {
                this.pauseButtonIcon.text = isPaused ? '▶' : '⏸';
                this.prevPaused = isPaused;
            }
        }

        // ── Diff-based tactile feedback ─────────────────────────────────────
        const currentHp = hp.current;
        if (this.prevHp >= 0 && currentHp < this.prevHp - 0.01 && this.hpBg) {
            // Hero took damage — flash the HP bar white briefly
            flashControl(this.hpBg, '#ffffff', 80, 0.40);
        }
        this.prevHp = currentHp;

        if (this.prevGold >= 0 && gold > this.prevGold && this.goldPillBg) {
            // Gold went up — pulse the gold pill
            pulseScale(this.goldPillBg, 1.10, 180);
        }
        this.prevGold = gold;

        if (waveInfo && this.prevWaveInProgress && !waveInfo.inProgress && this.wavePillBg) {
            // Wave just cleared — flash the wave pill green
            flashControl(this.wavePillBg, '#00ff80', 300, 0.45);
        }
        if (waveInfo) {
            this.prevWaveInProgress = waveInfo.inProgress;
        }

        const inDanger = ratio < 0.25;

        // ── Low-HP danger pulse ─────────────────────────────────────────────
        if (inDanger) {
            this.lowHpPulseTime += deltaTime;
            const baseAlpha = 0.08;
            const pulseAlpha = 0.10 * Math.max(0, Math.sin(this.lowHpPulseTime * Math.PI * 1.8));
            this.lowHpVignette.alpha = baseAlpha + pulseAlpha;
        } else {
            this.lowHpVignette.alpha = 0;
            this.lowHpPulseTime = 0;
        }

        // ── HP fill + pulsing red in danger zone ────────────────────────────
        this.hpFill.width = ratio;
        if (inDanger) {
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.lowHpPulseTime * Math.PI * 2.5));
            const r = Math.round(180 + 75 * pulse);
            const g = Math.round(30 * (1 - pulse));
            if (r !== this._lastDangerHpR || g !== this._lastDangerHpG) {
                this.hpFill.background = `rgb(${r},${g},30)`;
                this._lastDangerHpR = r;
                this._lastDangerHpG = g;
            }
        } else if (ratio > 0.5) {
            this.hpFill.background = '#c33';
            this._lastDangerHpR = -1;
            this._lastDangerHpG = -1;
        } else {
            this.hpFill.background = '#c73';
            this._lastDangerHpR = -1;
            this._lastDangerHpG = -1;
        }

        this.hpText.text = `${Math.ceil(hp.current)} / ${hp.max}`;
        this.goldText.text = `◯ ${gold}`;

        // ── Power slots ─────────────────────────────────────────────────────
        for (let i = 0; i < 4; i++) {
            const slot = slots[i];
            const { bg, icon, level, cdMask } = this.slotContainers[i];

            if (!slot) {
                icon.text = '+';
                icon.color = '#666';
                level.text = '';
                cdMask.height = 0;
                bg.color = STYLE.panelBorderEmpty;
                bg.background = STYLE.panelBgEmpty;
                bg.scaleX = 1;
                bg.scaleY = 1;
                this.prevCooldownRemaining[i] = -1;
                this.slotPulseActive[i] = false;
            } else {
                const glyph = POWER_GLYPH[slot.def.id] ?? ELEMENT_GLYPH[slot.def.element] ?? '?';
                const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#fff';
                icon.text = glyph;
                icon.color = elemColor;
                level.text = `L${slot.state.level}`;
                bg.color = elemColor;
                bg.background = STYLE.panelBg;

                const total = slot.def.cooldownFor(slot.state);
                const remaining = Math.max(0, slot.state.cooldownRemaining);
                const frac = Math.min(1, remaining / Math.max(0.001, total));
                cdMask.height = frac;

                const prev = this.prevCooldownRemaining[i];
                if (prev >= 0 && prev < 0.05 && remaining > total * 0.9) {
                    this.slotPulseActive[i] = true;
                    this.slotPulseTime[i] = 0;
                }
                this.prevCooldownRemaining[i] = remaining;

                if (this.slotPulseActive[i]) {
                    this.slotPulseTime[i] += deltaTime;
                    const t = this.slotPulseTime[i];
                    const period = 0.4;
                    if (t >= period) {
                        this.slotPulseActive[i] = false;
                        bg.scaleX = 1;
                        bg.scaleY = 1;
                    } else {
                        const s = 1.0 + 0.05 * Math.sin((t / period) * Math.PI);
                        bg.scaleX = s;
                        bg.scaleY = s;
                    }
                } else {
                    bg.scaleX = 1;
                    bg.scaleY = 1;
                }
            }
        }

        // ── Ultimate cooldown overlays ──────────────────────────────────────
        if (this.abilityManager) {
            const registeredIds = this.abilityManager.getRegisteredAbilityIds();
            for (let i = 0; i < this.ultimateContainers.length; i++) {
                const { cdMask } = this.ultimateContainers[i];
                const abilityId = registeredIds[i];
                if (!abilityId) continue;
                const ability = this.abilityManager.getAbility(abilityId);
                if (ability) {
                    const frac = ability.isReady
                        ? 0
                        : Math.min(1, ability.currentCooldown / Math.max(0.001, ability.cooldown));
                    cdMask.height = frac;
                }
            }
        }

        // ── Wave indicator ──────────────────────────────────────────────────
        if (waveInfo) {
            if (waveInfo.inProgress) {
                this.waveText.text = `WAVE ${waveInfo.wave} · ${waveInfo.enemiesAlive} LEFT`;
            } else if (waveInfo.wave === 0) {
                this.waveText.text = `WAVE 1 STARTING`;
            } else {
                this.waveText.text = `WAVE ${waveInfo.wave} CLEARED`;
            }
        } else {
            this.waveText.text = '';
        }
    }

    public dispose(): void {
        if (this.resizeObserver) {
            this.resizeObserver();
            this.resizeObserver = null;
        }
        // Controls are owned by the AdvancedDynamicTexture; disposing the
        // texture takes care of them. Nothing extra needed here.
    }
}
