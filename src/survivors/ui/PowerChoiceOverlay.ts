import { AdvancedDynamicTexture, Rectangle, TextBlock, Control, Button } from '@babylonjs/gui';
import { getLayoutMode, getRenderWidth } from '../../shared/ui/responsive';
import { makeFrame, addPressFeedback, STYLE } from '../../shared/ui/HudStyle';

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
    private resizeObserver: (() => void) | null = null;

    // Saved args for rebuild on resize
    private _cards: PowerCard[] = [];
    private _onCancel: () => void = () => {};

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(cards: PowerCard[], onCancel: () => void, onClosed: () => void): void {
        this._cards = cards;
        this._onCancel = onCancel;
        this.onClosed = onClosed;
        this._build();

        // Rebuild on resize
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
        // Dispose previous panel if rebuilding
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }

        const isMobile = getLayoutMode(this.ui) === 'mobile';
        const vw = getRenderWidth(this.ui);

        this.panel = new Rectangle('powerChoiceBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = STYLE.backdropDim;
        this.panel.thickness = 0;
        this.ui.addControl(this.panel);

        if (isMobile) {
            this._buildMobileLayout(vw);
        } else {
            this._buildDesktopLayout();
        }
    }

    /** Desktop: horizontal row of up to 3 vertical cards (original layout) */
    private _buildDesktopLayout(): void {
        const titleBar = new TextBlock('powerChoiceTitle', 'Choose a Power');
        titleBar.color = '#fff';
        titleBar.fontSize = 30;
        titleBar.fontWeight = 'bold';
        titleBar.top = '-240px';
        this.panel!.addControl(titleBar);

        this._cards.forEach((card, i) => {
            const btn = this._makeDesktopCard(card, i, this._cards.length);
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
            this._onCancel();
            this.close();
        });
        this.panel!.addControl(cancelBtn);
    }

    private _makeDesktopCard(card: PowerCard, index: number, total: number): Rectangle {
        const kindCfg = KIND_CONFIG[card.kind];

        let borderColor = kindCfg.border;
        let headerColor = '#2a2040';
        if (card.kind === 'power' && card.element) {
            borderColor = ELEMENT_COLOR[card.element] ?? kindCfg.border;
            headerColor = borderColor + '44';
        } else if (card.kind === 'perk') {
            headerColor = '#3a3010';
        } else if (card.kind === 'wildcard') {
            headerColor = '#1a2a1a';
        }

        // ── Outer card frame (colored border) ──────────────────────────────
        const outer = makeFrame({ name: `powerCardOuter_${index}`, sizePx: 220, color: borderColor, cornerRadius: 12 });
        outer.height = '300px';

        const gap = 240;
        const offset = (index - (total - 1) / 2) * gap;
        outer.left = `${offset}px`;

        // ── Header bar ──────────────────────────────────────────────────────
        const header = new Rectangle(`powerCardHeader_${index}`);
        header.width = '220px';
        header.height = '70px';
        header.thickness = 0;
        header.background = headerColor;
        header.cornerRadius = 10;
        header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        outer.addControl(header);

        const glyphStr = card.kind === 'power' && card.element
            ? (ELEMENT_GLYPH[card.element] ?? kindCfg.glyph)
            : kindCfg.glyph;
        const glyphTxt = new TextBlock(`powerCardGlyph_${index}`, glyphStr);
        glyphTxt.color = borderColor;
        glyphTxt.fontSize = 38;
        header.addControl(glyphTxt);

        // ── Inner dark panel ───────────────────────────────────────────────
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

        const titleTxt = new TextBlock(`cardTitle_${index}`, card.title);
        titleTxt.color = '#ffffff';
        titleTxt.fontSize = 17;
        titleTxt.fontWeight = 'bold';
        titleTxt.top = '-60px';
        titleTxt.textWrapping = true;
        titleTxt.width = '190px';
        inner.addControl(titleTxt);

        const subtitleTxt = new TextBlock(`cardSub_${index}`, card.subtitle);
        subtitleTxt.color = '#ffcc88';
        subtitleTxt.fontSize = 13;
        subtitleTxt.top = '10px';
        subtitleTxt.textWrapping = true;
        subtitleTxt.width = '190px';
        inner.addControl(subtitleTxt);

        const kindLbl = new TextBlock(`kindTag_${index}`, kindCfg.kindLabel);
        kindLbl.color = borderColor;
        kindLbl.fontSize = 11;
        kindLbl.fontWeight = 'bold';
        kindLbl.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        kindLbl.paddingBottom = '8px';
        inner.addControl(kindLbl);

        addPressFeedback(outer, () => {
            card.onPick();
            this.close();
        });

        return outer;
    }

    /**
     * Mobile: vertical stack of landscape mini-cards.
     * Each card ~260px wide × 90px tall, glyph on left, title+subtitle on right.
     * Cancel button below the stack.
     */
    private _buildMobileLayout(vw: number): void {
        const title = new TextBlock('powerChoiceTitle', 'Choose a Power');
        title.color = '#fff';
        title.fontSize = 20;
        title.fontWeight = 'bold';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        title.top = '18px';
        title.height = '28px';
        this.panel!.addControl(title);

        const cardW = Math.min(280, vw - 40);
        const cardH = 90;
        const gap = 10;
        const total = this._cards.length;
        const stackH = total * cardH + (total - 1) * gap;
        const stackTop = -stackH / 2 - 20; // shift up a bit to leave room for cancel btn

        this._cards.forEach((card, i) => {
            const kindCfg = KIND_CONFIG[card.kind];
            let borderColor = kindCfg.border;
            let headerColor = '#2a2040';
            if (card.kind === 'power' && card.element) {
                borderColor = ELEMENT_COLOR[card.element] ?? kindCfg.border;
                headerColor = borderColor + '44';
            } else if (card.kind === 'perk') {
                headerColor = '#3a3010';
            } else if (card.kind === 'wildcard') {
                headerColor = '#1a2a1a';
            }

            const glyphStr = card.kind === 'power' && card.element
                ? (ELEMENT_GLYPH[card.element] ?? kindCfg.glyph)
                : kindCfg.glyph;

            const topY = stackTop + i * (cardH + gap);

            // ── Outer card ─────────────────────────────────────────────────
            const outer = makeFrame({ name: `powerCardOuter_${i}`, sizePx: cardW, color: borderColor, cornerRadius: 10 });
            outer.height = `${cardH}px`;
            outer.top = `${topY}px`;
            this.panel!.addControl(outer);

            // ── Left glyph strip ───────────────────────────────────────────
            const glyphStrip = new Rectangle(`powerCardGlyphStrip_${i}`);
            glyphStrip.width = '56px';
            glyphStrip.height = `${cardH}px`;
            glyphStrip.thickness = 0;
            glyphStrip.background = headerColor;
            glyphStrip.cornerRadius = 8;
            glyphStrip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            outer.addControl(glyphStrip);

            const glyphTxt = new TextBlock(`powerCardGlyph_${i}`, glyphStr);
            glyphTxt.color = borderColor;
            glyphTxt.fontSize = 28;
            glyphStrip.addControl(glyphTxt);

            // ── Right content ──────────────────────────────────────────────
            const inner = new Rectangle(`powerCardInner_${i}`);
            inner.width = `${cardW - 64}px`;
            inner.height = `${cardH - 8}px`;
            inner.thickness = 0;
            inner.background = 'transparent';
            inner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            inner.paddingRight = '8px';
            outer.addControl(inner);

            const titleTxt = new TextBlock(`cardTitle_${i}`, card.title);
            titleTxt.color = '#ffffff';
            titleTxt.fontSize = 14;
            titleTxt.fontWeight = 'bold';
            titleTxt.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            titleTxt.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            titleTxt.top = '8px';
            titleTxt.height = '20px';
            inner.addControl(titleTxt);

            const subtitleTxt = new TextBlock(`cardSub_${i}`, card.subtitle);
            subtitleTxt.color = '#ffcc88';
            subtitleTxt.fontSize = 12;
            subtitleTxt.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            subtitleTxt.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            subtitleTxt.top = '30px';
            subtitleTxt.height = '34px';
            subtitleTxt.textWrapping = true;
            subtitleTxt.width = `${cardW - 72}px`;
            inner.addControl(subtitleTxt);

            const kindLbl = new TextBlock(`kindTag_${i}`, kindCfg.kindLabel);
            kindLbl.color = borderColor;
            kindLbl.fontSize = 10;
            kindLbl.fontWeight = 'bold';
            kindLbl.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            kindLbl.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            kindLbl.paddingBottom = '4px';
            kindLbl.paddingRight = '4px';
            inner.addControl(kindLbl);

            addPressFeedback(outer, () => {
                card.onPick();
                this.close();
            });
        });

        // Cancel button below the stack
        const cancelBtn = Button.CreateSimpleButton('cancelOrb', 'Skip  (+25 gold)');
        cancelBtn.width = `${Math.min(200, cardW)}px`;
        cancelBtn.height = '44px';
        cancelBtn.color = '#ddd';
        cancelBtn.background = '#333';
        cancelBtn.cornerRadius = 8;
        cancelBtn.thickness = 1;
        cancelBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        cancelBtn.top = '-20px';
        cancelBtn.onPointerClickObservable.add(() => {
            this._onCancel();
            this.close();
        });
        this.panel!.addControl(cancelBtn);
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
        const cb = this.onClosed;
        this.onClosed = () => {};
        cb();
    }

    public isOpen(): boolean {
        return this.panel !== null;
    }
}
