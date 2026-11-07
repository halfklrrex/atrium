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

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (toast) => {
    const id = nextId++;
    set((state) => ({
      // Only the latest few stay on screen.
      toasts: [...state.toasts, { type: 'normal' as const, ...toast, id }].slice(-3),
    }));
    return id;
  },
  update: (id, toast) =>
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { type: 'normal' as const, ...toast, id } : t,
      ),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

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
  options: { type?: ToastMessage['type']; action?: ToastMessage['action'] } = {},
): void => {
  const store = useToastStore.getState();
  if (store.toasts.some((t) => t.id === id)) store.update(id, { text, ...options });
  else store.show({ text, ...options });
};

/** Placeholder controls (integrations, notifications...) answer with this. */
export const showComingSoon = (what?: string): void => {
  showToast(what ? `${what} is coming soon.` : 'Coming soon.');
};
