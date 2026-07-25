import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { IconName } from '../icons';
import { el } from '../dom';

export interface ChampionOption {
    type: string;
    name: string;
    summary: string;
    startingPower?: string;
    color: string;
}

/** Class emblems from the authored icon set (was 🪓 / 🏹 / 🔮). */
const CLASS_ICON: Record<string, IconName> = {
    barbarian: 'axe',
    ranger:    'bow',
    mage:      'orb',
    warrior:   'swords',
    archer:    'bow',
    wizard:    'orb',
    rogue:     'spear',
};

function getClassIcon(type: string): IconName {
    return CLASS_ICON[type.toLowerCase()] ?? 'star';
}

export class ChampionSelectOverlay {
    private modal: ModalController | null = null;

    constructor(private parent: HTMLElement) {}

    public show(options: ChampionOption[], onPick: (type: string) => void): void {
        this.close();

        const modal = makeModal({ title: 'Choose Your Champion' });
        // Opaque themed backdrop so the arena / champion assets loading behind
        // the picker aren't visible (other overlays keep the see-through scrim).
        modal.root.classList.add('modal-scrim--solid');

        const choices = el('div', { class: 'modal-choices' });
        for (const opt of options) {
            const card = makeCard({
                name: opt.name,
                subtitle: opt.summary,
                icon: getClassIcon(opt.type),
                accent: opt.color,
                kind: opt.startingPower,
                onClick: () => {
                    this.close();
                    onPick(opt.type);
                },
            });
            choices.appendChild(card);
        }

        modal.body.appendChild(choices);
        this.parent.appendChild(modal.root);
        this.modal = modal;
    }

    public close(): void {
        this.modal?.dispose();
        this.modal = null;
    }
}
