import { el } from '../dom';
import { makeFrame } from './Frame';

export interface ModalController {
  /** Full-screen scrim (interactive — blocks clicks to the canvas). */
  root: HTMLDivElement;
  /** The ornate panel. */
  panel: HTMLDivElement;
  /** Append your content into this container. */
  body: HTMLDivElement;
  setTitle(text: string): void;
  /** Remove the modal from the DOM. */
  dispose(): void;
}

export interface ModalOpts {
  title?: string;
  /** Extra class on the panel (e.g. for a width modifier). */
  panelClass?: string;
}

/** An ornate modal: a dimming scrim + a centered forged panel with a title
    and a body container. The scrim is `.interactive` so it blocks the canvas. */
export function makeModal(opts: ModalOpts = {}): ModalController {
  const root = el('div', { class: 'modal-scrim interactive' });
  const panel = makeFrame({ variant: 'ornate', class: `modal-panel${opts.panelClass ? ' ' + opts.panelClass : ''}` });
  const title = el('div', { class: 'modal-title' });
  if (opts.title) title.textContent = opts.title;
  const body = el('div', { class: 'modal-body' });
  panel.append(title, body);
  root.appendChild(panel);
  return {
    root, panel, body,
    setTitle(t) { title.textContent = t; },
    dispose() { root.remove(); },
  };
}
