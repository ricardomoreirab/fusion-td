import { el } from '../dom';
import { onTap } from '../interaction';
import { iconEl, IconName } from '../icons';

export type ButtonVariant = 'forged' | 'ghost';

export interface ButtonOpts {
  label: string;
  variant?: ButtonVariant;
  /** Optional leading mark from the authored icon set. */
  icon?: IconName;
  onClick: () => void;
  class?: string;
}

export function makeButton(opts: ButtonOpts): HTMLDivElement {
  const node = el('div', {
    class: `btn btn--${opts.variant ?? 'forged'}${opts.class ? ' ' + opts.class : ''}`,
    attrs: { role: 'button', tabindex: '0' },
  });
  if (opts.icon) node.appendChild(iconEl(opts.icon));
  // The label lives in its own span so callers that swap the text later
  // (the shop's reroll/upgrade buttons) can't wipe the icon out with it.
  node.appendChild(el('span', { class: 'btn__label', text: opts.label }));
  onTap(node, opts.onClick);
  return node;
}

/** Re-label a button without clobbering its icon. Assigning `textContent`
    directly would replace every child, icon included. */
export function setButtonLabel(node: HTMLElement, text: string): void {
  const label = node.querySelector('.btn__label');
  if (label) label.textContent = text;
  else node.textContent = text;
}
