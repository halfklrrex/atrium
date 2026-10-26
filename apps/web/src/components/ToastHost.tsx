import { Toast } from '@vibe/core';
import { useToastStore } from './toast-store';
import styles from './ToastHost.module.css';

const UNDO_VISIBLE_MS = 8000;
const DEFAULT_VISIBLE_MS = 4000;

/** Bottom-centre toast stack, driven by `showToast()` from anywhere in the app. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className={styles.host} aria-live="polite">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          open
          type={toast.type === 'normal' ? 'dark' : toast.type}
          autoHideDuration={toast.action ? UNDO_VISIBLE_MS : DEFAULT_VISIBLE_MS}
          onClose={() => dismiss(toast.id)}
          actions={
            toast.action
              ? [
                  {
                    type: 'button',
                    content: toast.action.label,
                    onClick: () => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    },
                  },
                ]
              : undefined
          }
        >
          {toast.text}
        </Toast>
      ))}
    </div>
  );
}
