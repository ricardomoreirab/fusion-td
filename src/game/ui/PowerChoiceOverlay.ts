import { AdvancedDynamicTexture, Rectangle, TextBlock, Control, Button } from '@babylonjs/gui';

export type PowerCardKind = 'power' | 'wildcard' | 'perk';

export interface PowerCard {
    kind: PowerCardKind;
    title: string;
    subtitle: string;
    /** Element of the power, used for border color on power cards */
    element?: string;
    onPick: () => void;
}

// ─── Glyph maps shared with HeroHud ──────────────────────────────────────────
const ELEMENT_GLYPH: Record<string, string> = {
    fire:     '🔥',
    ice:      '◆',
    arcane:   '◉',
    physical: '➤',
    storm:    '⚡',
};

const ELEMENT_COLOR: Record<string, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

const KIND_CONFIG: Record<PowerCardKind, { border: string; kindLabel: string; glyph: string }> = {
    power:    { border: '#888',    kindLabel: 'POWER',   glyph: '★'  },
    wildcard: { border: '#ffffff', kindLabel: 'UPGRADE', glyph: '↑'  },
    perk:     { border: '#ffd700', kindLabel: 'PERK',    glyph: '✦'  },
};

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
        this.panel.background = 'rgba(0,0,0,0.62)';
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        const titleBar = new TextBlock('powerChoiceTitle', 'Choose a Power');
        titleBar.color = '#fff';
        titleBar.fontSize = 30;
        titleBar.fontWeight = 'bold';
        titleBar.top = '-240px';
        this.panel.addControl(titleBar);

        cards.forEach((card, i) => {
            const btn = this.makeCard(card, i, cards.length);
            this.panel!.addControl(btn);
        });

        const cancelBtn = Button.CreateSimpleButton('cancelOrb', 'Skip  (+25 gold)');
        cancelBtn.width = '200px';
        cancelBtn.height = '44px';
        cancelBtn.color = '#ddd';
        cancelBtn.background = '#333';
        cancelBtn.cornerRadius = 8;
        cancelBtn.thickness = 1;
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cancelBtn.top = '-40px';
        cancelBtn.onPointerClickObservable.add(() => {
            onCancel();
            this.close();
        });
        this.panel.addControl(cancelBtn);
    }

    private makeCard(card: PowerCard, index: number, total: number): Rectangle {
        const kindCfg = KIND_CONFIG[card.kind];

        // Resolve border color — power cards use element color, others use kind color
        let borderColor = kindCfg.border;
        let headerColor = '#2a2040';
        if (card.kind === 'power' && card.element) {
            borderColor = ELEMENT_COLOR[card.element] ?? kindCfg.border;
            headerColor = borderColor + '44'; // translucent element tint
        } else if (card.kind === 'perk') {
            headerColor = '#3a3010';
        } else if (card.kind === 'wildcard') {
            headerColor = '#1a2a1a';
        }

        // ── Outer card frame (colored border) ──────────────────────────────
        const outer = new Rectangle(`powerCardOuter_${index}`);
        outer.width = '220px';
        outer.height = '300px';
        outer.cornerRadius = 12;
        outer.thickness = 2;
        outer.color = borderColor;
        outer.background = '#0d0d1a';

        const gap = 240;
        const offset = (index - (total - 1) / 2) * gap;
        outer.left = `${offset}px`;

        // ── Header bar (element color accent) ──────────────────────────────
        const header = new Rectangle(`powerCardHeader_${index}`);
        header.width = '220px';
        header.height = '70px';
        header.thickness = 0;
        header.background = headerColor;
        header.cornerRadius = 10;
        header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        outer.addControl(header);

        // Large glyph inside header
        const glyphStr = card.kind === 'power' && card.element
            ? (ELEMENT_GLYPH[card.element] ?? kindCfg.glyph)
            : kindCfg.glyph;
        const glyphTxt = new TextBlock(`powerCardGlyph_${index}`, glyphStr);
        glyphTxt.color = borderColor;
        glyphTxt.fontSize = 38;
        header.addControl(glyphTxt);

        // ── Inner dark panel (inset 8px) ───────────────────────────────────
        const inner = new Rectangle(`powerCardInner_${index}`);
        inner.width = '204px';
        inner.height = '220px';
        inner.thickness = 1;
        inner.color = '#333';
        inner.background = '#111827';
        inner.cornerRadius = 8;
        inner.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        inner.top = '-8px';
        outer.addControl(inner);

        // Title
        const titleTxt = new TextBlock(`cardTitle_${index}`, card.title);
        titleTxt.color = '#ffffff';
        titleTxt.fontSize = 17;
        titleTxt.fontWeight = 'bold';
        titleTxt.top = '-60px';
        titleTxt.textWrapping = true;
        titleTxt.width = '190px';
        inner.addControl(titleTxt);

        // Subtitle / description
        const subtitleTxt = new TextBlock(`cardSub_${index}`, card.subtitle);
        subtitleTxt.color = '#ffcc88';
        subtitleTxt.fontSize = 13;
        subtitleTxt.top = '10px';
        subtitleTxt.textWrapping = true;
        subtitleTxt.width = '190px';
        inner.addControl(subtitleTxt);

        // Kind label at bottom of inner panel
        const kindLbl = new TextBlock(`kindTag_${index}`, kindCfg.kindLabel);
        kindLbl.color = borderColor;
        kindLbl.fontSize = 11;
        kindLbl.fontWeight = 'bold';
        kindLbl.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        kindLbl.paddingBottom = '8px';
        inner.addControl(kindLbl);

        // ── Hover / select feedback ─────────────────────────────────────────
        outer.isPointerBlocker = true;
        outer.onPointerEnterObservable.add(() => {
            outer.scaleX = 1.05;
            outer.scaleY = 1.05;
            outer.color = '#ffffff';
        });
        outer.onPointerOutObservable.add(() => {
            outer.scaleX = 1.0;
            outer.scaleY = 1.0;
            outer.color = borderColor;
        });
        outer.onPointerClickObservable.add(() => {
            card.onPick();
            this.close();
        });

        return outer;
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
