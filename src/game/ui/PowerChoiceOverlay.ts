import { AdvancedDynamicTexture, Rectangle, TextBlock, Control, Button } from '@babylonjs/gui';

export type PowerCardKind = 'power' | 'wildcard' | 'perk';

export interface PowerCard {
    kind: PowerCardKind;
    title: string;
    subtitle: string;
    onPick: () => void;
}

export class PowerChoiceOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;
    private onClosed: () => void = () => {};

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(cards: PowerCard[], onCancel: () => void, onClosed: () => void): void {
        this.onClosed = onClosed;

        this.panel = new Rectangle('powerChoiceBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.55)';
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        const titleBar = new TextBlock('powerChoiceTitle', 'Choose a Power');
        titleBar.color = '#fff';
        titleBar.fontSize = 28;
        titleBar.top = '-220px';
        this.panel.addControl(titleBar);

        cards.forEach((card, i) => {
            const btn = this.makeCard(card, i, cards.length);
            this.panel!.addControl(btn);
        });

        const cancelBtn = Button.CreateSimpleButton('cancelOrb', 'Skip (+25 gold)');
        cancelBtn.width = '180px';
        cancelBtn.height = '44px';
        cancelBtn.color = '#ddd';
        cancelBtn.background = '#444';
        cancelBtn.cornerRadius = 8;
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cancelBtn.top = '-40px';
        cancelBtn.onPointerClickObservable.add(() => {
            onCancel();
            this.close();
        });
        this.panel.addControl(cancelBtn);
    }

    private makeCard(card: PowerCard, index: number, total: number): Button {
        const btn = Button.CreateSimpleButton(`powerCard${index}`, '');
        btn.width = '210px';
        btn.height = '280px';
        btn.cornerRadius = 12;
        btn.thickness = 2;
        btn.color = '#aaa';
        btn.background =
            card.kind === 'power'    ? '#3a2a4a' :
            card.kind === 'wildcard' ? '#2a3a4a' :
                                       '#3a3a2a';

        const gap = 230;
        const offset = (index - (total - 1) / 2) * gap;
        btn.left = `${offset}px`;

        const titleTxt = new TextBlock('cardTitle_' + index, card.title);
        titleTxt.color = '#fff';
        titleTxt.fontSize = 20;
        titleTxt.top = '-80px';
        btn.addControl(titleTxt);

        const subtitleTxt = new TextBlock('cardSub_' + index, card.subtitle);
        subtitleTxt.color = '#fc9';
        subtitleTxt.fontSize = 15;
        subtitleTxt.top = '-30px';
        btn.addControl(subtitleTxt);

        const kindTxt = new TextBlock('kindTag_' + index, card.kind.toUpperCase());
        kindTxt.color = '#888';
        kindTxt.fontSize = 12;
        kindTxt.top = '100px';
        btn.addControl(kindTxt);

        btn.onPointerClickObservable.add(() => {
            card.onPick();
            this.close();
        });
        return btn;
    }

    public close(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
        const cb = this.onClosed;
        this.onClosed = () => {};
        cb();
    }

    public isOpen(): boolean {
        return this.panel !== null;
    }
}
