/**
 * PauseScreen - full-screen DOM pause overlay (dim backdrop, title, and
 * Resume / Restart / Main Menu buttons). Lives directly under document.body
 * with its own high z-index so it renders above every game surface,
 * independent of any state's UI lifecycle.
 */

import { Game } from '../../engine/Game';
import { el } from '../../ui/dom';
import { makeButton } from '../../ui/primitives/Button';
import { STYLE } from './HudStyle';

export class PauseScreen {
    private readonly root: HTMLDivElement;
    private isVisible = false;

    constructor(private game: Game) {
        this.root = el('div', { class: 'pause-screen' }) as HTMLDivElement;
        this.root.style.cssText =
            `position:fixed;inset:0;z-index:9000;display:none;` +
            `flex-direction:column;align-items:center;justify-content:center;gap:14px;` +
            `background:${STYLE.backdropDim};`;

        const title = el('div', { text: 'GAME PAUSED' });
        title.style.cssText =
            'color:#fff;font:bold clamp(28px,6vw,60px) Arial,sans-serif;' +
            'text-shadow:0 3px 10px rgba(0,0,0,0.5),0 0 2px #000;margin-bottom:6px;';
        this.root.appendChild(title);

        const isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 1024;
        const hint = el('div', {
            text: isMobile ? 'Tap Resume to continue' : 'Press Escape or click Resume to continue',
        });
        hint.style.cssText = 'color:#B0B8C8;font:bold clamp(12px,2vw,22px) Arial,sans-serif;margin-bottom:18px;';
        this.root.appendChild(hint);

        this.root.appendChild(makeButton({
            label: 'RESUME',
            variant: 'forged',
            onClick: () => this.game.resume(),
        }));
        this.root.appendChild(makeButton({
            label: 'RESTART',
            variant: 'ghost',
            onClick: () => {
                this.game.resume();
                this.game.getStateManager().changeState('survivors');
            },
        }));
        this.root.appendChild(makeButton({
            label: 'MAIN MENU',
            variant: 'ghost',
            onClick: () => {
                this.game.resume();
                this.game.getStateManager().changeState('menu');
            },
        }));

        document.body.appendChild(this.root);
    }

    public show(): void {
        if (this.isVisible) return;
        this.isVisible = true;
        this.root.style.display = 'flex';
    }

    public hide(): void {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.root.style.display = 'none';
    }

    public dispose(): void {
        this.root.remove();
    }
}
