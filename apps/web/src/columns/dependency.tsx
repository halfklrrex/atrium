import { canAddDependency, type DependencySettings, type DependencyValue } from '@atrium/shared';
import { Connect } from '@vibe/icons';
import classNames from 'classnames';
import { useContext, useState } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { TableEnvContext } from '../components/board-table/table-env';
import { showToast } from '../components/toast-store';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellContext, type CellProps, type EditorProps } from './types';

const VISIBLE_PILLS = 2;

function useBoardItems(ctx: CellContext) {
  const env = useContext(TableEnvContext);
  const getItems = ctx.getItems ?? env?.getItems;
  return getItems ? getItems() : [];
}

/** Pill chips with linked item names on the same board; collapses overflow into "+N". */
function DependencyCell({ value, ctx }: CellProps<DependencyValue, DependencySettings>) {
  const items = useBoardItems(ctx);
  const itemIds = value?.item_ids ?? [];
  if (itemIds.length === 0) return <div className={styles.root} />;

  const itemMap = new Map(items.map((item) => [item.id, item.name]));
  const names = itemIds.map((id) => itemMap.get(id) ?? 'Unavailable item');
  const shown = names.slice(0, VISIBLE_PILLS);
  const extra = names.length - shown.length;

  return (
    <div className={styles.root}>
      <span className={styles.pills}>
        {shown.map((name, i) => (
          <span key={itemIds[i] ?? i} className={styles.pill}>
            {name}
          </span>
        ))}
        {extra > 0 ? <span className={styles.more}>+{extra}</span> : null}
      </span>
    </div>
  );
}

function DependencyEditor({
  value,
  column,
  ctx,
  anchor,
  onChange,
  onClose,
}: EditorProps<DependencyValue, DependencySettings>) {
  const [query, setQuery] = useState('');
  const items = useBoardItems(ctx);
  const selectedIds = value?.item_ids ?? [];
  const selectedSet = new Set(selectedIds);
  const itemMap = new Map(items.map((item) => [item.id, item.name]));

  const selfItem = items.find((item) => item.id === ctx.itemId);
  const selfParentId = selfItem?.parentItemId ?? null;
  const needle = query.trim().toLowerCase();

  const matches = items.filter((item) => {
    if (item.id === ctx.itemId) return false;
    if ((item.parentItemId ?? null) !== selfParentId) return false;
    if (needle !== '' && !item.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  const write = (nextIds: string[]) => onChange(nextIds.length > 0 ? { item_ids: nextIds } : null);

  const toggle = (targetId: string) => {
    if (selectedSet.has(targetId)) {
      write(selectedIds.filter((id) => id !== targetId));
      return;
    }

    const graph = new Map<string, readonly string[]>();
    for (const it of items) {
      if (it.id === ctx.itemId) {
        graph.set(it.id, selectedIds);
      } else {
        const raw = it.values[column.id] as { item_ids?: string[] } | null | undefined;
        graph.set(it.id, Array.isArray(raw?.item_ids) ? raw.item_ids : []);
      }
    }
    if (ctx.itemId && !graph.has(ctx.itemId)) {
      graph.set(ctx.itemId, selectedIds);
    }

    const check = canAddDependency(graph, ctx.itemId ?? '', targetId);
    if (!check.allowed) {
      showToast(check.reason ?? 'Cannot add circular dependency.', { type: 'negative' });
      return;
    }

    write([...selectedIds, targetId]);
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        {selectedIds.length > 0 ? (
          <div className={popups.selectedPills}>
            {selectedIds.map((id) => {
              const name = itemMap.get(id) ?? 'Unavailable item';
              return (
                <button
                  key={id}
                  type="button"
                  className={popups.selectedPill}
                  aria-label={`Remove ${name}`}
                  onClick={() => write(selectedIds.filter((x) => x !== id))}
                >
                  {name} ×
                </button>
              );
            })}
          </div>
        ) : null}
        <input
          className={popups.input}
          value={query}
          placeholder="Search items…"
          aria-label="Search items"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <div className={popups.list} role="listbox" aria-label={column.title} aria-multiselectable>
          {matches.map((item) => {
            const isSelected = selectedSet.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={classNames(popups.listRow, isSelected && popups.listRowOn)}
                onClick={() => toggle(item.id)}
              >
                <span className={styles.pill}>{item.name}</span>
              </button>
            );
          })}
          {matches.length === 0 ? <p className={popups.muted}>No items found</p> : null}
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const dependencyUi = defineColumnUi<DependencyValue, DependencySettings>({
  type: 'dependency',
  icon: Connect,
  tone: 'orange',
  editor: 'popover',
  Cell: DependencyCell,
  Editor: DependencyEditor,
});
