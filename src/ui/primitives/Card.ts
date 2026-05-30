import { el } from '../dom';
import { onTap } from '../interaction';

export interface CardOpts {
  name: string;
  subtitle?: string;
  glyph: string;
  /** Accent color for the emblem + card border (element/tier color). */
  accent?: string;
  /** Small uppercase label across the top (e.g. POWER, FUSION). */
  kind?: string;
  onClick: () => void;
  class?: string;
}

/** A clickable choice card: kind label, glyph emblem, name, subtitle. */
export function makeCard(opts: CardOpts): HTMLDivElement {
  const card = el('div', { class: `choice-card${opts.class ? ' ' + opts.class : ''}` });
  if (opts.accent) card.style.setProperty('--accent', opts.accent);
  if (opts.kind) card.appendChild(el('div', { class: 'choice-card__kind', text: opts.kind }));
  card.appendChild(el('div', { class: 'choice-card__emblem', text: opts.glyph }));
  card.appendChild(el('div', { class: 'choice-card__name', text: opts.name }));
  if (opts.subtitle) card.appendChild(el('div', { class: 'choice-card__sub', text: opts.subtitle }));
  onTap(card, opts.onClick);
  return card;
}
