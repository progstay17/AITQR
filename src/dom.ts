/** Minimal DOM helpers. No framework: the app is small and must stay auditable. */

export interface ElOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
  props?: Record<string, unknown>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(name, value === true ? "" : String(value));
    }
  }
  if (options.props) Object.assign(node, options.props);
  if (options.on) {
    for (const [type, handler] of Object.entries(options.on)) {
      if (handler) node.addEventListener(type, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function replace(host: HTMLElement, ...children: (Node | string | null | undefined)[]): void {
  host.replaceChildren();
  for (const child of children) {
    if (child === null || child === undefined) continue;
    host.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function fieldId(key: string): string {
  return `field-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
