import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { PowerSlot } from '../powers/PowerSlotManager';
import { getLayoutMode, getRenderWidth } from '../../shared/ui/responsive';
import { makeFrame, addPressFeedback, STYLE } from '../../shared/ui/HudStyle';

const ELEMENT_GLYPH: Record<string, string> = {
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

export class ReplaceSlotOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;
    private resizeObserver: (() => void) | null = null;

    // Saved args for rebuild on resize
    private _currentSlots: (PowerSlot | null)[] = [];
    private _newPowerName: string = '';
    private _onPick: (slotIndex: number) => void = () => {};
    private _onCancel: () => void = () => {};

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(
        currentSlots: (PowerSlot | null)[],
        newPowerName: string,
        onPick: (slotIndex: number) => void,
        onCancel: () => void,
    ): void {
        this._currentSlots = currentSlots;
        this._newPowerName = newPowerName;
        this._onPick = onPick;
        this._onCancel = onCancel;
        this._build();

        // Rebuild on resize
        this._removeResizeListener();
        const engine = this.ui.getScene()?.getEngine();
        if (engine) {
            const handler = () => {
                if (this.panel) {
                    this._build();
                }
            };
            engine.onResizeObservable.add(handler);
            this.resizeObserver = () => engine.onResizeObservable.removeCallback(handler);
        }
    }

    private _build(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }

        const isMobile = getLayoutMode(this.ui) === 'mobile';
        const vw = getRenderWidth(this.ui);

        this.panel = new Rectangle('replaceSlotBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = STYLE.backdropDim;
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        if (isMobile) {
            this._buildMobileLayout(vw);
        } else {
            this._buildDesktopLayout();
        }
    }

    /** Desktop: horizontal row of up to 4 cards (original layout) */
    private _buildDesktopLayout(): void {
        const title = new TextBlock('replaceTitle', 'Replace a Power Slot');
        title.color = '#ffd700';
        title.fontSize = 26;
        title.fontWeight = 'bold';
        title.top = '-220px';
        title.height = '36px';
        this.panel!.addControl(title);

        const subtitle = new TextBlock('replaceSubtitle', `Adding: ${this._newPowerName}`);
        subtitle.color = '#aaa';
        subtitle.fontSize = 16;
        subtitle.top = '-178px';
        subtitle.height = '24px';
        this.panel!.addControl(subtitle);

        const nonNull = this._currentSlots.filter(s => s !== null);
        const total = nonNull.length;

        this._currentSlots.forEach((slot, i) => {
            if (!slot) return;

            const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#aaa';
            const glyph = ELEMENT_GLYPH[slot.def.id] ?? '?';
            const visualIndex = this._currentSlots.slice(0, i + 1).filter(s => s !== null).length - 1;
            const offsetX = (visualIndex - (total - 1) / 2) * 200;

            // ── Outer card frame ─────────────────────────────────────────────
            const outer = makeFrame({ name: `replaceOuter_${i}`, sizePx: 175, color: elemColor, cornerRadius: 10 });
            outer.height = '160px';
            outer.left = `${offsetX}px`;

            // ── Header strip ─────────────────────────────────────────────────
            const header = new Rectangle(`replaceHeader_${i}`);
            header.width = '175px';
            header.height = '52px';
            header.thickness = 0;
            header.background = elemColor + '33';
            header.cornerRadius = 8;
            header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            outer.addControl(header);

            const glyphTxt = new TextBlock(`replaceGlyph_${i}`, glyph);
            glyphTxt.color = elemColor;
            glyphTxt.fontSize = 28;
            header.addControl(glyphTxt);

            // ── Inner panel ──────────────────────────────────────────────────
            const inner = new Rectangle(`replaceInner_${i}`);
            inner.width = '159px';
            inner.height = '96px';
            inner.thickness = 1;
            inner.color = '#333';
            inner.background = '#111827';
            inner.cornerRadius = 6;
            inner.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            inner.top = '-4px';
            outer.addControl(inner);

            const nameLabel = new TextBlock(`replaceName_${i}`, slot.def.name);
            nameLabel.color = '#ffffff';
            nameLabel.fontSize = 14;
            nameLabel.fontWeight = 'bold';
            nameLabel.top = '-20px';
            nameLabel.textWrapping = true;
            nameLabel.width = '145px';
            inner.addControl(nameLabel);

            const lvLabel = new TextBlock(`replaceLv_${i}`, `Level ${slot.state.level}`);
            lvLabel.color = '#aaa';
            lvLabel.fontSize = 12;
            lvLabel.top = '14px';
            inner.addControl(lvLabel);

            addPressFeedback(outer, () => {
                this._onPick(i);
                this.close();
            });

            this.panel!.addControl(outer);
        });

        // Cancel button
        const cancelBtn = makeFrame({ name: 'replaceCancel', sizePx: 200, color: '#666', cornerRadius: 10 });
        cancelBtn.height = '44px';
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cancelBtn.top = '-40px';
        const cancelBtnLabel = new TextBlock('replaceCancelLabel', 'Cancel  (+25 gold)');
        cancelBtnLabel.color = '#ddd';
        cancelBtnLabel.fontSize = 14;
        cancelBtn.addControl(cancelBtnLabel);
        addPressFeedback(cancelBtn, () => {
            this._onCancel();
            this.close();
        });
        this.panel!.addControl(cancelBtn);
    }

    /**
     * Mobile: 2×2 grid (or vertical stack if ≤2 slots) of compact mini-cards.
     * Each mini-card is 160×60 in a 2-column grid.
     */
    private _buildMobileLayout(vw: number): void {
        const title = new TextBlock('replaceTitle', 'Replace a Power Slot');
        title.color = '#ffd700';
        title.fontSize = 20;
        title.fontWeight = 'bold';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        title.top = '18px';
        title.height = '28px';
        this.panel!.addControl(title);

        const subtitle = new TextBlock('replaceSubtitle', `Adding: ${this._newPowerName}`);
        subtitle.color = '#aaa';
        subtitle.fontSize = 14;
        subtitle.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        subtitle.top = '50px';
        subtitle.height = '22px';
        this.panel!.addControl(subtitle);

        const nonNull = this._currentSlots.filter(s => s !== null);
        const total = nonNull.length;

        // Card dimensions — 2-col grid; clamp to viewport
        const cardW = Math.min(160, Math.floor((vw - 60) / 2));
        const cardH = 70;
        const colGap = 12;
        const rowGap = 10;

        const cols = total <= 2 ? 1 : 2;
        const rows = Math.ceil(total / cols);

        // Total grid size
        const gridW = cols === 1 ? cardW : cardW * 2 + colGap;
        const gridH = rows * cardH + (rows - 1) * rowGap;

        let visualIndex = 0;
        this._currentSlots.forEach((slot, i) => {
            if (!slot) return;

            const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#aaa';
            const glyph = ELEMENT_GLYPH[slot.def.id] ?? '?';

            const col = visualIndex % cols;
            const row = Math.floor(visualIndex / cols);
            const offsetX = (col - (cols - 1) / 2) * (cardW + colGap);
            const offsetY = (row - (rows - 1) / 2) * (cardH + rowGap);

            visualIndex++;

            // ── Outer card ─────────────────────────────────────────────────
            const outer = makeFrame({ name: `replaceOuter_${i}`, sizePx: cardW, color: elemColor, cornerRadius: 10 });
            outer.height = `${cardH}px`;
            outer.left = `${offsetX}px`;
            outer.top = `${offsetY}px`;

            // ── Left glyph strip ───────────────────────────────────────────
            const glyphStrip = new Rectangle(`replaceGlyphStrip_${i}`);
            glyphStrip.width = '44px';
            glyphStrip.height = `${cardH}px`;
            glyphStrip.thickness = 0;
            glyphStrip.background = elemColor + '33';
            glyphStrip.cornerRadius = 6;
            glyphStrip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            outer.addControl(glyphStrip);

            const glyphTxt = new TextBlock(`replaceGlyph_${i}`, glyph);
            glyphTxt.color = elemColor;
            glyphTxt.fontSize = 22;
            glyphStrip.addControl(glyphTxt);

            // ── Right content ──────────────────────────────────────────────
            const inner = new Rectangle(`replaceInner_${i}`);
            inner.width = `${cardW - 50}px`;
            inner.height = `${cardH - 8}px`;
            inner.thickness = 0;
            inner.background = 'transparent';
            inner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            inner.paddingRight = '6px';
            outer.addControl(inner);

            const nameLabel = new TextBlock(`replaceName_${i}`, slot.def.name);
            nameLabel.color = '#ffffff';
            nameLabel.fontSize = 12;
            nameLabel.fontWeight = 'bold';
            nameLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            nameLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            nameLabel.top = '8px';
            nameLabel.height = '18px';
            nameLabel.textWrapping = true;
            nameLabel.width = `${cardW - 54}px`;
            inner.addControl(nameLabel);

            const lvLabel = new TextBlock(`replaceLv_${i}`, `Lv ${slot.state.level}`);
            lvLabel.color = '#aaa';
            lvLabel.fontSize = 11;
            lvLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            lvLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            lvLabel.paddingBottom = '6px';
            inner.addControl(lvLabel);

            addPressFeedback(outer, () => {
                this._onPick(i);
                this.close();
            });

            this.panel!.addControl(outer);
        });

        // Cancel button
        const cancelBtn = makeFrame({ name: 'replaceCancel', sizePx: Math.min(200, vw - 40), color: '#666', cornerRadius: 10 });
        cancelBtn.height = '44px';
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cancelBtn.top = '-20px';
        const cancelBtnLabel = new TextBlock('replaceCancelLabel', 'Cancel  (+25 gold)');
        cancelBtnLabel.color = '#ddd';
        cancelBtnLabel.fontSize = 14;
        cancelBtn.addControl(cancelBtnLabel);
        addPressFeedback(cancelBtn, () => {
            this._onCancel();
            this.close();
        });
        this.panel!.addControl(cancelBtn);
    }

    private _removeResizeListener(): void {
        if (this.resizeObserver) {
            this.resizeObserver();
            this.resizeObserver = null;
        }
    }

    public close(): void {
        this._removeResizeListener();
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }

    public isOpen(): boolean {
        return this.panel !== null;
    }
}
