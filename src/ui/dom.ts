/** Minimal DOM builder. No framework — just typed element creation. */
export interface ElProps {
  class?: string;
  text?: string;
  /** Inline style: either a CSS string or property map. Supports custom props (--x). */
  style?: string | Record<string, string>;
  /** data-* attributes. */
  data?: Record<string, string>;
  /** Arbitrary attributes (aria-*, role, etc.). */
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.style) {
    if (typeof props.style === 'string') {
      node.style.cssText = props.style;
    } else {
      for (const [k, v] of Object.entries(props.style)) {
        node.style.setProperty(k, v);
      }
    }
  }
  if (props.data) {
    for (const [k, v] of Object.entries(props.data)) node.dataset[k] = v;
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Set a CSS custom property on an element (typed convenience). */
export function setVar(node: HTMLElement, name: `--${string}`, value: string): void {
  node.style.setProperty(name, value);
}
