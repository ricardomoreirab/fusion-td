import { el } from '../dom';

export interface IconSlotController {
  root: HTMLDivElement;
  setIcon(glyph: string, color: string): void;
  setAccent(color: string): void;
  setEmpty(isEmpty: boolean): void;
  /** Cooldown sweep 0..1 (1 = fully masked / just fired). */
  setCooldown(frac: number): void;
  setLevel(level: number): void;
  /** Trigger the ready-pulse FX (cooldown just completed). */
  pulseReady(): void;
}

/** A square power/item slot: icon, level badge, top-down cooldown mask. */
export function makeIconSlot(extraClass = ''): IconSlotController {
  const root = el('div', { class: `slot frame frame--lite${extraClass ? ' ' + extraClass : ''}` });
  const icon = el('div', { class: 'slot__icon' });
  const level = el('div', { class: 'slot__level' });
  const cd = el('div', { class: 'slot__cd' });
  root.append(icon, level, cd);

  let curLevel = -1;
  return {
    root,
    setIcon(glyph, color) {
      if (icon.textContent !== glyph) icon.textContent = glyph;
      icon.style.color = color;
    },
    setAccent(color) { root.style.setProperty('--accent', color); },
    setEmpty(isEmpty) { root.classList.toggle('slot--empty', isEmpty); },
    setCooldown(frac) { cd.style.height = `${Math.max(0, Math.min(1, frac)) * 100}%`; },
    setLevel(lv) {
      if (lv === curLevel) return;
      curLevel = lv;
      // Set 'block' explicitly — '' would fall back to the stylesheet's
      // `.slot__level { display: none }` and the badge would never show.
      if (lv > 1) { level.textContent = `×${lv}`; level.style.display = 'block'; }
      else level.style.display = 'none';
    },
    pulseReady() {
      root.classList.remove('slot--ready');
      void root.offsetWidth;
      root.classList.add('slot--ready');
    },
  };
}
