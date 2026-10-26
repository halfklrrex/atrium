import type { GroupDef } from '@atrium/shared';
import { memo } from 'react';
import type { ItemDoc } from '../../data';
import { ItemRow } from './ItemRow';
import { SubitemBlock } from './SubitemBlock';
import { useTableStore } from './table-store';

interface ItemEntryProps {
  item: ItemDoc;
  group: GroupDef;
  term: string;
  dragDisabled: boolean;
  /** The item's subitems in order; `undefined` when it has none. */
  subitems: readonly ItemDoc[] | undefined;
  /** The search matched a subitem of this item: open its block while the search is active. */
  autoExpanded: boolean;
}

const NO_SUBITEMS: readonly ItemDoc[] = [];

/**
 * An item row plus its subitem block when open. Memoised so unrelated edits do not re-render it;
 * `subitems` stays `undefined` (not a fresh array) for items without any.
 */
export const ItemEntry = memo(function ItemEntry({
  item,
  group,
  term,
  dragDisabled,
  subitems,
  autoExpanded,
}: ItemEntryProps) {
  const opened = useTableStore((s) => s.expanded.has(item.id));
  const expanded = opened || autoExpanded;
  const list = subitems ?? NO_SUBITEMS;

  return (
    <ItemRow
      item={item}
      group={group}
      term={term}
      dragDisabled={dragDisabled}
      subitemCount={list.length}
      expanded={expanded}
    >
      {expanded ? (
        <SubitemBlock
          parent={item}
          group={group}
          subitems={list}
          term={term}
          dragDisabled={dragDisabled}
        />
      ) : null}
    </ItemRow>
  );
});
