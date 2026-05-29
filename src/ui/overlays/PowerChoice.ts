import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';

export type PowerCardKind = 'power' | 'wildcard' | 'perk' | 'fusion' | 'ultimate';

export interface PowerCard {
    kind: PowerCardKind;
    title: string;
    subtitle: string;
    /** Element of the power, used for border color on power cards */
    element?: string;
    onPick: () => void;
}

// ─── Glyph maps shared with HeroHud ──────────────────────────────────────────
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

const KIND_CONFIG: Record<PowerCardKind, { border: string; kindLabel: string; glyph: string }> = {
    power:    { border: '#888',    kindLabel: 'POWER',   glyph: '★'  },
    wildcard: { border: '#ffffff', kindLabel: 'UPGRADE', glyph: '↑'  },
    perk:     { border: '#ffd700', kindLabel: 'PERK',    glyph: '✦'  },
    fusion:   { border: '#c060ff', kindLabel: 'FUSE',    glyph: '✦'  },
    ultimate: { border: '#ffd24d', kindLabel: 'ULTIMATE',glyph: '✪'  },
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
            const accent  = isElementPower ? (ELEMENT_COLOR[card.element!] ?? kindCfg.border) : kindCfg.border;
            const glyph   = isElementPower ? (ELEMENT_GLYPH[card.element!] ?? kindCfg.glyph) : kindCfg.glyph;

            const cardEl = makeCard({
                name:     card.title,
                subtitle: card.subtitle,
                glyph,
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
