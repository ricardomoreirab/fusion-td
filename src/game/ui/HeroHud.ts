import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { PowerSlot } from '../gameplay/PowerSlotManager';
import { AbilityManager } from '../gameplay/AbilityManager';
import { getLayoutMode } from './responsive';
import { makePill, makeFrame, STYLE } from './HudStyle';

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
    private hpFill!: Rectangle;
    private hpDangerZone!: Rectangle;
    private hpText!: TextBlock;
    private goldText!: TextBlock;
    private waveText!: TextBlock;
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

    constructor(ui: AdvancedDynamicTexture, abilityManager?: AbilityManager) {
        this.ui = ui;
        this.abilityManager = abilityManager ?? null;
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
        this.build();
    }

    // ─── Desktop layout (original) ─────────────────────────────────────────────

    private _buildDesktop(): void {
        // ── HP bar — top-left pill ─────────────────────────────────────────
        const hpW = 260;
        const hpH = 20;
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
            fontSize: 16,
            height: 28,
            textColor: '#ffe040',
        });
        wavePill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        wavePill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        wavePill.bg.top = '10px';
        this.ui.addControl(wavePill.bg);
        this.builtControls.push(wavePill.bg);
        this.waveText = wavePill.text;

        // ── Gold pill — top-right ──────────────────────────────────────────
        const goldPill = makePill({
            name: 'gold',
            color: '#ffd700',
            initialText: '◯ 0',
            fontSize: 16,
            height: 28,
            textColor: '#ffd700',
        });
        goldPill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        goldPill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        goldPill.bg.top = '10px';
        goldPill.bg.paddingRight = '10px';
        this.ui.addControl(goldPill.bg);
        this.builtControls.push(goldPill.bg);
        this.goldText = goldPill.text;

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

        // ── Ultimate ability buttons ──────────────────────────────────────────
        this._buildUltimateButtons(400, 56, 50, 22, 8, 15);
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
        const hpH = 14;
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
            fontSize: 12,
            height: 22,
            textColor: '#ffe040',
        });
        wavePill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        wavePill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        wavePill.bg.top = '10px';
        this.ui.addControl(wavePill.bg);
        this.builtControls.push(wavePill.bg);
        this.waveText = wavePill.text;

        // ── Gold pill — top-right ──────────────────────────────────────────
        const goldPill = makePill({
            name: 'gold',
            color: '#ffd700',
            initialText: '◯ 0',
            fontSize: 12,
            height: 22,
            textColor: '#ffd700',
        });
        goldPill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        goldPill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        goldPill.bg.top = '10px';
        goldPill.bg.paddingRight = '10px';
        this.ui.addControl(goldPill.bg);
        this.builtControls.push(goldPill.bg);
        this.goldText = goldPill.text;

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

        // ── Ultimate buttons — bottom-right, 44×44 ────────────────────────────
        // Right-aligned so they don't overlap with left-anchored power slots
        this._buildMobileUltimateButtons();
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

    /**
     * Shared helper for building ultimate buttons (desktop).
     * @param startLeft  left px offset of first button
     * @param stride     px distance between button centers
     * @param btnSize    width/height of each button (px)
     * @param fontSize   glyph font size
     * @param bottomOffset  how many px from bottom edge
     * @param cdRadius   corner radius
     */
    private _buildUltimateButtons(
        startLeft: number,
        stride: number,
        btnSize: number,
        fontSize: number,
        bottomOffset: number,
        cdRadius: number,
    ): void {
        const ultimateDefs = this._resolveUltimateDefs();

        ultimateDefs.forEach((def, i) => {
            const bg = new Rectangle(`ultBg_${i}`);
            bg.width = `${btnSize}px`;
            bg.height = `${btnSize}px`;
            bg.thickness = 2;
            bg.color = def.color;
            bg.background = '#1a1a2a';
            bg.cornerRadius = cdRadius;
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            bg.left = `${startLeft + i * stride}px`;
            bg.top = `-${bottomOffset}px`;
            bg.isPointerBlocker = true;
            this.ui.addControl(bg);
            this.builtControls.push(bg);

            const label = new TextBlock(`ultLbl_${i}`, def.label);
            label.color = '#fff';
            label.fontSize = fontSize;
            bg.addControl(label);

            const cdMask = new Rectangle(`ultCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0,0,0,0.65)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = cdRadius;
            bg.addControl(cdMask);

            // Click → fire ability via AbilityManager.activate()
            const capturedId = def.id;
            bg.onPointerClickObservable.add(() => {
                if (!this.abilityManager) return;
                this.abilityManager.activate(capturedId);
            });

            this.ultimateContainers.push({ bg, label, cdMask });
        });
    }

    /**
     * Mobile-specific ultimate buttons: RIGHT-aligned, stacked VERTICALLY so they
     * occupy only 44px of horizontal space and never conflict with the power slots.
     */
    private _buildMobileUltimateButtons(): void {
        const ultimateDefs = this._resolveUltimateDefs();

        const btnSize = 44;
        const gap = 8;
        ultimateDefs.forEach((def, i) => {
            const bg = new Rectangle(`ultBg_${i}`);
            bg.width = `${btnSize}px`;
            bg.height = `${btnSize}px`;
            bg.thickness = 2;
            bg.color = def.color;
            bg.background = '#1a1a2a';
            bg.cornerRadius = 10;
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            bg.paddingRight = '10px';
            bg.top = `-${10 + i * (btnSize + gap)}px`;
            bg.isPointerBlocker = true;
            this.ui.addControl(bg);
            this.builtControls.push(bg);

            const label = new TextBlock(`ultLbl_${i}`, def.label);
            label.color = '#fff';
            label.fontSize = 18;
            bg.addControl(label);

            const cdMask = new Rectangle(`ultCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0,0,0,0.65)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = 10;
            bg.addControl(cdMask);

            const capturedId = def.id;
            bg.onPointerClickObservable.add(() => {
                if (!this.abilityManager) return;
                this.abilityManager.activate(capturedId);
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
