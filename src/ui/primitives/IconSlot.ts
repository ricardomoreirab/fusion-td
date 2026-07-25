import { el } from '../dom';
import { iconEl, IconName } from '../icons';

export interface IconSlotController {
  root: HTMLDivElement;
  setIcon(name: IconName, color: string): void;
  setAccent(color: string): void;
  setEmpty(isEmpty: boolean): void;
  /** Cooldown 0..1 (1 = just fired, 0 = ready). */
  setCooldown(frac: number): void;
  setLevel(level: number): void;
  /** Trigger the ready-pulse FX (cooldown just completed). */
  pulseReady(): void;
}

/**
 * A square power/item/ultimate socket: authored icon, stack badge, and a
 * radial cooldown — a darkening wedge plus a bright rim arc, the language
 * every action game uses, rather than the old top-down window-blind wipe.
 *
 * Both cooldown layers read the same `--cd` custom property, so a refresh is
 * one style write instead of two.
 */
export function makeIconSlot(extraClass = ''): IconSlotController {
  const root = el('div', { class: `slot${extraClass ? ' ' + extraClass : ''}` });
  const icon = el('div', { class: 'slot__icon' });
  const level = el('div', { class: 'slot__level' });
  root.append(
    icon,
    level,
    el('div', { class: 'slot__cd' }),
    el('div', { class: 'slot__ring' }),
  );

  let curLevel = -1;
  let curIcon: IconName | null = null;
  return {
    root,
    setIcon(name, color) {
      if (curIcon !== name) {
        curIcon = name;
        icon.replaceChildren(iconEl(name));
      }
      icon.style.color = color;
    },
    setAccent(color) { root.style.setProperty('--accent', color); },
    setEmpty(isEmpty) { root.classList.toggle('slot--empty', isEmpty); },
    setCooldown(frac) {
      root.style.setProperty('--cd', `${Math.max(0, Math.min(1, frac))}`);
    },
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
