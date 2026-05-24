import { AdvancedDynamicTexture, Rectangle, TextBlock, Button, Control } from '@babylonjs/gui';
import { getLayoutMode, getRenderWidth } from './responsive';

export interface ChampionOption {
    type: string;
    name: string;
    summary: string;
    startingPower?: string;
    color: string;
}

// Class glyphs by champion type — unicode that renders well in Canvas2D
// 'barbarian' → 🪓, 'ranger' → 🏹, 'mage' → 🔮, fallback to a star
const CLASS_GLYPH: Record<string, string> = {
    barbarian: '🪓',
    ranger:    '🏹',
    mage:      '🔮',
    warrior:   '⚔',
    archer:    '🏹',
    wizard:    '🔮',
    rogue:     '✦',
};

function getClassGlyph(type: string): string {
    return CLASS_GLYPH[type.toLowerCase()] ?? '★';
}

export class ChampionSelectOverlay {
    private ui: AdvancedDynamicTexture;
    private panel: Rectangle | null = null;
    private resizeObserver: (() => void) | null = null;

    // Saved args for rebuild on resize
    private _options: ChampionOption[] = [];
    private _onPick: ((type: string) => void) = () => {};

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;
    }

    public show(options: ChampionOption[], onPick: (type: string) => void): void {
        this._options = options;
        this._onPick = onPick;
        this._build();

        // Re-build when the viewport is resized (remove previous listener first)
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

        // Full-screen dark backdrop
        this.panel = new Rectangle('championSelectBg');
        this.panel.width = '100%';
        this.panel.height = '100%';
        this.panel.background = 'rgba(0,0,0,0.95)';
        this.panel.thickness = 0;
        this.panel.isPointerBlocker = true;
        this.ui.addControl(this.panel);

        if (isMobile) {
            this._buildMobileLayout(vw);
        } else {
            this._buildDesktopLayout();
        }
    }

    /** Desktop: horizontal row of 3 large cards (original layout) */
    private _buildDesktopLayout(): void {
        // Title
        const title = new TextBlock('csTitle', 'CHOOSE YOUR CHAMPION');
        title.color = '#F5A623';
        title.fontSize = 38;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.top = '-240px';
        title.height = '54px';
        this.panel!.addControl(title);

        const subtitle = new TextBlock('csSubtitle', 'Select a hero for this run');
        subtitle.color = '#888';
        subtitle.fontSize = 16;
        subtitle.fontFamily = 'Arial';
        subtitle.top = '-188px';
        subtitle.height = '24px';
        this.panel!.addControl(subtitle);

        const total = this._options.length;
        this._options.forEach((opt, i) => {
            this._buildDesktopCard(opt, i, total);
        });
    }

    private _buildDesktopCard(opt: ChampionOption, i: number, total: number): void {
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
        header.background = opt.color + '33';
        header.cornerRadius = 12;
        header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        card.addControl(header);

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
            this._onPick(opt.type);
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
        card.onPointerClickObservable.add(() => {
            this.close();
            this._onPick(opt.type);
        });
    }

    /**
     * Mobile: vertical stack of mini landscape cards.
     * Each card is ~260px wide × 110px tall, stacked top-to-bottom.
     * Card width clamps to (viewportWidth - 40).
     */
    private _buildMobileLayout(vw: number): void {
        // Title — smaller, near the top
        const title = new TextBlock('csTitle', 'CHOOSE YOUR CHAMPION');
        title.color = '#F5A623';
        title.fontSize = 22;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        title.top = '18px';
        title.height = '32px';
        this.panel!.addControl(title);

        const cardW = Math.min(260, vw - 40);
        const cardH = 110;
        const gap = 10;
        const total = this._options.length;
        // Stack is centered vertically — compute total height
        const stackH = total * cardH + (total - 1) * gap;
        // Start offset from center: top of first card
        const stackTop = -stackH / 2;

        this._options.forEach((opt, i) => {
            const glyph = getClassGlyph(opt.type);
            const topY = stackTop + i * (cardH + gap);

            // ── Outer card ─────────────────────────────────────────────────
            const card = new Rectangle(`csCard_${opt.type}`);
            card.width = `${cardW}px`;
            card.height = `${cardH}px`;
            card.background = '#0d0d1a';
            card.color = opt.color;
            card.thickness = 2;
            card.cornerRadius = 10;
            card.top = `${topY}px`;
            card.isPointerBlocker = true;
            this.panel!.addControl(card);

            // ── Left glyph strip ───────────────────────────────────────────
            const headerBar = new Rectangle(`csHeader_${opt.type}`);
            headerBar.width = '60px';
            headerBar.height = `${cardH}px`;
            headerBar.thickness = 0;
            headerBar.background = opt.color + '33';
            headerBar.cornerRadius = 8;
            headerBar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            card.addControl(headerBar);

            const glyphTxt = new TextBlock(`csGlyph_${opt.type}`, glyph);
            glyphTxt.color = opt.color;
            glyphTxt.fontSize = 30;
            headerBar.addControl(glyphTxt);

            // ── Right content area ─────────────────────────────────────────
            const inner = new Rectangle(`csInner_${opt.type}`);
            inner.width = `${cardW - 68}px`;
            inner.height = `${cardH - 12}px`;
            inner.thickness = 0;
            inner.background = 'transparent';
            inner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            inner.paddingRight = '8px';
            card.addControl(inner);

            const nameLabel = new TextBlock(`csName_${opt.type}`, opt.name);
            nameLabel.color = '#fff';
            nameLabel.fontSize = 16;
            nameLabel.fontWeight = 'bold';
            nameLabel.fontFamily = 'Arial';
            nameLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            nameLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            nameLabel.top = '10px';
            nameLabel.height = '22px';
            inner.addControl(nameLabel);

            // One-line summary (truncate naturally via textWrapping = false)
            const summaryLabel = new TextBlock(`csSummary_${opt.type}`, opt.summary);
            summaryLabel.color = '#aaa';
            summaryLabel.fontSize = 12;
            summaryLabel.fontFamily = 'Arial';
            summaryLabel.textWrapping = true;
            summaryLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            summaryLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            summaryLabel.top = '36px';
            summaryLabel.height = '40px';
            summaryLabel.width = `${cardW - 80}px`;
            inner.addControl(summaryLabel);

            if (opt.startingPower) {
                const powerLabel = new TextBlock(`csPower_${opt.type}`, `▶ ${opt.startingPower}`);
                powerLabel.color = opt.color;
                powerLabel.fontSize = 11;
                powerLabel.fontFamily = 'Arial';
                powerLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                powerLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                powerLabel.top = '-8px';
                powerLabel.height = '16px';
                inner.addControl(powerLabel);
            }

            // Entire card is tappable — no separate SELECT button on mobile
            card.onPointerEnterObservable.add(() => {
                card.scaleX = 1.03;
                card.scaleY = 1.03;
                card.color = '#ffffff';
            });
            card.onPointerOutObservable.add(() => {
                card.scaleX = 1.0;
                card.scaleY = 1.0;
                card.color = opt.color;
            });
            card.onPointerClickObservable.add(() => {
                this.close();
                this._onPick(opt.type);
            });
        });
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
}
