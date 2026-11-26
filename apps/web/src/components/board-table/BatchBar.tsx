import { Dialog, DialogContentContainer, Icon, IconButton, Menu, MenuItem } from '@vibe/core';
import { Archive, Close, Delete, Download, Duplicate, MoveArrowRight } from '@vibe/icons';
import { forwardRef, type ComponentPropsWithoutRef, useMemo } from 'react';
import { buildBoardCsvRows, type BoardCsvInput } from '../boards/board-export';
import { runExport, type ExportFormat } from '../boards/export-run';
import { buildBoardWorkbookData } from '../boards/workbook-data';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import { useTableStore } from './table-store';
import styles from './table.module.css';

interface BatchActionProps extends ComponentPropsWithoutRef<'button'> {
  icon: typeof Archive;
  label: string;
}

/** One bar action, monday-style: a 16-px icon stacked over a small label. */
const BatchAction = forwardRef<HTMLButtonElement, BatchActionProps>(function BatchAction(
  { icon, label, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" className={styles.batchAction} {...rest}>
      <Icon icon={icon} size={16} />
      <span>{label}</span>
    </button>
  );
});

/** monday's floating bar for the selected items: count, group dots and the batch actions. */
export function BatchBar() {
  const env = useTableEnv();
  const selected = useTableStore((s) => s.selected);
  const clear = useTableStore((s) => s.clearSelection);

  const items = useMemo(
    () => env.getItems().filter((item) => selected.has(item.id)),
    // `getItems` reads a ref; the selection is what decides when this changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected],
  );
  const groupColors = useMemo(() => {
    const ids = new Set(items.map((i) => i.groupId));
    return env.groups.filter((g) => ids.has(g.id)).map((g) => ({ id: g.id, color: g.color }));
  }, [items, env.groups]);

  if (items.length === 0) return null;
  const ids = items.map((i) => i.id);
  const { ctx } = env;

  /** Exports only the selected rows (subitems of a selected parent follow it), in view order. */
  const exportSelection = (format: ExportFormat) =>
    runExport({
      format,
      boardName: env.boardName ?? 'Board',
      itemCount: items.length,
      buildRows: () => buildBoardCsvRows(selectionInput()),
      // The Summary and Items describe the selection only; view sheets are left out (spec).
      buildWorkbook: () =>
        buildBoardWorkbookData({
          ...selectionInput(),
          boardName: env.boardName ?? 'Board',
          now: new Date(),
        }),
    });
  const selectionInput = (): BoardCsvInput => {
    const shown = new Set(env.columns.map((c) => c.def.id));
    return {
      board: { id: env.boardId },
      items: env.getModels().flatMap((m) => m.items),
      itemIds: ids,
      subitems: env
        .getItems()
        .filter((i) => i.parentItemId !== null && i.parentItemId !== undefined),
      columns: ctx.columns,
      subColumns: ctx.subColumns ?? ctx.columns,
      hiddenColumnIds: ctx.columns.map((c) => c.id).filter((id) => !shown.has(id)),
      groups: env.groups,
      personNames: env.userLookup ?? (() => undefined),
    };
  };
  const exportButton = (
    <Dialog
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esckey', 'onContentClick']}
      position="top-start"
      moveBy={{ main: 0, secondary: 0 }}
      content={
        <DialogContentContainer>
          <Menu id="batch-export-menu" size="medium">
            <MenuItem title="CSV" onClick={() => void exportSelection('csv')} />
            <MenuItem title="Excel (.xlsx)" onClick={() => void exportSelection('xlsx')} />
          </Menu>
        </DialogContentContainer>
      }
    >
      <BatchAction icon={Download} label="Export" aria-haspopup="menu" />
    </Dialog>
  );
  const afterAction = (ok: boolean | void) => {
    if (ok !== false) clear();
  };

  return (
    <div className={styles.batch} data-print="hide">
      <div className={styles.batchCard} role="region" aria-label="Selected items">
        <span className={styles.batchCount} aria-hidden="true">
          {items.length}
        </span>
        <span>{items.length === 1 ? 'Item selected' : 'Items selected'}</span>
        <span className={styles.batchDots} aria-hidden="true">
          {groupColors.map((g) => (
            <span key={g.id} className={styles.batchDot} style={{ backgroundColor: g.color }} />
          ))}
        </span>
        <span className={styles.batchDivider} />
        <span className={styles.batchActions}>
          {env.canEdit ? (
            <>
              <BatchAction
                icon={Duplicate}
                label="Duplicate"
                onClick={() =>
                  void tableActions
                    .duplicateItems(
                      ctx,
                      items,
                      (g) => env.getModels().find((m) => m.group.id === g)?.all ?? [],
                    )
                    .then(clear)
                }
              />
            </>
          ) : null}
          {exportButton}
          {env.canEdit ? (
            <>
              <BatchAction
                icon={Archive}
                label="Archive"
                onClick={() =>
                  void tableActions.retireItems(ctx, ids, 'archived').then(afterAction)
                }
              />
              <BatchAction
                icon={Delete}
                label="Delete"
                onClick={() => void tableActions.retireItems(ctx, ids, 'deleted').then(afterAction)}
              />
              <Dialog
                showTrigger={['click']}
                hideTrigger={['clickoutside', 'esckey', 'onContentClick']}
                position="top-start"
                moveBy={{ main: 0, secondary: 0 }}
                content={
                  <DialogContentContainer>
                    <Menu id="batch-move-menu" size="medium">
                      {env.groups.map((group) => (
                        <MenuItem
                          key={group.id}
                          title={group.title}
                          onClick={() => {
                            const target =
                              env.getModels().find((m) => m.group.id === group.id)?.all ?? [];
                            void tableActions
                              .moveItemsToGroup(ctx, items, group.id, target)
                              .then(clear);
                          }}
                        />
                      ))}
                    </Menu>
                  </DialogContentContainer>
                }
              >
                <BatchAction icon={MoveArrowRight} label="Move to" aria-haspopup="menu" />
              </Dialog>
            </>
          ) : null}
          <IconButton
            icon={Close}
            size="small"
            kind="tertiary"
            aria-label="Clear selection"
            onClick={clear}
          />
        </span>
      </div>
    </div>
  );
}
