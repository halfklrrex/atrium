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
import styles from './AnchoredPopup.module.css';

interface AnchoredPopupProps {
  /** Element the popup hangs from (the cell or header). */
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
  /** Centre under the anchor instead of aligning the left edges. */
  center?: boolean;
  className?: string;
}

const GAP = 4;
const EDGE = 8;

/** Targets inside Vibe's own floating layers (date picker dropdowns, menus) never count as outside. */
const FLOATING_LAYERS = '[role="listbox"], [role="menu"], [role="option"], [data-popup-keep]';

/**
 * A panel in a portal, positioned under `anchor` and kept inside the viewport. Closes on Escape and
 * on a press outside (the anchor itself is "inside": its own click decides what happens). The
 * panel follows the anchor while the board scrolls.
 */
export function AnchoredPopup({
  anchor,
  onClose,
  label,
  children,
  center = false,
  className,
}: AnchoredPopupProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = anchor.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      let left = center ? rect.left + rect.width / 2 - width / 2 : rect.left;
      left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));
      let top = rect.bottom + GAP;
      if (top + height > window.innerHeight - EDGE) {
        const above = rect.top - GAP - height;
        top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - height - EDGE);
      }
      setStyle({ left, top });
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
  }, [anchor, center]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;
      if (target instanceof Element && target.closest(FLOATING_LAYERS)) return;
      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor]);

  if (!anchor) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={classNames(styles.popup, className)}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}
