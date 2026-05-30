import { el } from '../dom';

export type PillKind = 'hp' | 'wave' | 'gold';

export interface PillController {
  root: HTMLDivElement;
  /** Set the displayed text. */
  setText(text: string): void;
  /** For the HP pill only — set the fill ratio 0..1. */
  setFill(ratio: number): void;
}

/** A light-forged capsule (HP / wave / gold). The HP variant carries a fill bar. */
export function makePill(kind: PillKind): PillController {
  const root = el('div', { class: `pill pill--${kind} frame frame--lite interactive` });

  let fill: HTMLDivElement | null = null;
  if (kind === 'hp') {
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
