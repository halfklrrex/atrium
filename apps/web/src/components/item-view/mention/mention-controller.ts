export interface MentionPick {
  id: string;
  label: string;
}

export interface MentionSuggestState {
  /** What was typed after the "@". */
  query: string;
  /** The element the list hangs from: the suggestion's decoration at the caret. */
  anchor: HTMLElement | null;
  /** Inserts the chip for the picked member, replacing the "@query". */
  command: (pick: MentionPick) => void;
}

/** Handles a key while the list is open; true when it was used (the editor then ignores it). */
export type MentionKeyHandler = (event: KeyboardEvent) => boolean;

/**
 * Bridges the `@` suggestion plugin and the React list. The plugin pushes the query and the insert
 * command in; the list subscribes, works out the members itself (it only mounts while open, so the
 * member listeners start on demand) and registers its key handler here.
 */
export class MentionController {
  private state: MentionSuggestState | null = null;
  private listeners = new Set<() => void>();
  /** Set by the mounted list. */
  keys: MentionKeyHandler | null = null;

  setKeys(handler: MentionKeyHandler | null) {
    this.keys = handler;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MentionSuggestState | null => this.state;

  set(next: MentionSuggestState) {
    this.state = next;
    this.emit();
  }

  clear() {
    if (!this.state) return;
    this.state = null;
    this.keys = null;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}
