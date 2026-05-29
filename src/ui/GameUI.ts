import { el } from './dom';

export type LayerName = 'hud' | 'fx' | 'indicators' | 'overlay';

/** Owns the layer divs inside #ui-root. One instance per game state that
   needs DOM UI; dispose() removes everything so the overlay resets fully. */
export class GameUI {
  private root: HTMLElement;
  private layers: Record<LayerName, HTMLDivElement>;
  private preventFocusSteal: (e: MouseEvent) => void;

  constructor(rootId = 'ui-root') {
    const root = document.getElementById(rootId);
    if (!root) throw new Error(`#${rootId} not found — is it in index.html?`);
    this.root = root;

    const make = (name: LayerName) => el('div', { class: `layer layer-${name}` });
    this.layers = {
      hud: make('hud'),
      fx: make('fx'),
      indicators: make('indicators'),
      overlay: make('overlay'),
    };
    // Append in render order (z-index also enforces stacking).
    this.root.append(this.layers.fx, this.layers.indicators, this.layers.hud, this.layers.overlay);

    // Clicking the UI must not steal keyboard focus from the game canvas —
    // otherwise WASD movement stops until the canvas is clicked again. Only
    // interactive widgets deliver mousedown here (every other area is
    // pointer-events:none and passes through to the canvas), so cancelling the
    // default focus action keeps the canvas focused without blocking taps.
    this.preventFocusSteal = (e: MouseEvent) => e.preventDefault();
    this.root.addEventListener('mousedown', this.preventFocusSteal);
  }

  layer(name: LayerName): HTMLDivElement {
    return this.layers[name];
  }

  /** Remove all layers and their contents from the DOM. */
  dispose(): void {
    this.root.removeEventListener('mousedown', this.preventFocusSteal);
    for (const node of Object.values(this.layers)) node.remove();
  }
}
