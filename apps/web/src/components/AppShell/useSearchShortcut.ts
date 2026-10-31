import { useEffect } from 'react';
import { isTypingTarget } from './typing-target';
import { useUiStore } from './ui-store';

/**
 * Ctrl/Cmd+B or Ctrl/Cmd+K toggles the global search. Ignored while typing in a field or editor
 * (Ctrl+B bolds text there), and while another dialog is open.
 */
export function useSearchShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'b' && key !== 'k') return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      const { dialog, openDialog, closeDialog } = useUiStore.getState();
      if (dialog?.type === 'search') closeDialog();
      else if (!dialog) openDialog({ type: 'search' });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
