import { el } from '../dom';
import { onTap } from '../interaction';

export type ButtonVariant = 'forged' | 'ghost';

export interface ButtonOpts {
  label: string;
  variant?: ButtonVariant;
  onClick: () => void;
  class?: string;
}

export function makeButton(opts: ButtonOpts): HTMLDivElement {
  const node = el('div', {
    class: `btn btn--${opts.variant ?? 'forged'}${opts.class ? ' ' + opts.class : ''}`,
    text: opts.label,
    attrs: { role: 'button', tabindex: '0' },
  });
  onTap(node, opts.onClick);
  return node;
}
