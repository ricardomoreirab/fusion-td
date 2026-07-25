import { makeModal, ModalController } from '../primitives/Modal';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { fetchTop } from '../../survivors/Leaderboard';

/**
 * Modal leaderboard: fetches the top-N runs and renders them as a ranked list
 * (rank, name, wave, time). Reused by the main menu and the game-over screen.
 *
 * Construct with the GameUI overlay layer as parent; `show()` fetches + displays,
 * `close()` tears it down. When the owning state exits it disposes the GameUI
 * (and with it this modal, a child of the overlay layer), so there is no leak.
 * Columns are a real CSS grid: the previous version padded strings and set them
 * in Courier New, the one typeface in the build belonging to no other screen,
 * and a long name still pushed the wave/time columns out of alignment.
 */
export class LeaderboardOverlay {
    private modal: ModalController | null = null;
    private closed = false;

    constructor(private parent: HTMLElement) {}

    public async show(onClose: () => void): Promise<void> {
        this.close();
        this.closed = false;

        const modal = makeModal({ title: 'Leaderboard', panelClass: 'modal-panel--leaderboard' });
        this.modal = modal;

        const header = this.buildRow('lb-header', '#', 'Name', 'Wave', 'Time');
        header.style.display = 'none';
        const status = el('div', { class: 'modal-subtitle', text: 'Loading…' });
        const list = el('div', { class: 'lb-list' });
        const closeBtn = makeButton({ label: 'Close', variant: 'ghost', onClick: () => { this.close(); onClose(); } });
        modal.body.append(header, status, list, closeBtn);
        this.parent.appendChild(modal.root);

        const entries = await fetchTop(50);
        if (this.closed) return; // disposed mid-fetch — don't touch detached nodes

        if (entries.length === 0) {
            status.textContent = 'No scores yet — be the first!';
            return;
        }
        status.remove();
        header.style.display = '';
        for (const e of entries) {
            list.appendChild(this.buildRow(
                e.rank <= 3 ? 'lb-row lb-row--top' : 'lb-row',
                `#${e.rank}`, e.name, `${e.wave}`, this.time(e.timeSec),
            ));
        }
    }

    public close(): void {
        this.closed = true;
        if (this.modal) { this.modal.dispose(); this.modal = null; }
    }

    /** One grid row. The name cell ellipsises in CSS, so an over-long entry
        can never push the wave/time columns out of alignment. */
    private buildRow(cls: string, rank: string, name: string, wave: string, time: string): HTMLDivElement {
        return el('div', { class: cls }, [
            el('span', { class: 'lb-rank', text: rank }),
            el('span', { class: 'lb-name', text: name, attrs: { title: name } }),
            el('span', { class: 'lb-num', text: wave }),
            el('span', { class: 'lb-num', text: time }),
        ]);
    }

    private time(sec: number): string {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}
