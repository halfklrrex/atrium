/**
 * After a pointer drag, the browser still fires `click` on pointer-up, which would make the
 * `NavLink` under the cursor navigate. The sidebar DndContexts mark the drag here and rows ask
 * before following a link. Only one drag can be active at a time, so a module flag is enough.
 */
let dragging = false;
const CLEAR_DELAY_MS = 150;

export const dragClickGuard = {
  /** Call from DndContext `onDragStart`. */
  start() {
    dragging = true;
  },
  /**
   * Call from `onDragEnd` / `onDragCancel`. The flag clears after a short delay rather than
   * on the very next tick, so the trailing click is still caught if the browser dispatches it
   * after a timer.
   */
  end() {
    setTimeout(() => {
      dragging = false;
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
