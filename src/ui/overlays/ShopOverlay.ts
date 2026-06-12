import { makeModal, ModalController } from '../primitives/Modal';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { onTap } from '../interaction';
import { EquipSlot, ItemDef, Rarity, RARITY_COLOR } from '../../survivors/items/ItemTypes';
import { GRIBBLE_NAME } from '../../survivors/shop/GribbleBarks';

export interface ShopCardVM {
    def: ItemDef;
    price: number;
    affordable: boolean;
    /** Name of the piece currently in that slot (sell-back hint), if any. */
    replaces: string | null;
    sellCredit: number;
    /** e.g. "Goblin Fortune 2/3" when the item belongs to a set. */
    setProgress: string | null;
    /** Human-readable stat lines, e.g. "+20% basic damage". */
    statLines: string[];
    /** Unique-effect / set-bonus text, if any. */
    effectText: string | null;
}

export interface ShopEquipVM {
    slot: EquipSlot;
    name: string | null;
    glyph: string | null;
    rarity: Rarity | null;
}

export interface ShopVM {
    gold: number;
    cards: ShopCardVM[];
    equipment: ShopEquipVM[];
    rerollCost: number;
    rerollAffordable: boolean;
    quip: string;
}

export interface ShopCallbacks {
    /** Buy the card at `index` in the current VM. */
    onBuy(index: number): void;
    onReroll(): void;
    /** Close shop AND start the next wave. */
    onBattle(): void;
    /** Closed without battle (walked away / X) — game unpauses, merchant stays. */
    onClosed(): void;
}

const SLOT_LABEL: Record<EquipSlot, string> = {
    weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest',
    legs: 'Legs', boots: 'Boots', trinket: 'Trinket',
};
const SLOT_GLYPH: Record<EquipSlot, string> = {
    weapon: '⚔', helmet: '🪖', chest: '🛡', legs: '🦵', boots: '👢', trinket: '📿',
};

/** Gribble's shop — a DUMB overlay: renders a `ShopVM` and forwards clicks.
    All gold math, stock state and equipment live in the gameplay state. */
export class ShopOverlay {
    private modal: ModalController | null = null;
    private callbacks: ShopCallbacks | null = null;
    private quipEl: HTMLDivElement | null = null;
    private goldEl: HTMLDivElement | null = null;
    private gridEl: HTMLDivElement | null = null;
    private equipEl: HTMLDivElement | null = null;
    private rerollBtn: HTMLDivElement | null = null;

    constructor(private parent: HTMLElement) {}

    public show(vm: ShopVM, callbacks: ShopCallbacks): void {
        this.closeSilently();
        this.callbacks = callbacks;

        const modal = makeModal({
            title: `${GRIBBLE_NAME}'s Traveling Emporium`,
            panelClass: 'modal-panel--shop',
        });

        // Header: quip + gold
        this.quipEl = el('div', { class: 'shop-quip' });
        this.goldEl = el('div', { class: 'shop-gold' });
        modal.body.appendChild(el('div', { class: 'shop-header' }, [this.quipEl, this.goldEl]));

        // Stock grid + equipment strip (filled in refresh)
        this.gridEl = el('div', { class: 'shop-grid' });
        this.equipEl = el('div', { class: 'shop-equip' });
        modal.body.append(this.gridEl, this.equipEl);

        // Footer: reroll + leave + battle
        this.rerollBtn = makeButton({
            label: '', variant: 'ghost', class: 'shop-reroll',
            onClick: () => this.callbacks?.onReroll(),
        });
        const leave = makeButton({
            label: 'Leave', variant: 'ghost',
            onClick: () => this.close(),
        });
        const battle = makeButton({
            label: '⚔ To battle!', variant: 'forged', class: 'shop-battle',
            onClick: () => { this.callbacks?.onBattle(); },
        });
        modal.body.appendChild(el('div', { class: 'shop-footer' }, [this.rerollBtn, leave, battle]));

        this.parent.appendChild(modal.root);
        this.modal = modal;
        this.refresh(vm);
    }

    /** Re-render the dynamic parts after a buy/reroll. */
    public refresh(vm: ShopVM): void {
        if (!this.modal) return;
        this.setQuip(vm.quip);
        this.goldEl!.textContent = `🪙 ${vm.gold}`;

        this.gridEl!.replaceChildren();
        vm.cards.forEach((card, index) => {
            this.gridEl!.appendChild(this.buildCard(card, index));
        });

        this.equipEl!.replaceChildren();
        for (const eq of vm.equipment) {
            const cell = el('div', { class: `shop-equip__cell${eq.name ? '' : ' shop-equip__cell--empty'}` });
            if (eq.rarity) cell.style.setProperty('--accent', RARITY_COLOR[eq.rarity]);
            cell.append(
                el('div', { class: 'shop-equip__glyph', text: eq.glyph ?? SLOT_GLYPH[eq.slot] }),
                el('div', { class: 'shop-equip__slot', text: SLOT_LABEL[eq.slot] }),
                el('div', { class: 'shop-equip__name', text: eq.name ?? '—' }),
            );
            this.equipEl!.appendChild(cell);
        }

        this.rerollBtn!.textContent = `🎲 Reroll (${vm.rerollCost}g)`;
        this.rerollBtn!.classList.toggle('shop-reroll--poor', !vm.rerollAffordable);
    }

    public setQuip(text: string): void {
        if (this.quipEl) this.quipEl.textContent = `“${text}”`;
    }

    private buildCard(card: ShopCardVM, index: number): HTMLDivElement {
        const root = el('div', {
            class: `shop-card shop-card--${card.def.rarity}${card.affordable ? '' : ' shop-card--poor'}`,
        });
        root.style.setProperty('--accent', RARITY_COLOR[card.def.rarity]);
        root.append(
            el('div', { class: 'shop-card__kind', text: `${card.def.rarity} · ${SLOT_LABEL[card.def.slot]}` }),
            el('div', { class: 'shop-card__emblem', text: card.def.glyph }),
            el('div', { class: 'shop-card__name', text: card.def.name }),
        );
        for (const line of card.statLines) {
            root.appendChild(el('div', { class: 'shop-card__stat', text: line }));
        }
        if (card.effectText) {
            root.appendChild(el('div', { class: 'shop-card__effect', text: card.effectText }));
        }
        if (card.setProgress) {
            root.appendChild(el('div', { class: 'shop-card__set', text: card.setProgress }));
        }
        if (card.replaces) {
            root.appendChild(el('div', {
                class: 'shop-card__replaces',
                text: `Replaces ${card.replaces} (+${card.sellCredit}g back)`,
            }));
        }
        root.appendChild(el('div', { class: 'shop-card__flavor', text: card.def.flavor }));
        root.appendChild(el('div', { class: 'shop-card__price', text: `🪙 ${card.price}` }));
        onTap(root, () => this.callbacks?.onBuy(index));
        return root;
    }

    /** Close without firing onClosed (internal re-show). */
    private closeSilently(): void {
        this.modal?.dispose();
        this.modal = null;
        this.quipEl = null;
        this.goldEl = null;
        this.gridEl = null;
        this.equipEl = null;
        this.rerollBtn = null;
    }

    public close(): void {
        if (!this.modal) return;
        this.closeSilently();
        const cb = this.callbacks;
        this.callbacks = null;
        cb?.onClosed();
    }

    public isOpen(): boolean {
        return this.modal !== null;
    }
}
