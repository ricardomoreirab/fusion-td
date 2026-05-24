import { AdvancedDynamicTexture, Rectangle, TextBlock, Button, Control } from '@babylonjs/gui';

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
    magnetism: { glyph: '◯',  accentColor: '#b050ff' },
    power:     { glyph: '✦',  accentColor: '#ff9030' },
    haste:     { glyph: '⚡', accentColor: '#ffe040' },
    bulwark:   { glyph: '▲',  accentColor: '#60a060' },
};

const DEFAULT_CONFIG = { glyph: '◈', accentColor: '#888888' };

export class BetweenWaveShopOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;

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
        this.close();

        this.panel = new Rectangle('shopBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.90)';
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        // ── Title ─────────────────────────────────────────────────────────────
        const title = new TextBlock('shopTitle', 'Wave Complete — Upgrade Shop');
        title.color = '#fff';
        title.fontSize = 26;
        title.fontWeight = 'bold';
        title.top = '-280px';
        title.height = '36px';
        this.panel.addControl(title);

        // ── Gold display ─────────────────────────────────────────────────────
        const goldLabel = new TextBlock('shopGold', `◯ ${currentGold()} gold`);
        goldLabel.color = '#ffd700';
        goldLabel.fontSize = 20;
        goldLabel.top = '-238px';
        goldLabel.height = '28px';
        this.panel.addControl(goldLabel);

        // ── Item cards ────────────────────────────────────────────────────────
        items.forEach((item, i) => {
            this.buildCard(item, i, currentGold, purchaseCount, spendGold, items, onStartNextWave);
        });

        // ── Start next wave button ────────────────────────────────────────────
        const startBtn = Button.CreateSimpleButton('shopStart', 'Start Next Wave  →');
        startBtn.width = '260px';
        startBtn.height = '52px';
        startBtn.background = '#3a7a3a';
        startBtn.color = '#fff';
        startBtn.cornerRadius = 10;
        startBtn.thickness = 2;
        startBtn.fontWeight = 'bold';
        startBtn.fontSize = 17;
        startBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        startBtn.top = '-28px';
        startBtn.onPointerClickObservable.add(() => {
            this.close();
            onStartNextWave();
        });
        this.panel.addControl(startBtn);
    }

    private buildCard(
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

        // 2-column grid layout (same as before)
        const col = i % 2;
        const row = Math.floor(i / 2);
        const offsetX = (col - 0.5) * 340;
        const offsetY = (row - 1) * 110;

        // ── Outer card ───────────────────────────────────────────────────────
        const outer = new Rectangle(`shopOuter_${item.id}`);
        outer.width = '320px';
        outer.height = '100px';
        outer.cornerRadius = 10;
        outer.thickness = 2;
        outer.color = capped ? '#444' : accentColor;
        outer.background = capped ? '#111' : '#0d1020';
        outer.left = `${offsetX}px`;
        outer.top = `${offsetY}px`;
        outer.isPointerBlocker = true;
        this.panel!.addControl(outer);

        // ── Header strip (left accent bar + glyph) ───────────────────────────
        const headerBar = new Rectangle(`shopHeader_${item.id}`);
        headerBar.width = '44px';
        headerBar.height = '100px';
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
        inner.width = '268px';
        inner.height = '84px';
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
                outer.scaleX = 1.03;
                outer.scaleY = 1.03;
                outer.color = canAfford ? '#ffffff' : '#e04040';
            });
            outer.onPointerOutObservable.add(() => {
                outer.scaleX = 1.0;
                outer.scaleY = 1.0;
                outer.color = accentColor;
            });
            outer.onPointerClickObservable.add(() => {
                if (capped) return;
                if (!spendGold(cost)) return;
                item.apply();
                // Re-open with updated values
                this.show(items, currentGold, purchaseCount, spendGold, onStartNextWave);
            });
        }
    }

    public close(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }

    public isOpen(): boolean {
        return this.panel !== null;
    }
}
