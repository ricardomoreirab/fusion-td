import { makeModal, ModalController } from '../primitives/Modal';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { onTap } from '../interaction';

export interface ShopItem {
    id: string;
    name: string;
    description: string;
    baseCost: number;
    costGrowth: number;
    isCapped: (count: number) => boolean;
    apply: () => void;
    /**
     * Optional accessor for a "current value → next value" string that gets
     * appended to the description so the player can see what they own right now
     * (e.g., "now 120 → 140"). Returning null hides the suffix.
     */
    currentValue?: () => string | null;
}

// ── Per-item visual config (verbatim from legacy) ─────────────────────────────
const ITEM_CONFIG: Record<string, { glyph: string; accentColor: string }> = {
    vitality:  { glyph: '♥',  accentColor: '#e03030' },
    swiftness: { glyph: '➤',  accentColor: '#30cfff' },
    reach:     { glyph: '⤢',  accentColor: '#b050ff' },
    power:     { glyph: '✦',  accentColor: '#ff9030' },
    haste:     { glyph: '⚡', accentColor: '#ffe040' },
    bulwark:   { glyph: '▲',  accentColor: '#60a060' },
    precision: { glyph: '◎',  accentColor: '#ffe680' },
    savagery:  { glyph: '✸',  accentColor: '#ff8040' },
};

const DEFAULT_CONFIG = { glyph: '◈', accentColor: '#888888' };

export class BetweenWaveShopOverlay {
    private modal: ModalController | null = null;

    // Saved args for re-render on purchase
    private _items: ShopItem[] = [];
    private _currentGold: (() => number) | null = null;
    private _purchaseCount: ((id: string) => number) | null = null;
    private _spendGold: ((amount: number) => boolean) | null = null;
    private _onStartNextWave: (() => void) | null = null;

    constructor(private parent: HTMLElement) {}

    public show(
        items: ShopItem[],
        currentGold: () => number,
        purchaseCount: (itemId: string) => number,
        spendGold: (amount: number) => boolean,
        onStartNextWave: () => void,
    ): void {
        this._items = items;
        this._currentGold = currentGold;
        this._purchaseCount = purchaseCount;
        this._spendGold = spendGold;
        this._onStartNextWave = onStartNextWave;

        this.close();

        const modal = makeModal({ title: 'Armory', panelClass: 'modal-panel--shop' });
        this.modal = modal;
        this.parent.appendChild(modal.root);

        this._render();
    }

    private _render(): void {
        if (!this.modal) return;
        if (!this._currentGold || !this._purchaseCount || !this._spendGold || !this._onStartNextWave) return;

        const currentGold = this._currentGold;
        const purchaseCount = this._purchaseCount;
        const spendGold = this._spendGold;
        const onStartNextWave = this._onStartNextWave;
        const items = this._items;

        // Clear existing body content
        this.modal.body.replaceChildren();

        // ── Gold display ──────────────────────────────────────────────────────
        const goldDisplay = el('div', {
            class: 'shop-gold',
            text: `◯ ${currentGold()}`,
        });
        this.modal.body.appendChild(goldDisplay);

        // ── Item grid ─────────────────────────────────────────────────────────
        const grid = el('div', { class: 'shop-grid' });

        for (const item of items) {
            const count = purchaseCount(item.id);
            // Cost formula (verbatim from legacy): Math.ceil(baseCost * Math.pow(costGrowth, count))
            const capped = item.isCapped(count);
            const cost = capped ? 0 : Math.ceil(item.baseCost * Math.pow(item.costGrowth, count));
            const affordable = capped || currentGold() >= cost;

            const cfg = ITEM_CONFIG[item.id] ?? DEFAULT_CONFIG;
            const accentColor = capped ? '#555555' : cfg.accentColor;

            // ── Item card ─────────────────────────────────────────────────────
            const card = el('div', { class: 'shop-item' });
            card.style.setProperty('--accent', accentColor);
            if (capped) card.classList.add('shop-item--capped');
            else if (!affordable) card.classList.add('shop-item--unafford');

            // Left emblem strip
            const emblem = el('div', { class: 'shop-item__emblem', text: cfg.glyph });
            emblem.style.color = accentColor;

            // Right content area
            const content = el('div', { class: 'shop-item__content' });

            // Name + level
            const nameText = capped
                ? `${item.name}  (MAX)`
                : `${item.name}  Lv ${count}→${count + 1}`;
            const nameEl = el('div', { class: 'shop-item__name', text: nameText });

            // Description with optional current-value suffix
            const descText = this._describeWithCurrent(item, capped);
            const descEl = el('div', { class: 'shop-item__desc', text: descText });

            content.appendChild(nameEl);
            content.appendChild(descEl);

            // Cost line (hidden when capped)
            if (!capped) {
                const costEl = el('div', {
                    class: 'shop-item__cost',
                    text: `◯ ${cost}`,
                });
                content.appendChild(costEl);
            }

            card.appendChild(emblem);
            card.appendChild(content);

            // Click handler — no-op when capped or unaffordable
            if (!capped) {
                onTap(card, () => {
                    if (capped) return;
                    if (!spendGold(cost)) return;
                    item.apply();
                    this._render(); // re-render in place, do NOT close
                });
            }

            grid.appendChild(card);
        }

        this.modal.body.appendChild(grid);

        // ── Start Next Wave button ────────────────────────────────────────────
        const startBtn = makeButton({
            label: 'Start Next Wave  →',
            variant: 'forged',
            onClick: () => {
                this.close();
                onStartNextWave();
            },
        });
        startBtn.classList.add('shop-start-btn');
        this.modal.body.appendChild(startBtn);
    }

    /**
     * Compose the description line with an optional current-value suffix.
     * Verbatim from legacy _describeWithCurrent().
     */
    private _describeWithCurrent(item: ShopItem, capped: boolean): string {
        if (capped) return item.description;
        const cv = item.currentValue?.();
        if (!cv) return item.description;
        return `${item.description}\n${cv}`;
    }

    public close(): void {
        if (this.modal) {
            this.modal.dispose();
            this.modal = null;
        }
        // Note: close() does NOT call onStartNextWave (matches legacy behavior)
    }

    public isOpen(): boolean {
        return this.modal !== null;
    }
}
