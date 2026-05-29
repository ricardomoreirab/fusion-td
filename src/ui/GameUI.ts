import { el } from './dom';

export type LayerName = 'hud' | 'fx' | 'indicators' | 'overlay';

/** Owns the layer divs inside #ui-root. One instance per game state that
   needs DOM UI; dispose() removes everything so the overlay resets fully. */
export class GameUI {
  private root: HTMLElement;
  private layers: Record<LayerName, HTMLDivElement>;

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
  }

  layer(name: LayerName): HTMLDivElement {
    return this.layers[name];
  }

  /** Remove all layers and their contents from the DOM. */
  dispose(): void {
    for (const node of Object.values(this.layers)) node.remove();
  }
}
