import { makeModal, ModalController } from '../primitives/Modal';
import { el } from '../dom';
import { onTap } from '../interaction';
import { EquipSlot, Rarity, RARITY_COLOR } from '../../survivors/items/ItemTypes';
import { SLOT_LABEL, SLOT_GLYPH } from './slotMeta';

/** One equipment slot's display state (shared by the HUD strip + this profile). */
export interface GearSlotVM {
    slot: EquipSlot;
    name: string | null;
    glyph: string | null;
    rarity: Rarity | null;
    /** Stat lines of the equipped piece (hover tooltip). */
    statLines: string[];
    /** Unique-effect / set-bonus text of the equipped piece, if any. */
    effectText: string | null;
}

/** One aggregate-stat row, e.g. { label: 'Power Damage', value: '+25%' }. */
export interface CharStatVM { label: string; value: string; }

/** A set the player has ≥2 pieces of. */
export interface CharSetVM {
    name: string;
    count: number;
    total: number;
    tiers: { pieces: number; text: string; active: boolean }[];
}

export interface CharacterVM {
    slots: GearSlotVM[];
    stats: CharStatVM[];
    sets: CharSetVM[];
}

/** The full character sheet: paper-doll of equipped gear + aggregate stats +
    active set bonuses. A dumb renderer — the gameplay state builds the VM. */
export class CharacterProfile {
    private modal: ModalController | null = null;
    /** Shared detail pane — filled on hover/tap of a gear cell (never clips). */
    private detailEl: HTMLDivElement | null = null;

    constructor(private parent: HTMLElement) {}

    public show(vm: CharacterVM): void {
        this.closeSilently();
        const modal = makeModal({ title: 'Character', panelClass: 'modal-panel--character' });

        // Close affordances: an ✕ button + click on the scrim outside the panel.
        const closeBtn = el('div', {
            class: 'modal-close interactive', text: '✕',
            attrs: { role: 'button', 'aria-label': 'Close' },
        });
        onTap(closeBtn, () => this.close());
        modal.panel.appendChild(closeBtn);
        modal.root.addEventListener('click', (e) => { if (e.target === modal.root) this.close(); });

        // Paper-doll: the 6 equipment slots.
        const doll = el('div', { class: 'char-doll' });
        for (const slot of vm.slots) doll.appendChild(this.buildGearCell(slot));

        // Aggregate stats column.
        const statsList = el('div', { class: 'char-stats' });
        for (const s of vm.stats) {
            statsList.appendChild(el('div', { class: 'char-stat' }, [
                el('span', { class: 'char-stat__label', text: s.label }),
                el('span', { class: 'char-stat__value', text: s.value }),
            ]));
        }

        // Shared detail pane — hovering/tapping a gear cell fills this in. Sits
        // inside the panel so it can NEVER clip against the modal edge.
        this.detailEl = el('div', { class: 'char-detail' });
        const side = el('div', { class: 'char-side' }, [statsList, this.detailEl]);

        // Active set bonuses (only sets with ≥2 pieces appear).
        if (vm.sets.length > 0) {
            const setsBox = el('div', { class: 'char-sets' });
            setsBox.appendChild(el('div', { class: 'char-sets__title', text: 'Set Bonuses' }));
            for (const set of vm.sets) {
                const block = el('div', { class: 'char-set' });
                block.appendChild(el('div', { class: 'char-set__name', text: `${set.name} (${set.count}/${set.total})` }));
                for (const tier of set.tiers) {
                    block.appendChild(el('div', {
                        class: `char-set__bonus${tier.active ? ' char-set__bonus--on' : ''}`,
                        text: `${tier.pieces}pc — ${tier.text}`,
                    }));
                }
                setsBox.appendChild(block);
            }
            side.appendChild(setsBox);
        }

        modal.body.appendChild(el('div', { class: 'char-body' }, [doll, side]));

        // Default the detail pane to the first equipped piece, else a hint.
        this.showDetail(vm.slots.find(s => s.name) ?? null);

        this.parent.appendChild(modal.root);
        this.modal = modal;
    }

    private buildGearCell(slot: GearSlotVM): HTMLDivElement {
        const cell = el('div', { class: `char-slot${slot.name ? '' : ' char-slot--empty'}` });
        if (slot.rarity) cell.style.setProperty('--accent', RARITY_COLOR[slot.rarity]);
        cell.append(
            el('div', { class: 'char-slot__glyph', text: slot.glyph ?? SLOT_GLYPH[slot.slot] }),
            el('div', { class: 'char-slot__slot', text: SLOT_LABEL[slot.slot] }),
            el('div', { class: 'char-slot__name', text: slot.name ?? '—' }),
        );
        // Hover (desktop) or tap (touch) → fill the shared detail pane.
        cell.addEventListener('mouseenter', () => this.showDetail(slot));
        onTap(cell, () => this.showDetail(slot));
        return cell;
    }

    /** Render one slot's full detail into the shared pane (or a hint if null). */
    private showDetail(slot: GearSlotVM | null): void {
        const pane = this.detailEl;
        if (!pane) return;
        pane.replaceChildren();
        if (!slot || !slot.name) {
            pane.style.removeProperty('--accent');
            pane.appendChild(el('div', { class: 'char-detail__hint', text: slot ? `${SLOT_LABEL[slot.slot]} — empty` : 'Hover a slot to see its stats.' }));
            return;
        }
        pane.style.setProperty('--accent', slot.rarity ? RARITY_COLOR[slot.rarity] : 'var(--c-iron)');
        pane.appendChild(el('div', { class: 'char-detail__slot', text: SLOT_LABEL[slot.slot] }));
        pane.appendChild(el('div', { class: 'char-detail__name', text: slot.name }));
        for (const line of slot.statLines) {
            pane.appendChild(el('div', { class: 'char-detail__stat', text: line }));
        }
        if (slot.effectText) {
            pane.appendChild(el('div', { class: 'char-detail__effect', text: slot.effectText }));
        }
    }

    private closeSilently(): void {
        this.modal?.dispose();
        this.modal = null;
        this.detailEl = null;
    }

    public close(): void { this.closeSilently(); }
    public isOpen(): boolean { return this.modal !== null; }
}
