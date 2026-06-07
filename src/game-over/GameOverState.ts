import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { PlayerStats } from '../survivors/PlayerStats';
import { tryHaptic } from '../shared/ui/HudStyle';
import { GameUI } from '../ui/GameUI';
import { el } from '../ui/dom';
import { makeButton } from '../ui/primitives/Button';
import { makeFrame } from '../ui/primitives/Frame';
import { GameSettings } from '../shared/GameSettings';
import { submitScore } from '../survivors/Leaderboard';
import { LeaderboardOverlay } from '../ui/overlays/Leaderboard';
import type { CoopHeroSummary } from '../net/Protocol';

export interface SurvivorsRunSummary {
    waveReached: number;
    timeSurvivedSec: number;
    kills: number;
    /** Total XP earned over the run (gold income folds into XP). */
    goldCollected: number;
    /** Hero level reached (XP/leveling system). */
    levelReached: number;
    finalLoadout: { name: string; level: number; icon: string; tier?: string }[];
    championType?: string;
    /** Co-op (M4-12): per-hero summaries. Absent / length 1 in single-player; 2 in
     *  co-op, where the summary panel renders one column per hero. */
    heroes?: CoopHeroSummary[];
}

export class GameOverState implements GameState {
    private game: Game;
    private gameUI: GameUI | null = null;
    private playerWon: boolean = false;
    private playerStats: PlayerStats | null = null;
    private survivorsSummary: SurvivorsRunSummary | null = null;
    private lbOpen = false;

    constructor(game: Game) {
        this.game = game;
    }

    public setSurvivorsSummary(summary: SurvivorsRunSummary): void {
        this.survivorsSummary = summary;
    }

    public enter(): void {
        console.log('Entering game over state');
        tryHaptic(20);

        // Check if player won or lost
        const stateManager = this.game.getStateManager();
        const previousState = stateManager.getCurrentStateName();

        if (previousState === 'gameplay') {
            const scene = this.game.getScene();
            this.playerStats = scene.metadata?.playerStats as PlayerStats;
            if (this.playerStats) {
                this.playerWon = this.playerStats.hasWon();
            }
        }

        // Create UI
        this.createUI();
    }

    public exit(): void {
        console.log('Exiting game over state');

        this.gameUI?.dispose();
        this.gameUI = null;
        this.playerStats = null;
        this.survivorsSummary = null;
        this.lbOpen = false; // singleton state — clear the guard so the board reopens next time
    }

    public update(_deltaTime: number): void {
        // Nothing to update in game over state
    }

    private createUI(): void {
        this.gameUI = new GameUI();
        const overlay = this.gameUI.layer('overlay');

        const screen = el('div', { class: 'screen interactive' });

        const changeState = (name: string) => this.game.getStateManager().changeState(name);

        if (this.survivorsSummary) {
            // ── Live path: survivors run summary ──────────────────────────────
            const s = this.survivorsSummary;

            const coop = !!(s.heroes && s.heroes.length > 1);
            screen.appendChild(el('div', { class: 'screen__title', text: 'DEFEATED' }));
            screen.appendChild(el('div', { class: 'screen__subtitle', text: coop ? 'Your run has ended' : 'Your run has ended' }));

            const mins = Math.floor(s.timeSurvivedSec / 60);
            const secs = Math.floor(s.timeSurvivedSec % 60);
            const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

            if (coop && s.heroes) {
                // ── Co-op: one column per hero (M4-12) ────────────────────────
                screen.appendChild(el('div', { class: 'summary-shared', text: `Wave ${s.waveReached}  •  ${timeStr} survived` }));
                const cols = el('div', { class: 'summary-columns' });
                for (const h of s.heroes) cols.appendChild(this.buildHeroPanel(h));
                screen.appendChild(cols);
            } else {
                // ── Single-player: the original single panel ──────────────────
                const panel = makeFrame({ variant: 'ornate', class: 'summary-panel' });
                panel.appendChild(el('div', { class: 'summary-header', text: 'RUN SUMMARY' }));
                const addRow = (label: string, value: string | number) => {
                    const row = el('div', { class: 'summary-row' });
                    row.appendChild(el('span', { text: label }));
                    row.appendChild(el('span', { text: String(value) }));
                    panel.appendChild(row);
                };
                addRow('Wave Reached', s.waveReached);
                addRow('Level Reached', s.levelReached);
                addRow('Time Survived', timeStr);
                addRow('Enemies Slain', s.kills);
                addRow('XP Earned', s.goldCollected);
                panel.appendChild(el('div', { class: 'summary-loadout', text: this.loadoutString(s.finalLoadout) }));
                screen.appendChild(panel);
            }
        } else {
            // ── Fallback path: TD-era (dead code path) ────────────────────────
            screen.appendChild(el('div', {
                class: 'screen__title',
                text: this.playerWon ? 'VICTORY' : 'DEFEAT',
            }));
            screen.appendChild(el('div', {
                class: 'screen__subtitle',
                text: this.playerWon ? 'Congratulations! You defended your base!' : 'Your base has been overrun!',
            }));
        }

        // Buttons row
        const btnRow = el('div', { class: 'screen__buttons' });
        btnRow.appendChild(makeButton({
            label: 'Play Again',
            variant: 'forged',
            onClick: () => changeState('survivors'),
        }));
        btnRow.appendChild(makeButton({
            label: 'Main Menu',
            variant: 'ghost',
            onClick: () => changeState('menu'),
        }));
        screen.appendChild(btnRow);

        // Leaderboard submit row (survivors runs only).
        if (this.survivorsSummary) {
            this.addLeaderboardSection(screen, overlay, this.survivorsSummary);
        }

        overlay.appendChild(screen);
    }

    private loadoutString(loadout: { name: string; level: number; icon: string; tier?: string }[]): string {
        const tierBadge = (t?: string) => (t === 'ultimate' ? '✪ ' : t === 'fusion' ? '✦ ' : '');
        return loadout.length > 0
            ? loadout.map(p => `${tierBadge(p.tier)}${p.icon} ${p.name} Lv${p.level}`).join('  ')
            : '(no powers)';
    }

    /** Co-op (M4-12): one summary column for a single hero. */
    private buildHeroPanel(h: CoopHeroSummary): HTMLElement {
        const panel = makeFrame({ variant: 'ornate', class: 'summary-panel summary-panel--col' });
        const name = h.championType
            ? h.championType.charAt(0).toUpperCase() + h.championType.slice(1)
            : `Hero ${h.id + 1}`;
        panel.appendChild(el('div', { class: 'summary-header', text: `${name}${h.id === 0 ? ' (Host)' : ''}` }));
        const addRow = (label: string, value: string | number) => {
            const row = el('div', { class: 'summary-row' });
            row.appendChild(el('span', { text: label }));
            row.appendChild(el('span', { text: String(value) }));
            panel.appendChild(row);
        };
        addRow('Level', h.level);
        addRow('Enemies Slain', h.kills);
        addRow('XP Earned', h.xp);
        panel.appendChild(el('div', { class: 'summary-loadout', text: this.loadoutString(h.loadout) }));
        return panel;
    }

    /**
     * Survivors-only: a submit row (name input + submit button) below the run
     * summary. On a successful submit the button becomes a "Ranked #N — View
     * Board" action that opens the shared leaderboard modal.
     */
    private addLeaderboardSection(screen: HTMLElement, parent: HTMLElement, summary: SurvivorsRunSummary): void {
        const row = el('div', { class: 'lb-submit' });

        const nameInput = el('input', {
            class: 'lb-name-input',
            attrs: { type: 'text', maxlength: '16', placeholder: 'Enter your name' },
        }) as HTMLInputElement;
        nameInput.value = GameSettings.getLeaderboardName();
        // GameUI preventDefaults #ui-root mousedown (to keep canvas keyboard focus);
        // stop propagation here so clicking the field still focuses it on desktop.
        nameInput.addEventListener('mousedown', (e) => e.stopPropagation());

        let busy = false;
        const submitBtn = makeButton({
            label: '🏆 Submit Score',
            variant: 'forged',
            onClick: () => {
                if (busy) return;
                const name = nameInput.value.trim();
                if (name.length === 0) {
                    nameInput.classList.add('lb-name-input--err');
                    nameInput.focus();
                    return;
                }
                busy = true;
                GameSettings.setLeaderboardName(name);
                submitBtn.textContent = 'Submitting…';
                submitBtn.classList.add('btn--disabled');
                void submitScore(summary, name).then((result) => {
                    if (!this.gameUI) return; // screen exited mid-submit — nodes detached
                    if (result) {
                        const viewBtn = makeButton({
                            label: `Ranked #${result.rank} — View Board`,
                            variant: 'forged',
                            onClick: () => this.openLeaderboard(parent),
                        });
                        row.replaceChild(viewBtn, submitBtn);
                        nameInput.remove();
                    } else {
                        busy = false;
                        submitBtn.classList.remove('btn--disabled');
                        submitBtn.textContent = 'Failed — Tap to Retry';
                    }
                });
            },
        });

        row.append(nameInput, submitBtn);
        screen.appendChild(row);
    }

    private openLeaderboard(parent: HTMLElement): void {
        if (this.lbOpen) return; // guard against stacking panels on rapid taps
        this.lbOpen = true;
        const board = new LeaderboardOverlay(parent);
        void board.show(() => { this.lbOpen = false; });
    }
}
