import { el } from '../dom';

export type PillKind = 'hp' | 'wave' | 'level' | 'gold' | 'stats';

export interface PillController {
  root: HTMLDivElement;
  /** Set the displayed text. */
  setText(text: string): void;
  /** For fill-carrying pills (HP, level/XP) — set the fill ratio 0..1. */
  setFill(ratio: number): void;
}

/** A light-forged capsule (HP / wave / level). The HP and level variants carry a fill bar. */
export function makePill(kind: PillKind): PillController {
  const root = el('div', { class: `pill pill--${kind} frame frame--lite interactive` });

  let fill: HTMLDivElement | null = null;
  if (kind === 'hp' || kind === 'level') {
    fill = el('div', { class: 'pill__fill' });
    root.appendChild(fill);
  }
  const txt = el('div', { class: 'pill__txt' });
  root.appendChild(txt);

  return {
    root,
    setText(text) { if (txt.textContent !== text) txt.textContent = text; },
    setFill(ratio) {
      if (fill) fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    },
  };
}
