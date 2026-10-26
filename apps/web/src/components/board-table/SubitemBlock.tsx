import type { GroupDef } from '@atrium/shared';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { memo, useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { ItemDoc } from '../../data';
import { AddItemRow } from './AddItemRow';
import { HeaderRow } from './HeaderRow';
import { SubitemRow } from './ItemRow';
import { tableActions, type TableCtx } from './table-actions';
import { TableEnvContext, useTableEnv, type TableEnv } from './table-env';
import { NAME_COLUMN, clampWidth, subitemGridTemplate, subitemTableWidth } from './table-model';
import styles from './table.module.css';

const ADD_TRACK = 'var(--atrium-table-add-width)';
const INDENT = 'var(--atrium-subitem-indent)';
/** The Item track of the parent table, set live by the table while its width is being dragged. */
const NAME_TRACK = 'var(--atrium-table-name-live)';

/**
 * Everything inside a subitem block (and the lifted copy of a dragged subitem) reads the table
 * environment through this scope: the subitem columns instead of the board's, an action context
 * whose column writes go to `board.subitemColumns`, and its own grid template.
 */
export function SubitemScope({
  groupColor,
  className,
  children,
}: {
  groupColor: string;
  className?: string;
  children: ReactNode;
}) {
  const env = useTableEnv();
  const [live, setLive] = useState<Record<string, number>>({});

  const defs = useMemo(() => env.subitemColumns.map((c) => c.def), [env.subitemColumns]);
  const columns = useMemo(
    () => env.subitemColumns.map((c) => (live[c.def.id] ? { ...c, width: live[c.def.id]! } : c)),
    [env.subitemColumns, live],
  );
  const ctx = useMemo<TableCtx>(
    () => ({ ...env.ctx, columns: defs, subitemColumns: defs, scope: 'subitems' }),
    [env.ctx, defs],
  );

  const { getItems: getAllItems } = env;
  const getItems = useCallback(() => getAllItems().filter((i) => i.parentItemId), [getAllItems]);

  const onResize = useCallback(
    (columnId: string, width: number, final: boolean) => {
      if (columnId === NAME_COLUMN) return;
      const next = clampWidth(width);
      setLive((c) => ({ ...c, [columnId]: next }));
      if (!final) return;
      void tableActions.resizeColumn(ctx, columnId, next).finally(() =>
        setLive((c) => {
          const { [columnId]: _removed, ...rest } = c;
          return rest;
        }),
      );
    },
    [ctx],
  );

  const scoped = useMemo<TableEnv>(
    () => ({ ...env, columns, ctx, getItems, getModels: () => [], onResize }),
    [env, columns, ctx, getItems, onResize],
  );

  const style = {
    '--group-color': groupColor,
    '--atrium-table-cols': subitemGridTemplate(NAME_TRACK, columns, ADD_TRACK, INDENT),
    '--atrium-table-width': subitemTableWidth(NAME_TRACK, columns, ADD_TRACK, INDENT),
  } as CSSProperties;

  return (
    <TableEnvContext.Provider value={scoped}>
      <div className={className} style={style}>
        {children}
      </div>
    </TableEnvContext.Provider>
  );
}

interface SubitemBlockProps {
  parent: ItemDoc;
  group: GroupDef;
  subitems: readonly ItemDoc[];
  term: string;
  dragDisabled: boolean;
}

/**
 * The mini table under an open parent row: its own header (the board's `subitemColumns`), one row
 * per subitem and "+ Add subitem". Subitems are sortable only inside this block.
 */
export const SubitemBlock = memo(function SubitemBlock({
  parent,
  group,
  subitems,
  term,
  dragDisabled,
}: SubitemBlockProps) {
  const ids = useMemo(() => subitems.map((s) => s.id), [subitems]);
  // The header keeps its own state (rename, settings) apart from the group's header of the same
  // columns: those are keyed by this id.
  const headerGroup = useMemo<GroupDef>(
    () => ({ ...group, id: `sub:${parent.id}`, title: `Subitems of ${parent.name}` }),
    [group, parent.id, parent.name],
  );

  return (
    <SubitemScope groupColor={group.color} className={styles.subBlock}>
      <div role="grid" aria-label={`Subitems of ${parent.name}`}>
        <HeaderRow group={headerGroup} itemIds={ids} />
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {subitems.map((sub) => (
            <SubitemRow
              key={sub.id}
              item={sub}
              groupColor={group.color}
              term={term}
              dragDisabled={dragDisabled}
            />
          ))}
        </SortableContext>
        <AddItemRow group={group} items={subitems} parent={parent} />
      </div>
    </SubitemScope>
  );
});
