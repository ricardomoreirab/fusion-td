import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { PlayerStats } from '../survivors/PlayerStats';
import { tryHaptic } from '../shared/ui/HudStyle';
import { GameUI } from '../ui/GameUI';
import { el } from '../ui/dom';
import { makeButton } from '../ui/primitives/Button';
import { makeFrame } from '../ui/primitives/Frame';

export interface SurvivorsRunSummary {
    waveReached: number;
    timeSurvivedSec: number;
    kills: number;
    goldCollected: number;
    finalLoadout: { name: string; level: number; icon: string; tier?: string }[];
}

export class GameOverState implements GameState {
    private game: Game;
    private gameUI: GameUI | null = null;
    private playerWon: boolean = false;
    private playerStats: PlayerStats | null = null;
    private survivorsSummary: SurvivorsRunSummary | null = null;

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

            screen.appendChild(el('div', { class: 'screen__title', text: 'DEFEATED' }));
            screen.appendChild(el('div', { class: 'screen__subtitle', text: 'Your run has ended' }));

            // Stats panel
            const panel = makeFrame({ variant: 'ornate', class: 'summary-panel' });

            panel.appendChild(el('div', { class: 'summary-header', text: 'RUN SUMMARY' }));

            const mins = Math.floor(s.timeSurvivedSec / 60);
            const secs = Math.floor(s.timeSurvivedSec % 60);
            const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

            const addRow = (label: string, value: string | number) => {
                const row = el('div', { class: 'summary-row' });
                row.appendChild(el('span', { text: label }));
                row.appendChild(el('span', { text: String(value) }));
                panel.appendChild(row);
            };

            addRow('Wave Reached', s.waveReached);
            addRow('Time Survived', timeStr);
            addRow('Enemies Slain', s.kills);
            addRow('Gold Collected', s.goldCollected);

            const tierBadge = (t?: string) => (t === 'ultimate' ? '✪ ' : t === 'fusion' ? '✦ ' : '');
            const loadoutStr = s.finalLoadout.length > 0
                ? s.finalLoadout.map(p => `${tierBadge(p.tier)}${p.icon} ${p.name} Lv${p.level}`).join('  ')
                : '(no powers)';

            panel.appendChild(el('div', { class: 'summary-loadout', text: loadoutStr }));

            screen.appendChild(panel);
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

        overlay.appendChild(screen);
    }
}
