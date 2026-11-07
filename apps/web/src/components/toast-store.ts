import { create } from 'zustand';

export interface ToastMessage {
  id: number;
  text: string;
  type: 'normal' | 'positive' | 'negative';
  /** Optional action button, e.g. "Undo". */
  action?: { label: string; onClick: () => void };
  /** Shows a small spinner and keeps the toast open until it is updated or dismissed. */
  loading?: boolean;
}

interface ToastState {
  toasts: ToastMessage[];
  show: (toast: Omit<ToastMessage, 'id' | 'type'> & { type?: ToastMessage['type'] }) => number;
  /** Replaces what a shown toast says (e.g. "Updating..." becomes "Updated"); no-op once gone. */
  update: (
    id: number,
    toast: Omit<ToastMessage, 'id' | 'type'> & { type?: ToastMessage['type'] },
  ) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** A loading toast closes itself after this long, so a hung write cannot leave a spinner forever. */
export const LOADING_TOAST_MAX_MS = 30_000;
/** How many toasts stay on screen. */
const MAX_TOASTS = 3;

const loadingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const clearLoadingTimer = (id: number): void => {
  const timer = loadingTimers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  loadingTimers.delete(id);
};

/** Keeps the newest toasts; a loading toast is only evicted when nothing else can be. */
function trim(toasts: ToastMessage[]): ToastMessage[] {
  const out = [...toasts];
  while (out.length > MAX_TOASTS) {
    const index = out.findIndex((t) => !t.loading);
    out.splice(index === -1 ? 0 : index, 1);
  }
  return out;
}

export const useToastStore = create<ToastState>()((set, get) => {
  const armLoadingTimer = (id: number, loading?: boolean): void => {
    clearLoadingTimer(id);
    if (loading) {
      loadingTimers.set(
        id,
        setTimeout(() => get().dismiss(id), LOADING_TOAST_MAX_MS),
      );
    }
  };
  return {
    toasts: [],
    show: (toast) => {
      const id = nextId++;
      set((state) => {
        const next = trim([...state.toasts, { type: 'normal' as const, ...toast, id }]);
        for (const t of state.toasts) if (!next.some((n) => n.id === t.id)) clearLoadingTimer(t.id);
        return { toasts: next };
      });
      armLoadingTimer(id, toast.loading);
      return id;
    },
    update: (id, toast) => {
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === id ? { type: 'normal' as const, ...toast, id } : t,
        ),
      }));
      armLoadingTimer(id, toast.loading);
    },
    dismiss: (id) => {
      clearLoadingTimer(id);
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    },
  };
});

export const showToast = (
  text: string,
  options: {
    type?: ToastMessage['type'];
    action?: ToastMessage['action'];
    loading?: boolean;
  } = {},
): number => useToastStore.getState().show({ text, ...options });

/** Turns a toast already on screen into another message (or shows it fresh if it is gone). */
export const updateToast = (
  id: number,
  text: string,
  options: {
    type?: ToastMessage['type'];
    action?: ToastMessage['action'];
    loading?: boolean;
  } = {},
): void => {
  const store = useToastStore.getState();
  if (store.toasts.some((t) => t.id === id)) store.update(id, { text, ...options });
  else store.show({ text, ...options });
};

/** Placeholder controls (integrations, notifications...) answer with this. */
export const showComingSoon = (what?: string): void => {
  showToast(what ? `${what} is coming soon.` : 'Coming soon.');
};
