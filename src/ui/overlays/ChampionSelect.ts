import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { el } from '../dom';

export interface ChampionOption {
    type: string;
    name: string;
    summary: string;
    startingPower?: string;
    color: string;
}

// Class glyphs by champion type — unicode that renders well in DOM
// 'barbarian' → 🪓, 'ranger' → 🏹, 'mage' → 🔮, fallback to a star
const CLASS_GLYPH: Record<string, string> = {
    barbarian: '🪓',
    ranger:    '🏹',
    mage:      '🔮',
    warrior:   '⚔',
    archer:    '🏹',
    wizard:    '🔮',
    rogue:     '✦',
};

function getClassGlyph(type: string): string {
    return CLASS_GLYPH[type.toLowerCase()] ?? '★';
}

export class ChampionSelectOverlay {
    private modal: ModalController | null = null;

    constructor(private parent: HTMLElement) {}

    public show(options: ChampionOption[], onPick: (type: string) => void): void {
        this.close();

        const modal = makeModal({ title: 'Choose Your Champion' });

        const choices = el('div', { class: 'modal-choices' });
        for (const opt of options) {
            const card = makeCard({
                name: opt.name,
                subtitle: opt.summary,
                glyph: getClassGlyph(opt.type),
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
