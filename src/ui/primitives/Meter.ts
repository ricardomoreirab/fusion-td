import { el } from '../dom';
import { iconEl, IconName } from '../icons';

export type MeterKind = 'hp' | 'xp';

export interface MeterController {
  root: HTMLDivElement;
  /** Fill ratio 0..1. */
  setFill(ratio: number): void;
  /** Centred readout, e.g. "132 / 132" (HP only — the XP rail carries no text). */
  setText(text: string): void;
  /** Low-health breathing rim. */
  setDanger(on: boolean): void;
  /** One-shot flash when the value drops. */
  flashHit(): void;
}

/**
 * A forged meter: engraved trough, segment ticks, gloss on the fill and a
 * damage-lag ghost that trails the real value by a beat so a burst of chip
 * damage reads as an amount lost rather than a bar that is merely shorter.
 *
 * The ghost is pure CSS — both layers get the same width and the ghost's
 * delayed transition does the rest, so there is no per-frame JS animating it.
 */
export function makeMeter(kind: MeterKind, icon?: IconName): MeterController {
  const root = el('div', { class: `meter meter--${kind}` });

  const ghost = el('div', { class: 'meter__ghost' });
  const fill = el('div', { class: 'meter__fill' });
  root.append(ghost, fill, el('div', { class: 'meter__ticks' }));

  // The XP rail is a thin secondary indicator: no text, no icon.
  // On HP the icon is pinned to the left edge and the readout is centred in
  // the bar, so the number sits over the fill where the eye already is rather
  // than being flung to the far end of a 236 px plate.
  let value: HTMLSpanElement | null = null;
  if (kind === 'hp') {
    value = el('span', { class: 'meter__value' });
    const label = el('div', { class: 'meter__label' });
    if (icon) label.appendChild(el('span', { class: 'meter__lead' }, [iconEl(icon)]));
    label.appendChild(value);
    root.appendChild(label);
  }

  let hitTimer = 0;

  return {
    root,
    setFill(ratio) {
      const pct = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
      fill.style.width = pct;
      ghost.style.width = pct;
    },
    setText(text) {
      if (value && value.textContent !== text) value.textContent = text;
    },
    setDanger(on) { root.classList.toggle('meter--danger', on); },
    flashHit() {
      root.classList.remove('meter--hit');
      // Force a reflow so a repeat hit restarts the animation instead of
      // being swallowed as "the class is already there".
      void root.offsetWidth;
      root.classList.add('meter--hit');
      window.clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => root.classList.remove('meter--hit'), 200);
    },
  };
}
