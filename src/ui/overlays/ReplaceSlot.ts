import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { elementColor, elementIcon } from '../elementMeta';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';

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

            const card = makeCard({
                name:     slot.def.name,
                subtitle: `Level ${slot.state.level}`,
                icon:     elementIcon(slot.def.element),
                accent:   elementColor(slot.def.element),
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
