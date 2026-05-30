import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';

// ─── Element glyph/color maps (mirrors PowerChoice + legacy) ─────────────────
const ELEMENT_GLYPH: Record<string, string> = {
    fire:     '🔥',
    ice:      '◆',
    arcane:   '◉',
    physical: '➤',
    storm:    '⚡',
};

const ELEMENT_COLOR: Record<string, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

export class ReplaceSlotOverlay {
    private modal: ModalController | null = null;

    constructor(private parent: HTMLElement) {}

    public show(
        currentSlots: (PowerSlot | null)[],
        newPowerName: string,
        onPick: (slotIndex: number) => void,
        onCancel: () => void,
    ): void {
        this.close();

        const modal = makeModal({ title: `Replace a Power Slot` });
        modal.body.appendChild(
            el('div', { class: 'modal-subtitle', text: `Adding: ${newPowerName}` }),
        );

        const choices = el('div', { class: 'modal-choices' });
        currentSlots.forEach((slot, i) => {
            if (!slot) return;

            const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#aaa';
            const glyph     = ELEMENT_GLYPH[slot.def.element] ?? '?';

            const card = makeCard({
                name:     slot.def.name,
                subtitle: `Level ${slot.state.level}`,
                glyph,
                accent:   elemColor,
                onClick: () => {
                    this.close();
                    onPick(i);
                },
            });
            choices.appendChild(card);
        });
        modal.body.appendChild(choices);

        const cancelBtn = makeButton({
            label:   'Cancel  (+25 gold)',
            variant: 'ghost',
            onClick: () => {
                this.close();
                onCancel();
            },
        });
        modal.body.appendChild(cancelBtn);

        this.parent.appendChild(modal.root);
        this.modal = modal;
    }

    public close(): void {
        this.modal?.dispose();
        this.modal = null;
    }

    public isOpen(): boolean {
        return this.modal !== null;
    }
}
