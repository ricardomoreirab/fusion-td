import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { makeButton } from '../primitives/Button';
import { IconName } from '../icons';
import { elementColor, elementIcon, TIER_COLOR } from '../elementMeta';
import { el } from '../dom';

export type PowerCardKind = 'power' | 'wildcard' | 'perk' | 'fusion' | 'ultimate';

export interface PowerCard {
    kind: PowerCardKind;
    title: string;
    subtitle: string;
    /** Element of the power, used for accent color on power cards */
    element?: string;
    onPick: () => void;
}

const KIND_CONFIG: Record<PowerCardKind, { accent: string; kindLabel: string; icon: IconName }> = {
    power:    { accent: '#b9ad93',            kindLabel: 'POWER',    icon: 'star' },
    wildcard: { accent: '#ece0c8',            kindLabel: 'UPGRADE',  icon: 'chevronUp' },
    perk:     { accent: '#ffd700',            kindLabel: 'PERK',     icon: 'scroll' },
    fusion:   { accent: TIER_COLOR.fusion,    kindLabel: 'FUSE',     icon: 'fusion' },
    ultimate: { accent: TIER_COLOR.ultimate,  kindLabel: 'ULTIMATE', icon: 'ultimate' },
};

export class PowerChoiceOverlay {
    private modal: ModalController | null = null;
    private onClosed: () => void = () => {};

    constructor(private parent: HTMLElement) {}

    public show(cards: PowerCard[], onCancel: () => void, onClosed: () => void): void {
        this.close();

        this.onClosed = onClosed;

        const modal = makeModal({ title: 'Choose a Power' });

        const choices = el('div', { class: 'modal-choices' });
        for (const card of cards) {
            const kindCfg = KIND_CONFIG[card.kind];
            const isElementPower = card.kind === 'power' && card.element;
            const accent = isElementPower ? elementColor(card.element) : kindCfg.accent;
            const icon   = isElementPower ? elementIcon(card.element) : kindCfg.icon;

            const cardEl = makeCard({
                name:     card.title,
                subtitle: card.subtitle,
                icon,
                accent,
                kind:     kindCfg.kindLabel,
                onClick: () => {
                    card.onPick();
                    this.close();
                },
            });
            choices.appendChild(cardEl);
        }
        modal.body.appendChild(choices);

        const skipBtn = makeButton({
            label: 'Skip',
            variant: 'ghost',
            onClick: () => {
                onCancel();
                this.close();
            },
        });
        modal.body.appendChild(skipBtn);

        this.parent.appendChild(modal.root);
        this.modal = modal;
    }

    public close(): void {
        if (this.modal) {
            this.modal.dispose();
            this.modal = null;
        }
        const cb = this.onClosed;
        this.onClosed = () => {};
        cb();
    }

    public isOpen(): boolean {
        return this.modal !== null;
    }
}
