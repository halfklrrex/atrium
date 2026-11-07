/**
 * After a pointer drag, the browser still fires `click` on pointer-up, which would make the
 * `NavLink` under the cursor navigate. The sidebar DndContexts mark the drag here and rows ask
 * before following a link. Only one drag can be active at a time, so a module flag is enough.
 */
let dragging = false;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
const CLEAR_DELAY_MS = 150;

/**
 * Window-capture `click` handler, which runs before dnd-kit's document-capture one. dnd-kit only
 * calls `stopPropagation` on the click after a drag, so React's `onClick` never runs and the
 * browser would follow the `<a href>` natively (a full page load). Cancelling the default here
 * keeps the link from being followed.
 */
function swallowClick(event: Event) {
  if (!dragging) return;
  event.preventDefault();
  event.stopPropagation();
}

function removeListener() {
  if (!listening || typeof window === 'undefined') return;
  window.removeEventListener('click', swallowClick, true);
  listening = false;
}

export const dragClickGuard = {
  /** Call from DndContext `onDragStart`. */
  start() {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    dragging = true;
    if (!listening && typeof window !== 'undefined') {
      window.addEventListener('click', swallowClick, true);
      listening = true;
    }
  },
  /**
   * Call from `onDragEnd` / `onDragCancel`. The flag clears after a short delay rather than
   * on the very next tick, so the trailing click is still caught if the browser dispatches it
   * after a timer.
   */
  end() {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearTimer = null;
      dragging = false;
      removeListener();
    }, CLEAR_DELAY_MS);
  },
  /** True while, or right after, a drag: the click must not navigate. */
  active() {
    return dragging;
  },
};

/** NavLink `onClick` wrapper: swallows the click that ends a drag, else calls `onNavigate`. */
export function guardedNavigate(onNavigate?: () => void) {
  return (event: { preventDefault: () => void }) => {
    if (dragClickGuard.active()) {
      event.preventDefault();
      return;
    }
    onNavigate?.();
  };
}
