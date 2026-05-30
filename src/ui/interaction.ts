/** Tap/press + haptic + transient-class helpers for DOM UI.
   Visual press feedback (scale on :active) is handled in CSS — this file
   only wires behaviour. */

/** Fire `fn` on tap (pointerup inside the element) and buzz where supported.
   The element is made an interactive pointer target. Returns a disposer. */
export function onTap(node: HTMLElement, fn: () => void): () => void {
  node.classList.add('interactive');
  const handler = (e: PointerEvent) => {
    e.preventDefault();
    haptic(12);
    fn();
  };
  node.addEventListener('pointerup', handler);
  return () => node.removeEventListener('pointerup', handler);
}

/** Single short vibration where supported (mobile Chrome / Android). */
export function haptic(ms: number = 12): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(ms); } catch { /* ignore */ }
  }
}

/** Add a class, then remove it when its CSS animation ends (one-shot FX).
   Re-adds cleanly if called again mid-animation. */
export function flashClass(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  // Force reflow so re-adding restarts the animation.
  void node.offsetWidth;
  node.classList.add(className);
  const done = () => {
    node.classList.remove(className);
    node.removeEventListener('animationend', done);
  };
  node.addEventListener('animationend', done);
}
