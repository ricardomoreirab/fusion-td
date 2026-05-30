import { el } from '../dom';

export type FrameVariant = 'ornate' | 'lite';

export interface FrameOpts {
  variant: FrameVariant;
  /** Optional accent color (element/tier) applied as the --accent custom prop. */
  accent?: string;
  class?: string;
}

/** A forged panel. `ornate` for menus, `lite` for the in-game HUD. */
export function makeFrame(opts: FrameOpts): HTMLDivElement {
  const node = el('div', {
    class: `frame frame--${opts.variant}${opts.class ? ' ' + opts.class : ''}`,
  });
  if (opts.accent) node.style.setProperty('--accent', opts.accent);
  return node;
}
