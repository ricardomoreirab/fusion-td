import { AdvancedDynamicTexture, Rectangle, TextBlock, Button, Control } from '@babylonjs/gui';

export interface ChampionOption {
    type: string;
    name: string;
    summary: string;
    startingPower?: string;
    color: string;
}

// Class glyphs by champion type — unicode that renders well in Canvas2D
// 'knight' → ⚔, 'ranger' → 🏹, 'mage' → 🔮, fallback to a star
const CLASS_GLYPH: Record<string, string> = {
    knight:  '⚔',
    ranger:  '🏹',
    mage:    '🔮',
    warrior: '⚔',
    archer:  '🏹',
    wizard:  '🔮',
    rogue:   '✦',
};

function getClassGlyph(type: string): string {
    return CLASS_GLYPH[type.toLowerCase()] ?? '★';
}

export class ChampionSelectOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(options: ChampionOption[], onPick: (type: string) => void): void {
        // Full-screen dark backdrop
        this.panel = new Rectangle('championSelectBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.95)';
        this.panel.thickness = 0;
        this.panel.isPointerBlocker = true;
        this.ui.addControl(this.panel);

        // Title
        const title = new TextBlock('csTitle', 'CHOOSE YOUR CHAMPION');
        title.color = '#F5A623';
        title.fontSize = 38;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.top = '-240px';
        title.height = '54px';
        this.panel.addControl(title);

        const subtitle = new TextBlock('csSubtitle', 'Select a hero for this run');
        subtitle.color = '#888';
        subtitle.fontSize = 16;
        subtitle.fontFamily = 'Arial';
        subtitle.top = '-188px';
        subtitle.height = '24px';
        this.panel.addControl(subtitle);

        // Cards
        const total = options.length;
        options.forEach((opt, i) => {
            this.buildCard(opt, i, total, onPick);
        });
    }

    private buildCard(opt: ChampionOption, i: number, total: number, onPick: (type: string) => void): void {
        const glyph = getClassGlyph(opt.type);
        const offsetX = (i - (total - 1) / 2) * 310;

        // ── Outer card (colored border) ─────────────────────────────────────
        const card = new Rectangle(`csCard_${opt.type}`);
        card.width = '285px';
        card.height = '340px';
        card.background = '#0d0d1a';
        card.color = opt.color;
        card.thickness = 2;
        card.cornerRadius = 14;
        card.left = `${offsetX}px`;
        card.isPointerBlocker = true;
        this.panel!.addControl(card);

        // ── Header bar with class glyph ─────────────────────────────────────
        const header = new Rectangle(`csHeader_${opt.type}`);
        header.width = '285px';
        header.height = '90px';
        header.thickness = 0;
        header.background = opt.color + '33'; // translucent accent
        header.cornerRadius = 12;
        header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        card.addControl(header);

        // Class glyph — large, centered in header
        const glyphTxt = new TextBlock(`csGlyph_${opt.type}`, glyph);
        glyphTxt.color = opt.color;
        glyphTxt.fontSize = 46;
        header.addControl(glyphTxt);

        // ── Inner content panel ─────────────────────────────────────────────
        const inner = new Rectangle(`csInner_${opt.type}`);
        inner.width = '269px';
        inner.height = '238px';
        inner.thickness = 1;
        inner.color = '#333';
        inner.background = '#111827';
        inner.cornerRadius = 10;
        inner.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        inner.top = '-8px';
        card.addControl(inner);

        // Champion name
        const nameLabel = new TextBlock(`csName_${opt.type}`, opt.name);
        nameLabel.color = '#fff';
        nameLabel.fontSize = 22;
        nameLabel.fontWeight = 'bold';
        nameLabel.fontFamily = 'Arial';
        nameLabel.top = '-80px';
        nameLabel.height = '30px';
        inner.addControl(nameLabel);

        // Summary
        const summaryLabel = new TextBlock(`csSummary_${opt.type}`, opt.summary);
        summaryLabel.color = '#aaa';
        summaryLabel.fontSize = 13;
        summaryLabel.fontFamily = 'Arial';
        summaryLabel.textWrapping = true;
        summaryLabel.width = '250px';
        summaryLabel.top = '-20px';
        summaryLabel.height = '56px';
        inner.addControl(summaryLabel);

        // Starting power line
        if (opt.startingPower) {
            const powerLabel = new TextBlock(`csPower_${opt.type}`, `Starts with: ${opt.startingPower}`);
            powerLabel.color = opt.color;
            powerLabel.fontSize = 13;
            powerLabel.fontFamily = 'Arial';
            powerLabel.top = '40px';
            powerLabel.height = '20px';
            inner.addControl(powerLabel);
        }

        // "SELECT" button — inside inner panel at bottom
        const btn = Button.CreateSimpleButton(`csBtn_${opt.type}`, 'SELECT');
        btn.width = '220px';
        btn.height = '40px';
        btn.color = '#fff';
        btn.background = opt.color;
        btn.cornerRadius = 8;
        btn.thickness = 0;
        btn.fontFamily = 'Arial';
        btn.fontSize = 15;
        btn.fontWeight = 'bold';
        btn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        btn.paddingBottom = '12px';
        btn.onPointerClickObservable.add(() => {
            this.close();
            onPick(opt.type);
        });
        inner.addControl(btn);

        // ── Hover / tap-card-to-confirm ─────────────────────────────────────
        card.onPointerEnterObservable.add(() => {
            card.scaleX = 1.04;
            card.scaleY = 1.04;
            card.color = '#ffffff';
        });
        card.onPointerOutObservable.add(() => {
            card.scaleX = 1.0;
            card.scaleY = 1.0;
            card.color = opt.color;
        });
        // Entire card is clickable to select
        card.onPointerClickObservable.add(() => {
            this.close();
            onPick(opt.type);
        });
    }

    public close(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}
