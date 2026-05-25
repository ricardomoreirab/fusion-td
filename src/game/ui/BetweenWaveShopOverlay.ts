import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { getLayoutMode, getRenderWidth, isNarrowHeight } from './responsive';
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';

export interface ShopItem {
    id: string;
    name: string;
    description: string;
    baseCost: number;
    costGrowth: number;
    isCapped: (count: number) => boolean;
    apply: () => void;
}

// ── Per-item visual config ────────────────────────────────────────────────────
const ITEM_CONFIG: Record<string, { glyph: string; accentColor: string }> = {
    vitality:  { glyph: '♥',  accentColor: '#e03030' },
    swiftness: { glyph: '➤',  accentColor: '#30cfff' },
    reach:     { glyph: '⤢',  accentColor: '#b050ff' },
    power:     { glyph: '✦',  accentColor: '#ff9030' },
    haste:     { glyph: '⚡', accentColor: '#ffe040' },
    bulwark:   { glyph: '▲',  accentColor: '#60a060' },
    quickness: { glyph: '»',  accentColor: '#ffcc00' },
};

const DEFAULT_CONFIG = { glyph: '◈', accentColor: '#888888' };

export class BetweenWaveShopOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;
    private resizeObserver: (() => void) | null = null;

    // Saved args for rebuild on resize / repurchase
    private _items: ShopItem[] = [];
    private _currentGold: (() => number) | null = null;
    private _purchaseCount: ((id: string) => number) | null = null;
    private _spendGold: ((amount: number) => boolean) | null = null;
    private _onStartNextWave: (() => void) | null = null;

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

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
        this._build();

        // Rebuild on resize (only register once per show())
        this._removeResizeListener();
        const engine = this.ui.getScene()?.getEngine();
        if (engine) {
            const handler = () => {
                if (this.panel) {
                    this._build();
                }
            };
            engine.onResizeObservable.add(handler);
            this.resizeObserver = () => engine.onResizeObservable.removeCallback(handler);
        }
    }

    private _build(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
        if (!this._currentGold || !this._purchaseCount || !this._spendGold || !this._onStartNextWave) return;

        const isMobile = getLayoutMode(this.ui) === 'mobile';
        const narrow = isNarrowHeight(this.ui);
        const vw = getRenderWidth(this.ui);

        this.panel = new Rectangle('shopBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = STYLE.backdropDim;
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        if (isMobile) {
            this._buildMobileLayout(vw, narrow);
        } else {
            this._buildDesktopLayout();
        }
    }

    /** Desktop: 3×3 grid (fits 7 items) */
    private _buildDesktopLayout(): void {
        const currentGold = this._currentGold!;
        const purchaseCount = this._purchaseCount!;
        const spendGold = this._spendGold!;
        const onStartNextWave = this._onStartNextWave!;
        const items = this._items;

        // ── Item cards ────────────────────────────────────────────────────────
        items.forEach((item, i) => {
            this._buildDesktopCard(item, i, currentGold, purchaseCount, spendGold, items, onStartNextWave);
        });

        // ── Start next wave button ────────────────────────────────────────────
        const startBtn = makeFrame({ name: 'skipBtn', sizePx: 260, color: '#888', cornerRadius: 10 });
        startBtn.height = '44px';
        startBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        startBtn.top = '-12px';
        const startBtnLabel = new TextBlock('skipBtnLabel', 'Start Next Wave  →');
        startBtnLabel.color = '#fff';
        startBtnLabel.fontSize = 17;
        startBtnLabel.fontWeight = 'bold';
        startBtn.addControl(startBtnLabel);
        addPressFeedback(startBtn, () => {
            this.close();
            onStartNextWave();
        });
        this.panel!.addControl(startBtn);
    }

    private _buildDesktopCard(
        item: ShopItem,
        i: number,
        currentGold: () => number,
        purchaseCount: (itemId: string) => number,
        spendGold: (amount: number) => boolean,
        items: ShopItem[],
        onStartNextWave: () => void,
    ): void {
        const count = purchaseCount(item.id);
        const capped = item.isCapped(count);
        const cost = capped ? 0 : Math.ceil(item.baseCost * Math.pow(item.costGrowth, count));
        const canAfford = capped || currentGold() >= cost;

        const cfg = ITEM_CONFIG[item.id] ?? DEFAULT_CONFIG;
        const accentColor = capped ? '#555' : cfg.accentColor;

        // 3-column grid layout
        const col = i % 3;
        const row = Math.floor(i / 3);
        const offsetX = (col - 1) * 232;
        const offsetY = (row - 1) * 96 - 20;

        // ── Outer card ───────────────────────────────────────────────────────
        const outer = makeFrame({ name: `shopOuter_${item.id}`, sizePx: 220, color: capped ? '#444' : accentColor, cornerRadius: 12 });
        outer.height = '88px';
        if (capped) outer.background = 'rgba(10,10,22,0.40)';
        outer.left = `${offsetX}px`;
        outer.top = `${offsetY}px`;
        outer.isPointerBlocker = true;
        this.panel!.addControl(outer);

        // ── Header strip (left accent bar + glyph) ───────────────────────────
        const headerBar = new Rectangle(`shopHeader_${item.id}`);
        headerBar.width = '44px';
        headerBar.height = '88px';
        headerBar.thickness = 0;
        headerBar.background = capped ? '#222' : accentColor + '55';
        headerBar.cornerRadius = 8;
        headerBar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        outer.addControl(headerBar);

        const glyphTxt = new TextBlock(`shopGlyph_${item.id}`, cfg.glyph);
        glyphTxt.color = capped ? '#555' : accentColor;
        glyphTxt.fontSize = 22;
        headerBar.addControl(glyphTxt);

        // ── Inner content ────────────────────────────────────────────────────
        const inner = new Rectangle(`shopInner_${item.id}`);
        inner.width = '168px';
        inner.height = '72px';
        inner.thickness = 0;
        inner.background = 'transparent';
        inner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        outer.addControl(inner);

        // Item name + level
        const nameLabel = new TextBlock(`shopName_${item.id}`, '');
        if (capped) {
            nameLabel.text = `${item.name}  (MAX)`;
        } else {
            nameLabel.text = `${item.name}  Lv ${count} → ${count + 1}`;
        }
        nameLabel.color = capped ? '#555' : '#ffffff';
        nameLabel.fontSize = 14;
        nameLabel.fontWeight = 'bold';
        nameLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        nameLabel.paddingLeft = '10px';
        nameLabel.top = '-22px';
        nameLabel.height = '20px';
        inner.addControl(nameLabel);

        // Description
        const descLabel = new TextBlock(`shopDesc_${item.id}`, item.description);
        descLabel.color = '#aaa';
        descLabel.fontSize = 12;
        descLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        descLabel.textWrapping = true;
        descLabel.paddingLeft = '10px';
        descLabel.paddingRight = '8px';
        descLabel.top = '5px';
        descLabel.height = '30px';
        inner.addControl(descLabel);

        // Cost display
        if (!capped) {
            const costLabel = new TextBlock(`shopCost_${item.id}`, `◯ ${cost}`);
            costLabel.color = canAfford ? '#ffd700' : '#e04040';
            costLabel.fontSize = 14;
            costLabel.fontWeight = 'bold';
            costLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            costLabel.paddingRight = '10px';
            costLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            costLabel.paddingBottom = '8px';
            costLabel.height = '20px';
            inner.addControl(costLabel);
        }

        // ── Hover / click feedback ────────────────────────────────────────────
        if (!capped) {
            outer.onPointerEnterObservable.add(() => {
                outer.color = canAfford ? '#ffffff' : '#e04040';
            });
            outer.onPointerOutObservable.add(() => {
                outer.color = accentColor;
            });
            addPressFeedback(outer, () => {
                if (capped) return;
                if (!spendGold(cost)) return;
                item.apply();
                // Re-build with updated values
                this._build();
            });
        }
    }

    /**
     * Mobile: single-column stack of 6 cards.
     * Card width clamps to min(320, viewportWidth - 40).
     * On very short viewports (NARROW_HEIGHT < 500) card height shrinks to 80px.
     */
    private _buildMobileLayout(vw: number, narrow: boolean): void {
        const currentGold = this._currentGold!;
        const purchaseCount = this._purchaseCount!;
        const spendGold = this._spendGold!;
        const onStartNextWave = this._onStartNextWave!;
        const items = this._items;

        const cardW = Math.min(320, vw - 40);
        const cardH = narrow ? 80 : 90;
        const gap = 8;

        // Title — top-anchored
        const title = new TextBlock('shopTitle', 'Wave Complete — Shop');
        title.color = '#fff';
        title.fontSize = 20;
        title.fontWeight = 'bold';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        title.top = '14px';
        title.height = '28px';
        this.panel!.addControl(title);

        // Gold display — below title
        const goldLabel = new TextBlock('shopGold', `◯ ${currentGold()} gold`);
        goldLabel.color = '#ffd700';
        goldLabel.fontSize = 16;
        goldLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        goldLabel.top = '46px';
        goldLabel.height = '22px';
        this.panel!.addControl(goldLabel);

        // Stack cards centered (with top offset accounting for title area ~80px)
        const total = items.length;
        const stackH = total * cardH + (total - 1) * gap;
        // Shift down from center to leave room at top for title (approx)
        const stackCenter = 30; // slight downward offset
        const stackTop = stackCenter - stackH / 2;

        items.forEach((item, i) => {
            const count = purchaseCount(item.id);
            const capped = item.isCapped(count);
            const cost = capped ? 0 : Math.ceil(item.baseCost * Math.pow(item.costGrowth, count));
            const canAfford = capped || currentGold() >= cost;
            const cfg = ITEM_CONFIG[item.id] ?? DEFAULT_CONFIG;
            const accentColor = capped ? '#555' : cfg.accentColor;

            const topY = stackTop + i * (cardH + gap);

            // ── Outer card ─────────────────────────────────────────────────
            const outer = makeFrame({ name: `shopOuter_${item.id}`, sizePx: cardW, color: capped ? '#444' : accentColor, cornerRadius: 12 });
            outer.height = `${cardH}px`;
            if (capped) outer.background = 'rgba(10,10,22,0.40)';
            outer.top = `${topY}px`;
            outer.isPointerBlocker = true;
            this.panel!.addControl(outer);

            // ── Left accent strip + glyph ──────────────────────────────────
            const headerBar = new Rectangle(`shopHeader_${item.id}`);
            headerBar.width = `${cardH}px`; // square strip on left
            headerBar.height = `${cardH}px`;
            headerBar.thickness = 0;
            headerBar.background = capped ? '#222' : accentColor + '44';
            headerBar.cornerRadius = 6;
            headerBar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            outer.addControl(headerBar);

            const glyphTxt = new TextBlock(`shopGlyph_${item.id}`, cfg.glyph);
            glyphTxt.color = capped ? '#555' : accentColor;
            glyphTxt.fontSize = 20;
            headerBar.addControl(glyphTxt);

            // ── Inner content ──────────────────────────────────────────────
            const inner = new Rectangle(`shopInner_${item.id}`);
            inner.width = `${cardW - cardH - 4}px`;
            inner.height = `${cardH - 8}px`;
            inner.thickness = 0;
            inner.background = 'transparent';
            inner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            inner.paddingRight = '8px';
            outer.addControl(inner);

            // Item name + level
            const nameLabel = new TextBlock(`shopName_${item.id}`, '');
            if (capped) {
                nameLabel.text = `${item.name}  (MAX)`;
            } else {
                nameLabel.text = `${item.name}  Lv ${count}→${count + 1}`;
            }
            nameLabel.color = capped ? '#555' : '#ffffff';
            nameLabel.fontSize = narrow ? 12 : 13;
            nameLabel.fontWeight = 'bold';
            nameLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            nameLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            nameLabel.top = '8px';
            nameLabel.height = '18px';
            inner.addControl(nameLabel);

            // Description — show only if not narrow
            if (!narrow) {
                const descLabel = new TextBlock(`shopDesc_${item.id}`, item.description);
                descLabel.color = '#999';
                descLabel.fontSize = 11;
                descLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                descLabel.textWrapping = true;
                descLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                descLabel.top = '28px';
                descLabel.height = '26px';
                descLabel.width = `${cardW - cardH - 12}px`;
                inner.addControl(descLabel);
            }

            // Cost
            if (!capped) {
                const costLabel = new TextBlock(`shopCost_${item.id}`, `◯ ${cost}`);
                costLabel.color = canAfford ? '#ffd700' : '#e04040';
                costLabel.fontSize = 13;
                costLabel.fontWeight = 'bold';
                costLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
                costLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                costLabel.paddingBottom = '6px';
                costLabel.height = '18px';
                inner.addControl(costLabel);
            }

            // ── Hover / click ──────────────────────────────────────────────
            if (!capped) {
                outer.onPointerEnterObservable.add(() => {
                    outer.color = canAfford ? '#ffffff' : '#e04040';
                });
                outer.onPointerOutObservable.add(() => {
                    outer.color = accentColor;
                });
                addPressFeedback(outer, () => {
                    if (capped) return;
                    if (!spendGold(cost)) return;
                    item.apply();
                    this._build();
                });
            }
        });

        // Start next wave button — pinned to bottom
        const startBtn = makeFrame({ name: 'skipBtn', sizePx: Math.min(260, cardW), color: '#888', cornerRadius: 10 });
        startBtn.height = '48px';
        startBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        startBtn.top = '-16px';
        const startBtnLabel = new TextBlock('skipBtnLabel', 'Start Next Wave  →');
        startBtnLabel.color = '#fff';
        startBtnLabel.fontSize = 15;
        startBtnLabel.fontWeight = 'bold';
        startBtn.addControl(startBtnLabel);
        addPressFeedback(startBtn, () => {
            this.close();
            onStartNextWave();
        });
        this.panel!.addControl(startBtn);
    }

    private _removeResizeListener(): void {
        if (this.resizeObserver) {
            this.resizeObserver();
            this.resizeObserver = null;
        }
    }

    public close(): void {
        this._removeResizeListener();
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }

    public isOpen(): boolean {
        return this.panel !== null;
    }
}
