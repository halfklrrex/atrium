import { Button, Icon, IconButton, Menu, MenuButton, MenuItem } from '@vibe/core';
import { Archive, Close, Delete, Download, Duplicate } from '@vibe/icons';
import { useMemo } from 'react';
import { buildBoardCsvRows } from '../boards/board-export';
import { runExport, type ExportFormat } from '../boards/export-run';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import { useTableStore } from './table-store';
import styles from './table.module.css';

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
      buildRows: (fmt) => {
        const shown = new Set(env.columns.map((c) => c.def.id));
        return buildBoardCsvRows({
          board: { id: env.boardId },
          items: env.getModels().flatMap((m) => m.items),
          itemIds: ids,
          subitems: env
            .getItems()
            .filter((i) => i.parentItemId !== null && i.parentItemId !== undefined),
          columns: ctx.columns,
          subitemColumns: ctx.subitemColumns ?? [],
          hiddenColumnIds: ctx.columns.map((c) => c.id).filter((id) => !shown.has(id)),
          groups: env.groups,
          personNames: env.userLookup ?? (() => undefined),
          typed: fmt === 'xlsx',
        });
      },
    });
  const exportButton = (
    <MenuButton
      aria-label="Export"
      component={ExportLabel}
      size="small"
      closeMenuOnItemClick
      dialogPosition="top-start"
    >
      <Menu id="batch-export-menu" size="medium">
        <MenuItem title="CSV" onClick={() => void exportSelection('csv')} />
        <MenuItem title="Excel (.xlsx)" onClick={() => void exportSelection('xlsx')} />
      </Menu>
    </MenuButton>
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
              <Button
                kind="tertiary"
                size="small"
                leftIcon={Duplicate}
                onClick={() =>
                  void tableActions
                    .duplicateItems(
                      ctx,
                      items,
                      (g) => env.getModels().find((m) => m.group.id === g)?.all ?? [],
                    )
                    .then(clear)
                }
              >
                Duplicate
              </Button>
            </>
          ) : null}
          {exportButton}
          {env.canEdit ? (
            <>
              <Button
                kind="tertiary"
                size="small"
                leftIcon={Archive}
                onClick={() =>
                  void tableActions.retireItems(ctx, ids, 'archived').then(afterAction)
                }
              >
                Archive
              </Button>
              <Button
                kind="tertiary"
                size="small"
                leftIcon={Delete}
                onClick={() => void tableActions.retireItems(ctx, ids, 'deleted').then(afterAction)}
              >
                Delete
              </Button>
              <MenuButton
                text="Move to"
                componentPosition="end"
                size="small"
                closeMenuOnItemClick
                dialogPosition="top-start"
              >
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
              </MenuButton>
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

/** The Export button's face: the download icon and its label (a MenuButton has no text prop). */
function ExportLabel() {
  return (
    <span className={styles.batchExport}>
      <Icon icon={Download} iconSize={16} />
      Export
    </span>
  );
}
