import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { PowerSlot } from '../gameplay/PowerSlotManager';
import { AbilityManager } from '../gameplay/AbilityManager';

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

    constructor(ui: AdvancedDynamicTexture, abilityManager?: AbilityManager) {
        this.ui = ui;
        this.abilityManager = abilityManager ?? null;
        this.build();
    }

    private build(): void {
        // Low-HP danger pulse vignette — full screen red overlay, hidden by default
        this.lowHpVignette = new Rectangle('lowHpVignette');
        this.lowHpVignette.width = '100%';
        this.lowHpVignette.height = '100%';
        this.lowHpVignette.thickness = 0;
        this.lowHpVignette.background = '#ff0000';
        this.lowHpVignette.alpha = 0;
        this.lowHpVignette.isPointerBlocker = false;
        this.ui.addControl(this.lowHpVignette);

        // ── HP bar ────────────────────────────────────────────────────────────
        const hpBg = new Rectangle('hpBg');
        hpBg.width = '240px';
        hpBg.height = '22px';
        hpBg.thickness = 2;
        hpBg.color = '#444';
        hpBg.background = '#111';
        hpBg.cornerRadius = 4;
        hpBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        hpBg.left = '150px';
        hpBg.top = '-80px';
        this.ui.addControl(hpBg);

        this.hpFill = new Rectangle('hpFill');
        this.hpFill.width = 1.0;
        this.hpFill.height = 1.0;
        this.hpFill.thickness = 0;
        this.hpFill.background = '#c33';
        this.hpFill.cornerRadius = 3;
        this.hpFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.addControl(this.hpFill);

        // Danger-zone marker at 25% — thin bright yellow segment on the right 25%
        this.hpDangerZone = new Rectangle('hpDangerZone');
        this.hpDangerZone.width = '2px';
        this.hpDangerZone.height = '100%';
        this.hpDangerZone.thickness = 0;
        this.hpDangerZone.background = '#ffe040';
        this.hpDangerZone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        // Sits at 75% from left → left offset = 75% of 240px = 180px, but in relative units
        // We'll position it via left on the parent container approach
        this.hpDangerZone.left = '179px'; // 240 * 0.75 - 1
        hpBg.addControl(this.hpDangerZone);

        this.hpText = new TextBlock('hpText', '');
        this.hpText.color = '#fff';
        this.hpText.fontSize = 13;
        hpBg.addControl(this.hpText);

        // Gold text — right of HP bar
        this.goldText = new TextBlock('goldText', '');
        this.goldText.color = '#ffd700';
        this.goldText.fontSize = 17;
        this.goldText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.goldText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.goldText.left = '400px';
        this.goldText.top = '-80px';
        this.goldText.width = '130px';
        this.goldText.height = '22px';
        this.goldText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ui.addControl(this.goldText);

        // ── 4 power-slot icons — bottom row ──────────────────────────────────
        for (let i = 0; i < 4; i++) {
            const bg = new Rectangle(`slotBg_${i}`);
            bg.width = '54px';
            bg.height = '54px';
            bg.thickness = 2;
            bg.color = '#555';
            bg.background = '#1a1a2a';
            bg.cornerRadius = 6;
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            bg.left = `${150 + i * 60}px`;
            bg.top = '-15px';
            this.ui.addControl(bg);

            // Element glyph icon
            const icon = new TextBlock(`slotIcon_${i}`, '?');
            icon.color = '#888';
            icon.fontSize = 24;
            bg.addControl(icon);

            // Level badge — bottom-right corner
            const level = new TextBlock(`slotLvl_${i}`, '');
            level.color = '#fff';
            level.fontSize = 11;
            level.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            level.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            level.paddingRight = '3px';
            level.paddingBottom = '2px';
            bg.addControl(level);

            // Cooldown mask: covers from top downwards proportional to remaining/total
            const cdMask = new Rectangle(`slotCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0,0,0,0.6)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = 6;
            bg.addControl(cdMask);

            this.slotContainers.push({ bg, icon, level, cdMask });
        }

        // ── Ultimate ability buttons ──────────────────────────────────────────
        const ultimateDefs = [
            { id: 'meteor',    label: '☄',  color: '#c04010', tooltip: 'Meteor Strike (45s)' },
            { id: 'frostNova', label: '❄',  color: '#2080c0', tooltip: 'Frost Nova (30s)' },
        ];

        ultimateDefs.forEach((def, i) => {
            const bg = new Rectangle(`ultBg_${i}`);
            bg.width = '50px';
            bg.height = '50px';
            bg.thickness = 2;
            bg.color = def.color;
            bg.background = '#1a1a2a';
            bg.cornerRadius = 8;
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            bg.left = `${400 + i * 56}px`;
            bg.top = '-15px';
            bg.isPointerBlocker = true;
            this.ui.addControl(bg);

            const label = new TextBlock(`ultLbl_${i}`, def.label);
            label.color = '#fff';
            label.fontSize = 22;
            bg.addControl(label);

            // Cooldown mask (covers top → bottom)
            const cdMask = new Rectangle(`ultCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0,0,0,0.65)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = 8;
            bg.addControl(cdMask);

            // Click → fire ability
            bg.onPointerClickObservable.add(() => {
                if (!this.abilityManager) return;
                if (def.id === 'frostNova') {
                    this.abilityManager.triggerFrostNova();
                } else if (def.id === 'meteor') {
                    this.abilityManager.triggerMeteorAtNearest();
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
            // Bright pulsing red
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.lowHpPulseTime * Math.PI * 2.5));
            const r = Math.round(180 + 75 * pulse);
            const g = Math.round(30 * (1 - pulse));
            this.hpFill.background = `rgb(${r},${g},30)`;
        } else if (ratio > 0.5) {
            this.hpFill.background = '#c33';
        } else {
            this.hpFill.background = '#c73';
        }

        this.hpText.text = `${Math.ceil(hp.current)} / ${hp.max}`;
        this.goldText.text = `◯ ${gold}`;

        // ── Power slots ─────────────────────────────────────────────────────
        for (let i = 0; i < 4; i++) {
            const slot = slots[i];
            const { bg, icon, level, cdMask } = this.slotContainers[i];

            if (!slot) {
                icon.text = '?';
                icon.color = '#555';
                level.text = '';
                cdMask.height = 0;
                bg.color = '#555';
                bg.scaleX = 1;
                bg.scaleY = 1;
                this.prevCooldownRemaining[i] = -1;
                this.slotPulseActive[i] = false;
            } else {
                // Glyph + color from element
                const glyph = POWER_GLYPH[slot.def.id] ?? ELEMENT_GLYPH[slot.def.element] ?? '?';
                const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#fff';
                icon.text = glyph;
                icon.color = elemColor;
                level.text = `L${slot.state.level}`;

                // Border tracks element color
                bg.color = elemColor;

                const total = slot.def.cooldownFor(slot.state);
                const remaining = Math.max(0, slot.state.cooldownRemaining);
                const frac = Math.min(1, remaining / Math.max(0.001, total));
                cdMask.height = frac;

                // Detect fire-pulse: cooldown just reset (was near 0, now full)
                const prev = this.prevCooldownRemaining[i];
                if (prev >= 0 && prev < 0.05 && remaining > total * 0.9) {
                    // Power just fired — start pulse
                    this.slotPulseActive[i] = true;
                    this.slotPulseTime[i] = 0;
                }
                this.prevCooldownRemaining[i] = remaining;

                // Animate scale pulse when power fires
                if (this.slotPulseActive[i]) {
                    this.slotPulseTime[i] += deltaTime;
                    const t = this.slotPulseTime[i];
                    const period = 0.4; // 0.4s full pulse cycle
                    if (t >= period) {
                        this.slotPulseActive[i] = false;
                        bg.scaleX = 1;
                        bg.scaleY = 1;
                    } else {
                        // 1.0 → 1.05 → 1.0 over period
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
            const ultimateIds = ['meteor', 'frostNova'];
            const ultimateCooldowns = [45, 30];
            for (let i = 0; i < this.ultimateContainers.length; i++) {
                const { cdMask } = this.ultimateContainers[i];
                const ability = this.abilityManager.getAbility(ultimateIds[i]);
                if (ability) {
                    const frac = ability.isReady
                        ? 0
                        : Math.min(1, ability.currentCooldown / Math.max(0.001, ultimateCooldowns[i]));
                    cdMask.height = frac;
                }
            }
        }
    }

    public dispose(): void {
        // Controls are owned by the AdvancedDynamicTexture; disposing the
        // texture takes care of them. Nothing extra needed here.
    }
}
