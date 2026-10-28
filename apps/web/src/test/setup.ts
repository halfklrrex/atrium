import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom lacks these browser APIs, which Vibe components and our theme code touch.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

Element.prototype.scrollIntoView ??= () => {};

// ProseMirror measures text ranges when it scrolls the caret into view; jsdom has no layout.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

// jsdom has no layout, so every element measures 0x0. Floating UI's `hide()` middleware then
// marks a popover's reference element as hidden, and Vibe's Dialog reacts by closing it: a
// MenuButton menu vanishes about 250 ms after it opens, which loses clicks under load. Report
// a small non-zero box for elements that measure empty, and give the page a viewport size,
// so the reference counts as visible.
const measuredRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const rect = measuredRect.call(this);
  if (rect.width > 0 || rect.height > 0) return rect;
  return new DOMRect(0, 0, 100, 20);
};
for (const [prop, fallback] of [
  ['clientWidth', 1024],
  ['clientHeight', 768],
] as const) {
  const measured = Object.getOwnPropertyDescriptor(Element.prototype, prop)?.get;
  Object.defineProperty(Element.prototype, prop, {
    configurable: true,
    get(this: Element) {
      return measured?.call(this) || fallback;
    },
  });
}
