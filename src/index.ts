import './ui/styles/index.css';
import { Game } from './engine/Game';
import { subscribeLocale, t } from './i18n';

/**
 * The rotate-device prompt is static markup in index.html (it has to show before
 * any bundle work happens, including on a slow first load), so it is the one
 * user-facing string the locale cannot reach by construction. Fill it in once the
 * bundle is up, and again whenever the language changes.
 */
function localiseStaticChrome(): void {
    const title = document.querySelector('.rotate-title');
    const body = document.querySelector('.rotate-subtitle');
    if (title) title.textContent = t('menu.rotateTitle');
    if (body) body.textContent = t('menu.rotateBody');
}

// Wait for the DOM to be ready
window.addEventListener('DOMContentLoaded', () => {
    // Create and start the game. start() is async because the WebGPU engine
    // (when supported by the browser) requires async initialisation. We don't
    // await it at the top level — the loading screen stays visible until
    // assets finish, and resize handler is safe before engine init.
    localiseStaticChrome();
    subscribeLocale(localiseStaticChrome);

    const game = new Game('renderCanvas');
    game.start().catch(err => console.error('Game failed to start:', err));
    (window as unknown as Record<string, unknown>).__ktgGame = game;

    if (new URLSearchParams(window.location.search).has('coopdebug')) {
        import('./net/coopDebug').then((m) => m.mountCoopDebug());
    }

    // Handle window resize
    window.addEventListener('resize', () => {
        game.resize();
    });
});