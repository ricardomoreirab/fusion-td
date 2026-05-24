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
        // Close any existing panel
        this.close();

        this.panel = new Rectangle('shopBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.88)';
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        const title = new TextBlock('shopTitle', 'Wave Complete — Shop');
        title.color = '#fff';
        title.fontSize = 26;
        title.top = '-260px';
        this.panel.addControl(title);

        const goldLabel = new TextBlock('shopGold', `Gold: ${currentGold()}`);
        goldLabel.color = '#fc9';
        goldLabel.fontSize = 20;
        goldLabel.top = '-220px';
        this.panel.addControl(goldLabel);

        items.forEach((item, i) => {
            const count = purchaseCount(item.id);
            const capped = item.isCapped(count);
            const cost = capped ? 0 : Math.ceil(item.baseCost * Math.pow(item.costGrowth, count));

            const card = Button.CreateSimpleButton(`shop_${item.id}`, '');
            card.width = '310px';
            card.height = '86px';
            card.background = capped ? '#1a1a1a' : '#2a334a';
            card.color = capped ? '#555' : '#aaa';
            card.cornerRadius = 8;
            card.thickness = 2;

            // 2 columns × 3 rows
            const col = i % 2;
            const row = Math.floor(i / 2);
            card.left = `${(col - 0.5) * 330}px`;
            card.top  = `${(row - 1) * 96}px`;

            const cardLabel = new TextBlock(`shopLabel_${item.id}`, '');
            if (capped) {
                cardLabel.text = `${item.name} (MAX)\nLv ${count}`;
            } else {
                cardLabel.text = `${item.name} — Lv ${count} → ${count + 1}\n${item.description}\nCost: ${cost} gold`;
            }
            cardLabel.color = '#fff';
            cardLabel.fontSize = 13;
            cardLabel.textWrapping = true;
            cardLabel.width = '290px';
            card.addControl(cardLabel);

            card.onPointerClickObservable.add(() => {
                if (capped) return;
                if (!spendGold(cost)) return;
                item.apply();
                // Re-open with updated values
                this.show(items, currentGold, purchaseCount, spendGold, onStartNextWave);
            });

            this.panel!.addControl(card);
        });

        const startBtn = Button.CreateSimpleButton('shopStart', 'Start Next Wave');
        startBtn.width = '240px';
        startBtn.height = '50px';
        startBtn.background = '#4a8a4a';
        startBtn.color = '#fff';
        startBtn.cornerRadius = 10;
        startBtn.thickness = 0;
        startBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        startBtn.top = '-28px';
        startBtn.onPointerClickObservable.add(() => {
            this.close();
            onStartNextWave();
        });
        this.panel.addControl(startBtn);
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
