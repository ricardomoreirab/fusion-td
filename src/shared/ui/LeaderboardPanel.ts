import { AdvancedDynamicTexture, Rectangle, TextBlock, Control, ScrollViewer, StackPanel } from '@babylonjs/gui';
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';
import { fetchTop } from '../../survivors/Leaderboard';
import type { LeaderboardEntry } from '../../survivors/leaderboardValidation';

/**
 * Full-screen modal leaderboard. Fetches the top-N runs and renders them as a
 * scrollable ranked list (rank, name, wave, time). Reused by the main menu and
 * the game-over screen. Call open() to fetch + display; dispose() removes it.
 *
 * Columns are aligned with a monospace font + string padding — simplest robust
 * approach for variable-length names in BabylonJS GUI.
 */
export class LeaderboardPanel {
    private root: Rectangle;
    private listStack: StackPanel;
    private statusText: TextBlock;
    private _disposed = false;
    private _opened = false;

    constructor(private ui: AdvancedDynamicTexture, private onClose: () => void) {
        this.root = new Rectangle('lbBackdrop');
        this.root.width = '100%';
        this.root.height = '100%';
        this.root.thickness = 0;
        this.root.background = STYLE.backdropDim;
        this.root.isPointerBlocker = true;
        this.ui.addControl(this.root);

        const panel = makeFrame({ name: 'lbPanel', sizePx: 440, color: '#F5A623', cornerRadius: 14 });
        panel.width = '440px';
        panel.height = '560px';
        panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        this.root.addControl(panel);

        const title = new TextBlock('lbTitle', 'LEADERBOARD');
        title.color = '#F5A623';
        title.fontSize = 28;
        title.fontWeight = 'bold';
        title.fontFamily = 'Arial';
        title.height = '40px';
        title.top = '14px';
        title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        panel.addControl(title);

        const header = new TextBlock('lbHeader', this.formatRow('#', 'NAME', 'WAVE', 'TIME'));
        header.color = '#F5A623';
        header.fontSize = 15;
        header.fontFamily = 'Courier New';
        header.height = '24px';
        header.top = '58px';
        header.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        panel.addControl(header);

        const scroll = new ScrollViewer('lbScroll');
        scroll.width = '400px';
        scroll.height = '372px';
        scroll.top = '86px';
        scroll.thickness = 0;
        scroll.barColor = '#F5A623';
        scroll.barBackground = 'rgba(255,255,255,0.08)';
        scroll.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        scroll.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        panel.addControl(scroll);

        this.listStack = new StackPanel('lbList');
        this.listStack.width = '100%';
        this.listStack.isVertical = true;
        scroll.addControl(this.listStack);

        this.statusText = new TextBlock('lbStatus', 'Loading…');
        this.statusText.color = '#bbb';
        this.statusText.fontSize = 16;
        this.statusText.fontFamily = 'Arial';
        this.statusText.height = '40px';
        this.statusText.top = '40px';
        this.statusText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        panel.addControl(this.statusText);

        const closeBtn = makeFrame({ name: 'lbClose', sizePx: 200, color: '#888', cornerRadius: 10 });
        closeBtn.width = '200px';
        closeBtn.height = '48px';
        closeBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        closeBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        closeBtn.top = '-16px';
        const closeLabel = new TextBlock('lbCloseLabel', 'CLOSE');
        closeLabel.color = '#fff';
        closeLabel.fontSize = 20;
        closeLabel.fontWeight = 'bold';
        closeLabel.fontFamily = 'Arial';
        closeBtn.addControl(closeLabel);
        addPressFeedback(closeBtn, () => { this.dispose(); this.onClose(); });
        panel.addControl(closeBtn);
    }

    /** Fetch the board and render rows. Safe to call once after construction. */
    public async open(): Promise<void> {
        if (this._opened) return;
        this._opened = true;
        this.statusText.text = 'Loading…';
        this.statusText.isVisible = true;
        const entries = await fetchTop(50);
        // The fetch can outlive the panel (Close pressed / screen exited mid-load);
        // bail out so we never touch disposed Babylon controls.
        if (this._disposed) return;
        if (entries.length === 0) {
            this.statusText.text = 'No scores yet — be the first!';
            return;
        }
        this.statusText.isVisible = false;
        for (const e of entries) this.listStack.addControl(this.makeRow(e));
    }

    public dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this.root.dispose();
    }

    private formatRow(rank: string, name: string, wave: string, time: string): string {
        return `${rank.padEnd(4)}${name.padEnd(14)}${wave.padStart(5)}${time.padStart(8)}`;
    }

    private makeRow(e: LeaderboardEntry): Rectangle {
        const row = new Rectangle(`lbRow${e.rank}`);
        row.height = '30px';
        row.thickness = 0;
        row.background = e.rank % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent';

        const mins = Math.floor(e.timeSec / 60);
        const secs = Math.floor(e.timeSec % 60);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        const name = e.name.length > 13 ? e.name.slice(0, 12) + '…' : e.name;

        const t = new TextBlock(`lbRowT${e.rank}`, this.formatRow(`#${e.rank}`, name, `${e.wave}`, timeStr));
        t.color = e.rank <= 3 ? '#F5A623' : '#fff';
        t.fontSize = 15;
        t.fontFamily = 'Courier New';
        t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        row.addControl(t);
        return row;
    }
}
