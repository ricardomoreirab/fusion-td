import { AdvancedDynamicTexture, Rectangle, TextBlock, Button, Control } from '@babylonjs/gui';
import { PowerSlot } from '../gameplay/PowerSlotManager';

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

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(
        currentSlots: (PowerSlot | null)[],
        newPowerName: string,
        onPick: (slotIndex: number) => void,
        onCancel: () => void,
    ): void {
        this.panel = new Rectangle('replaceSlotBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.80)';
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        // Title
        const title = new TextBlock('replaceTitle', 'Replace a Power Slot');
        title.color = '#ffd700';
        title.fontSize = 26;
        title.fontWeight = 'bold';
        title.top = '-220px';
        title.height = '36px';
        this.panel.addControl(title);

        // Subtitle showing new power name
        const subtitle = new TextBlock('replaceSubtitle', `Adding: ${newPowerName}`);
        subtitle.color = '#aaa';
        subtitle.fontSize = 16;
        subtitle.top = '-178px';
        subtitle.height = '24px';
        this.panel.addControl(subtitle);

        const nonNull = currentSlots.filter(s => s !== null);
        const total = nonNull.length;

        currentSlots.forEach((slot, i) => {
            if (!slot) return;

            const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#aaa';
            const glyph = ELEMENT_GLYPH[slot.def.id] ?? '?';
            const visualIndex = currentSlots.slice(0, i + 1).filter(s => s !== null).length - 1;
            const offsetX = (visualIndex - (total - 1) / 2) * 200;

            // ── Outer card frame ─────────────────────────────────────────────
            const outer = new Rectangle(`replaceOuter_${i}`);
            outer.width = '175px';
            outer.height = '160px';
            outer.cornerRadius = 10;
            outer.thickness = 2;
            outer.color = elemColor;
            outer.background = '#0d0d1a';
            outer.left = `${offsetX}px`;
            outer.isPointerBlocker = true;

            // ── Header strip ─────────────────────────────────────────────────
            const header = new Rectangle(`replaceHeader_${i}`);
            header.width = '175px';
            header.height = '52px';
            header.thickness = 0;
            header.background = elemColor + '33'; // translucent tint
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

            // Hover / select feedback
            outer.onPointerEnterObservable.add(() => {
                outer.scaleX = 1.05;
                outer.scaleY = 1.05;
                outer.color = '#ffffff';
            });
            outer.onPointerOutObservable.add(() => {
                outer.scaleX = 1.0;
                outer.scaleY = 1.0;
                outer.color = elemColor;
            });
            outer.onPointerClickObservable.add(() => {
                onPick(i);
                this.close();
            });

            this.panel!.addControl(outer);
        });

        // Cancel button
        const cancelBtn = Button.CreateSimpleButton('replaceCancel', 'Cancel  (+25 gold)');
        cancelBtn.width = '200px';
        cancelBtn.height = '44px';
        cancelBtn.color = '#ddd';
        cancelBtn.background = '#333';
        cancelBtn.cornerRadius = 8;
        cancelBtn.thickness = 1;
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cancelBtn.top = '-40px';
        cancelBtn.onPointerClickObservable.add(() => {
            onCancel();
            this.close();
        });
        this.panel.addControl(cancelBtn);
    }

    public close(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }

    public isOpen(): boolean {
        return this.panel !== null;
    }
}
