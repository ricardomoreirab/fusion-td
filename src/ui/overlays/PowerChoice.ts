import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { makeButton } from '../primitives/Button';
import { iconEl, IconName } from '../icons';
import { elementColor, elementIcon, TIER_COLOR } from '../elementMeta';
import { el } from '../dom';
import type { PowerStatRow } from '../../survivors/powers/PowerDefinitions';
import { t } from '../../i18n';

export type PowerCardKind = 'power' | 'wildcard' | 'perk' | 'fusion' | 'ultimate';

export interface PowerCard {
    kind: PowerCardKind;
    title: string;
    /** Short line under the name — the headline change this pick makes. */
    subtitle: string;
    /** Element of the power, used for accent color on power cards */
    element?: string;
    /** How the power behaves, in one sentence. Absent on perks. */
    summary?: string;
    /** Detail table: damage, cooldown, DPS, range and per-power extras. */
    stats?: PowerStatRow[];
    /** Current level, and the level this pick takes it to. Equal ⇒ no level row. */
    level?: number;
    nextLevel?: number;
    maxLevel?: number;
    onPick: () => void;
}

const KIND_CONFIG: Record<PowerCardKind, { accent: string; kindLabel: string; icon: IconName }> = {
    power:    { accent: '#b9ad93',            kindLabel: 'POWER',    icon: 'star' },
    wildcard: { accent: '#ece0c8',            kindLabel: 'UPGRADE',  icon: 'chevronUp' },
    perk:     { accent: '#ffd700',            kindLabel: 'PERK',     icon: 'scroll' },
    fusion:   { accent: TIER_COLOR.fusion,    kindLabel: 'FUSE',     icon: 'fusion' },
    ultimate: { accent: TIER_COLOR.ultimate,  kindLabel: 'ULTIMATE', icon: 'ultimate' },
};

/** Build the level chip: "NEW", "Lv 2 → 3" or "Lv 5 · MAX". */
function levelChip(card: PowerCard): HTMLElement | null {
    const { level, nextLevel, maxLevel } = card;
    if (level === undefined) return null;
    if (level === 0) return el('div', { class: 'power-card__level power-card__level--new', text: t('power.newPower') });
    if (nextLevel !== undefined && nextLevel > level) {
        return el('div', { class: 'power-card__level' }, [
            el('span', { text: `Lv ${level}` }),
            iconEl('chevronRight'),
            el('span', { class: 'power-card__level-to', text: `${nextLevel}` }),
        ]);
    }
    if (maxLevel !== undefined && level >= maxLevel) {
        return el('div', { class: 'power-card__level power-card__level--max', text: `Lv ${level} · MAX` });
    }
    return el('div', { class: 'power-card__level', text: `Lv ${level}` });
}

/** One row of the stat table: label on the left, value (and its upgraded
    counterpart) on the right. */
function statRow(row: PowerStatRow): HTMLElement {
    const value = el('div', { class: 'power-card__stat-value' }, [
        el('span', { class: row.next ? 'power-card__stat-from' : '', text: row.value }),
    ]);
    if (row.next) {
        value.appendChild(iconEl('chevronRight'));
        value.appendChild(el('span', {
            // A shorter cooldown is an improvement even though the number falls —
            // colour by whether the change HELPS, never by its direction.
            class: `power-card__stat-to${row.lowerIsBetter ? ' power-card__stat-to--inverse' : ''}`,
            text: row.next,
        }));
    }
    return el('div', { class: 'power-card__stat' }, [
        el('div', { class: 'power-card__stat-label', text: row.label }),
        value,
    ]);
}

/** The rich power card: kind + level chip, emblem, name, behaviour summary and
    the full stat table. Falls back to the plain choice card for perks, which
    have no power behind them to describe. */
function makePowerCard(card: PowerCard, accent: string, icon: IconName, kindLabel: string, onPick: () => void): HTMLElement {
    if (!card.stats || card.stats.length === 0) {
        return makeCard({
            name: card.title, subtitle: card.subtitle, icon, accent, kind: kindLabel, onClick: onPick,
        });
    }

    const root = makeCard({
        name: card.title, icon, accent, kind: kindLabel, onClick: onPick, class: 'power-card',
    });

    const chip = levelChip(card);
    if (chip) root.appendChild(chip);
    if (card.summary) {
        root.appendChild(el('div', { class: 'power-card__summary', text: card.summary }));
    }

    const table = el('div', { class: 'power-card__stats' });
    for (const row of card.stats) table.appendChild(statRow(row));
    root.appendChild(table);

    return root;
}

export class PowerChoiceOverlay {
    private modal: ModalController | null = null;
    private onClosed: () => void = () => {};

    constructor(private parent: HTMLElement) {}

    public show(cards: PowerCard[], onCancel: () => void, onClosed: () => void): void {
        this.close();

        this.onClosed = onClosed;

        // The power cards carry a full stat table, so the default 680px panel
        // wrapped the third card onto its own row. Widen only this modal.
        const modal = makeModal({ title: t('power.chooseTitle'), panelClass: 'modal-panel--powers' });

        const choices = el('div', { class: 'modal-choices modal-choices--powers' });
        for (const card of cards) {
            const kindCfg = KIND_CONFIG[card.kind];
            const isElementPower = card.kind === 'power' && card.element;
            const accent = isElementPower ? elementColor(card.element) : kindCfg.accent;
            const icon   = isElementPower ? elementIcon(card.element) : kindCfg.icon;

            choices.appendChild(makePowerCard(card, accent, icon, kindCfg.kindLabel, () => {
                card.onPick();
                this.close();
            }));
        }
        modal.body.appendChild(choices);

        const skipBtn = makeButton({
            label: t('common.skip'),
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
