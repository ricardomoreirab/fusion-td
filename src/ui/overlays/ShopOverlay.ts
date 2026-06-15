import { makeModal, ModalController } from '../primitives/Modal';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { onTap } from '../interaction';
import { ItemDef, RARITY_COLOR } from '../../survivors/items/ItemTypes';
import { GRIBBLE_NAME } from '../../survivors/shop/GribbleBarks';
import { SLOT_LABEL } from './slotMeta';

export interface ShopCardVM {
    def: ItemDef;
    /** Shop upgrade level this for-sale copy represents (drives the +N badge). */
    itemLevel: number;
    price: number;
    affordable: boolean;
    /** Already bought this visit — renders as a locked "Sold" tile in place. */
    sold: boolean;
    /** Name of the piece currently in that slot (sell-back + comparison), if any. */
    replaces: string | null;
    sellCredit: number;
    /** e.g. "Goblin Fortune 2/3" when the item belongs to a set. */
    setProgress: string | null;
    /** Stat lines of the FOR-SALE item, e.g. "+20% basic damage". */
    statLines: string[];
    /** Unique-effect / set-bonus text of the for-sale item, if any. */
    effectText: string | null;
    /** Stat lines of the CURRENTLY-EQUIPPED piece in this slot (comparison). */
    equippedStatLines: string[];
    /** Unique-effect text of the currently-equipped piece, if any. */
    equippedEffectText: string | null;
}

export interface PotionCardVM {
    id: string;
    name: string;
    desc: string;
    glyph: string;
    price: number;
    affordable: boolean;
    /** Already bought for the upcoming wave (one per wave). */
    active: boolean;
}

export interface ShopVM {
    gold: number;
    cards: ShopCardVM[];
    potions: PotionCardVM[];
    rerollCost: number;
    rerollAffordable: boolean;
    /** Current shop upgrade level (0 = base). */
    shopLevel: number;
    /** Gold to raise the shop to shopLevel+1. */
    upgradeCost: number;
    upgradeAffordable: boolean;
    quip: string;
}

export interface ShopCallbacks {
    /** Buy the card at `index` in the current VM. */
    onBuy(index: number): void;
    /** Buy the single-wave potion with the given id. */
    onBuyPotion(id: string): void;
    onReroll(): void;
    /** Raise the shop upgrade level by one. */
    onUpgrade(): void;
    /** Close shop AND start the next wave. */
    onBattle(): void;
    /** Modal torn down (after "To battle!") — game unpauses. */
    onClosed(): void;
}

/** Gribble's shop — a DUMB overlay: renders a `ShopVM` and forwards clicks.
    All gold math, stock state and equipment live in the gameplay state. The
    goblin portrait is an opaque element built by the state (Babylon-backed)
    and mounted here; the overlay never touches Babylon itself. Equipment now
    lives on the HUD/character-profile — the shop only COMPARES against it. */
export class ShopOverlay {
    private modal: ModalController | null = null;
    private callbacks: ShopCallbacks | null = null;
    private bubbleEl: HTMLDivElement | null = null;
    private portraitMount: HTMLDivElement | null = null;
    private goldEl: HTMLDivElement | null = null;
    private gridEl: HTMLDivElement | null = null;
    private potionRowEl: HTMLDivElement | null = null;
    private rerollBtn: HTMLDivElement | null = null;
    private upgradeBtn: HTMLDivElement | null = null;
    private shopLevelEl: HTMLDivElement | null = null;

    constructor(private parent: HTMLElement) {}

    /** @param portraitEl optional Babylon-backed goblin portrait to mount in the
        side column (the state supplies `GoblinPortrait.element`). */
    public show(vm: ShopVM, callbacks: ShopCallbacks, portraitEl?: HTMLElement | null): void {
        this.closeSilently();
        this.callbacks = callbacks;

        const modal = makeModal({
            title: `${GRIBBLE_NAME}'s Traveling Emporium`,
            panelClass: 'modal-panel--shop',
        });

        // ── Left column: Gribble's speech bubble + his live portrait ──
        this.bubbleEl = el('div', { class: 'shop-bubble' });
        this.portraitMount = el('div', { class: 'shop-portrait-mount' });
        if (portraitEl) this.portraitMount.appendChild(portraitEl);
        const portraitCol = el('div', { class: 'shop-portrait-col' }, [this.bubbleEl, this.portraitMount]);

        // ── Right column: gold bar + fixed 3×2 stock grid ──
        this.goldEl = el('div', { class: 'shop-gold' });
        this.shopLevelEl = el('div', { class: 'shop-level' });
        const topbar = el('div', { class: 'shop-topbar' }, [this.goldEl, this.shopLevelEl]);
        this.gridEl = el('div', { class: 'shop-grid' });
        // Dedicated single-wave potion row — always available, separate from gear stock.
        this.potionRowEl = el('div', { class: 'shop-potions' });
        const mainCol = el('div', { class: 'shop-main-col' }, [topbar, this.gridEl, this.potionRowEl]);

        modal.body.appendChild(el('div', { class: 'shop-body' }, [portraitCol, mainCol]));

        // Footer: reroll + battle (no "Leave" — the shop is modal until battle).
        this.rerollBtn = makeButton({
            label: '', variant: 'ghost', class: 'shop-reroll',
            onClick: () => this.callbacks?.onReroll(),
        });
        this.upgradeBtn = makeButton({
            label: '', variant: 'ghost', class: 'shop-upgrade',
            onClick: () => this.callbacks?.onUpgrade(),
        });
        const battle = makeButton({
            label: '⚔ To battle!', variant: 'forged', class: 'shop-battle',
            onClick: () => { this.callbacks?.onBattle(); },
        });
        modal.body.appendChild(el('div', { class: 'shop-footer' }, [this.rerollBtn, this.upgradeBtn, battle]));

        this.parent.appendChild(modal.root);
        this.modal = modal;
        this.refresh(vm);
    }

    /** Re-render the dynamic parts after a buy/reroll. Card positions are FIXED:
        a bought card stays in place as a "Sold" tile, never reflowing. */
    public refresh(vm: ShopVM): void {
        if (!this.modal) return;
        this.setQuip(vm.quip);
        this.goldEl!.textContent = `🪙 ${vm.gold}`;

        this.gridEl!.replaceChildren();
        vm.cards.forEach((card, index) => {
            this.gridEl!.appendChild(this.buildCard(card, index));
        });

        if (this.potionRowEl) {
            this.potionRowEl.replaceChildren();
            for (const p of vm.potions) this.potionRowEl.appendChild(this.buildPotionCard(p));
        }

        this.rerollBtn!.textContent = `🎲 Reroll (${vm.rerollCost}g)`;
        this.rerollBtn!.classList.toggle('shop-reroll--poor', !vm.rerollAffordable);
        this.shopLevelEl!.textContent = `Shop +${vm.shopLevel}`;
        this.upgradeBtn!.textContent = `⬆ Upgrade → +${vm.shopLevel + 1} (${vm.upgradeCost}g)`;
        this.upgradeBtn!.classList.toggle('shop-upgrade--poor', !vm.upgradeAffordable);
    }

    public setQuip(text: string): void {
        if (this.bubbleEl) this.bubbleEl.textContent = `“${text}”`;
    }

    private buildCard(card: ShopCardVM, index: number): HTMLDivElement {
        const poor = !card.affordable && !card.sold;
        const root = el('div', {
            class: `shop-card shop-card--${card.def.rarity}`
                + (poor ? ' shop-card--poor' : '')
                + (card.sold ? ' shop-card--sold' : ''),
        });
        root.style.setProperty('--accent', RARITY_COLOR[card.def.rarity]);
        root.append(
            el('div', { class: 'shop-card__kind', text: `${card.def.rarity} · ${SLOT_LABEL[card.def.slot]}` }),
            el('div', { class: 'shop-card__emblem', text: card.def.glyph }),
            el('div', { class: 'shop-card__name', text: card.def.name }),
        );
        if (card.itemLevel > 0) {
            root.appendChild(el('div', { class: 'shop-card__plus', text: `+${card.itemLevel}` }));
        }
        for (const line of card.statLines) {
            root.appendChild(el('div', { class: 'shop-card__stat', text: line }));
        }
        if (card.effectText) {
            root.appendChild(el('div', { class: 'shop-card__effect', text: card.effectText }));
        }
        if (card.setProgress) {
            root.appendChild(el('div', { class: 'shop-card__set', text: card.setProgress }));
        }

        root.appendChild(el('div', { class: 'shop-card__flavor', text: card.def.flavor }));
        root.appendChild(el('div', { class: 'shop-card__price', text: card.sold ? 'SOLD' : `🪙 ${card.price}` }));

        // Comparison vs the currently-equipped piece — an OVERLAY shown on hover
        // (pointer-events:none, absolute inset) so the card layout never changes.
        root.appendChild(this.buildCompareOverlay(card));

        if (!card.sold) onTap(root, () => this.callbacks?.onBuy(index));
        return root;
    }

    private buildPotionCard(p: PotionCardVM): HTMLDivElement {
        const poor = !p.affordable && !p.active;
        const root = el('div', {
            class: 'shop-potion'
                + (poor ? ' shop-potion--poor' : '')
                + (p.active ? ' shop-potion--active' : ''),
        });
        root.append(
            el('div', { class: 'shop-potion__glyph', text: p.glyph }),
            el('div', { class: 'shop-potion__name', text: p.name }),
            el('div', { class: 'shop-potion__desc', text: p.desc }),
            el('div', { class: 'shop-potion__price', text: p.active ? 'ACTIVE' : `🪙 ${p.price}` }),
        );
        if (!p.active) onTap(root, () => this.callbacks?.onBuyPotion(p.id));
        return root;
    }

    private buildCompareOverlay(card: ShopCardVM): HTMLDivElement {
        const cmp = el('div', { class: 'shop-card__compare' });
        cmp.appendChild(el('div', { class: 'shop-card__compare-title', text: 'Currently equipped' }));
        if (card.replaces) {
            cmp.appendChild(el('div', { class: 'shop-card__compare-head', text: card.replaces }));
            for (const line of card.equippedStatLines) {
                cmp.appendChild(el('div', { class: 'shop-card__compare-stat', text: line }));
            }
            if (card.equippedEffectText) {
                cmp.appendChild(el('div', { class: 'shop-card__compare-effect', text: card.equippedEffectText }));
            }
            cmp.appendChild(el('div', { class: 'shop-card__compare-credit', text: `+${card.sellCredit}g back if replaced` }));
        } else {
            cmp.appendChild(el('div', { class: 'shop-card__compare-stat', text: 'Empty — nothing equipped' }));
        }
        return cmp;
    }

    /** Close without firing onClosed (internal re-show). */
    private closeSilently(): void {
        this.modal?.dispose();
        this.modal = null;
        this.bubbleEl = null;
        this.portraitMount = null;
        this.goldEl = null;
        this.gridEl = null;
        this.potionRowEl = null;
        this.rerollBtn = null;
        this.upgradeBtn = null;
        this.shopLevelEl = null;
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
