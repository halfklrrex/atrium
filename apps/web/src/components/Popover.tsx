import classNames from 'classnames';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Popover.module.css';

const GAP = 4;
const EDGE = 8;
/** Portalled floating layers owned by content inside the panel (Vibe Dropdown menus, Dialog wrappers). */
const INSIDE_SELECTOR =
  '.monday-style-dialog-content-wrapper, [role="listbox"], [role="option"], [data-popup-keep]';

/**
 * A light popover anchored under its trigger: closes on outside click and Escape. Used where the
 * content is richer than a Vibe `Menu` (workspace switcher, board info).
 *
 * The panel renders in a portal on <body> with fixed positioning (tier `--atrium-z-popover`), so it
 * can never be clipped by an ancestor's `overflow` (the sidebar) or painted under sticky table
 * layers. It follows the trigger on scroll and resize, and flips above when there is no room below.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  label,
  align = 'start',
  className,
  panelClassName,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  /** Accessible name of the panel. */
  label: string;
  align?: 'start' | 'end';
  className?: string;
  panelClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;
      const rect = root.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      let left = align === 'end' ? rect.right - width : rect.left;
      left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));
      let top = rect.bottom + GAP;
      if (top + height > window.innerHeight - EDGE) {
        const above = rect.top - GAP - height;
        top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - height - EDGE);
      }
      setStyle({ left, top, minWidth: rect.width });
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const observer = new ResizeObserver(schedule);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer.disconnect();
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      // A Vibe Dropdown/Menu opened from inside the panel renders in its own portal on <body>.
      if (target instanceof Element && target.closest(INSIDE_SELECTOR)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div ref={rootRef} className={classNames(styles.root, className)}>
      {trigger}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={label}
              className={classNames(styles.panel, panelClassName)}
              style={style}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
