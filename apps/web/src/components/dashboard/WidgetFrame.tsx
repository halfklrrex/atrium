import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Menu, MenuButton, MenuDivider, MenuItem } from '@vibe/core';
import { Delete, Duplicate, Edit } from '@vibe/icons';
import classNames from 'classnames';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { DashboardWidget } from '@atrium/shared';
import styles from './dashboard.module.css';
import { moveHandleId, resizeHandleId } from './handle-ids';

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Arrow key to a one-cell step, or `null` for any other key. */
function arrowStep(event: KeyboardEvent): { x: number; y: number } | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  return ARROWS[event.key] ?? null;
}

export interface WidgetFrameProps {
  widget: DashboardWidget;
  /** Where the card sits in the grid (1-based CSS grid lines). */
  position: { column: number; row: number; width: number; height: number };
  canEdit: boolean;
  /** The pointer drag of this widget's move handle is in progress. */
  moving: boolean;
  onMove: (dx: number, dy: number) => void;
  onResize: (dw: number, dh: number) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  children: ReactNode;
}

/** A widget card: title bar (move handle and menu), the widget body and a resize handle. */
export function WidgetFrame({
  widget,
  position,
  canEdit,
  moving,
  onMove,
  onResize,
  onEdit,
  onDuplicate,
  onRemove,
  children,
}: WidgetFrameProps) {
  const {
    setNodeRef: setCardRef,
    setActivatorNodeRef: setMoveRef,
    attributes: moveAttributes,
    listeners: moveListeners,
    transform,
  } = useDraggable({ id: moveHandleId(widget.id), disabled: !canEdit });
  const {
    setNodeRef: setResizeRef,
    attributes: resizeAttributes,
    listeners: resizeListeners,
  } = useDraggable({ id: resizeHandleId(widget.id), disabled: !canEdit });
  const title = widget.title.trim() || 'Untitled widget';

  const style: CSSProperties = {
    gridColumn: `${position.column} / span ${position.width}`,
    gridRow: `${position.row} / span ${position.height}`,
    // Transform only: the card follows the pointer without touching layout properties.
    transform: CSS.Translate.toString(transform),
  };

  return (
    <section
      ref={setCardRef}
      className={classNames(styles.widget, moving && styles.widgetMoving)}
      style={style}
      aria-label={title}
      data-widget-id={widget.id}
    >
      <header className={styles.widgetHeader}>
        {canEdit ? (
          <div
            {...moveAttributes}
            {...moveListeners}
            ref={setMoveRef}
            role="button"
            tabIndex={0}
            aria-roledescription="movable widget"
            aria-label={`Move ${title}. Use the arrow keys to move it.`}
            className={classNames(styles.widgetTitle, styles.handle)}
            onKeyDown={(event) => {
              const step = arrowStep(event);
              if (!step) return;
              event.preventDefault();
              onMove(step.x, step.y);
            }}
          >
            {title}
          </div>
        ) : (
          <h3 className={styles.widgetTitle}>{title}</h3>
        )}
        {canEdit ? (
          <MenuButton
            size="xs"
            aria-label={`Options for ${title}`}
            closeMenuOnItemClick
            className={styles.widgetMenu}
          >
            <Menu id={`widget-menu-${widget.id}`} size="medium">
              <MenuItem title="Edit" icon={Edit} onClick={onEdit} />
              <MenuItem title="Duplicate" icon={Duplicate} onClick={onDuplicate} />
              <MenuDivider />
              <MenuItem title="Remove" icon={Delete} onClick={onRemove} />
            </Menu>
          </MenuButton>
        ) : null}
      </header>
      <div className={styles.widgetBody}>{children}</div>
      {canEdit ? (
        <div
          {...resizeAttributes}
          {...resizeListeners}
          ref={setResizeRef}
          role="button"
          tabIndex={0}
          aria-roledescription="resizable widget"
          aria-label={`Resize ${title}. Use the arrow keys to resize it.`}
          className={styles.resizeHandle}
          onKeyDown={(event) => {
            const step = arrowStep(event);
            if (!step) return;
            event.preventDefault();
            onResize(step.x, step.y);
          }}
        />
      ) : null}
    </section>
  );
}
