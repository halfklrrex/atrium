import { filterSlashItems, type SlashItem } from './slash-items';

export interface SlashState {
  items: SlashItem[];
  /** The element the menu hangs from: the suggestion's decoration at the caret. */
  anchor: HTMLElement | null;
  selected: number;
  select: (item: SlashItem) => void;
}

/**
 * Bridges the TipTap suggestion plugin (plain callbacks) and the React menu: the plugin pushes
 * state in, React subscribes. One controller per editor.
 */
export class SlashController {
  private state: SlashState | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SlashState | null => this.state;

  set(next: Omit<SlashState, 'selected'> & { selected?: number }) {
    const previous = this.state;
    const count = next.items.length;
    const keep = previous && next.selected === undefined ? previous.selected : (next.selected ?? 0);
    this.state = { ...next, selected: count === 0 ? 0 : Math.min(keep, count - 1) };
    this.emit();
  }

  clear() {
    if (!this.state) return;
    this.state = null;
    this.emit();
  }

  move(delta: number) {
    const state = this.state;
    if (!state || state.items.length === 0) return;
    const count = state.items.length;
    this.state = { ...state, selected: (state.selected + delta + count) % count };
    this.emit();
  }

  /** Inserts the highlighted entry. False when there is nothing to insert. */
  chooseSelected(): boolean {
    const state = this.state;
    const item = state?.items[state.selected];
    if (!state || !item) return false;
    state.select(item);
    return true;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

export { filterSlashItems };
