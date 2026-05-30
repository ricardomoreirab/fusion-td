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
 * Columns are monospace-aligned via string padding — simplest robust approach
 * for variable-length names.
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

        const header = el('div', { class: 'lb-header', text: this.formatRow('#', 'NAME', 'WAVE', 'TIME') });
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
            list.appendChild(el('div', {
                class: e.rank <= 3 ? 'lb-row lb-row--top' : 'lb-row',
                text: this.formatRow(`#${e.rank}`, this.clip(e.name), `${e.wave}`, this.time(e.timeSec)),
            }));
        }
    }

    public close(): void {
        this.closed = true;
        if (this.modal) { this.modal.dispose(); this.modal = null; }
    }

    private formatRow(rank: string, name: string, wave: string, time: string): string {
        return `${rank.padEnd(4)}${name.padEnd(14)}${wave.padStart(5)}${time.padStart(8)}`;
    }

    private clip(name: string): string {
        return name.length > 13 ? name.slice(0, 12) + '…' : name;
    }

    private time(sec: number): string {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}
