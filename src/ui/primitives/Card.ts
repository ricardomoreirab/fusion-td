import { el } from '../dom';
import { onTap } from '../interaction';
import { iconEl, IconName } from '../icons';

export interface CardOpts {
  name: string;
  subtitle?: string;
  /** Authored emblem icon (src/ui/icons.ts). */
  icon: IconName;
  /** Accent color for the emblem + card border (element/tier color). */
  accent?: string;
  /** Small uppercase label across the top (e.g. POWER, FUSION). */
  kind?: string;
  onClick: () => void;
  class?: string;
}

/** A clickable choice card: kind label, struck emblem, name, subtitle. */
export function makeCard(opts: CardOpts): HTMLDivElement {
  const card = el('div', { class: `choice-card${opts.class ? ' ' + opts.class : ''}` });
  if (opts.accent) card.style.setProperty('--accent', opts.accent);
  // The kind row is always present, even when empty. Omitting it lifted the
  // emblem on cards without one (the barbarian has no starting power), so a
  // row of three cards read as misaligned rather than as a set.
  card.appendChild(el('div', { class: 'choice-card__kind', text: opts.kind ?? '' }));
  card.appendChild(el('div', { class: 'choice-card__emblem' }, [iconEl(opts.icon)]));
  card.appendChild(el('div', { class: 'choice-card__name', text: opts.name }));
  if (opts.subtitle) card.appendChild(el('div', { class: 'choice-card__sub', text: opts.subtitle }));
  onTap(card, opts.onClick);
  return card;
}
