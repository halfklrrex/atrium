import { create } from 'zustand';

export interface ToastMessage {
  id: number;
  text: string;
  type: 'normal' | 'positive' | 'negative';
  /** Optional action button, e.g. "Undo". */
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: ToastMessage[];
  show: (toast: Omit<ToastMessage, 'id' | 'type'> & { type?: ToastMessage['type'] }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (toast) =>
    set((state) => ({
      // Only the latest few stay on screen.
      toasts: [...state.toasts, { type: 'normal' as const, ...toast, id: nextId++ }].slice(-3),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const showToast = (
  text: string,
  options: { type?: ToastMessage['type']; action?: ToastMessage['action'] } = {},
): void => useToastStore.getState().show({ text, ...options });

/** Placeholder controls (integrations, notifications...) answer with this. */
export const showComingSoon = (what?: string): void =>
  showToast(what ? `${what} is coming soon.` : 'Coming soon.');
