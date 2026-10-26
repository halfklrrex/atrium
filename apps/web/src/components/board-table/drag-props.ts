import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

/**
 * What a draggable element needs from `useSortable`: the pointer listeners, plus the id of the
 * screen-reader instructions. dnd-kit's other attributes (`role="button"`, `aria-disabled`,
 * `tabIndex`) would overwrite the table's own row and cell semantics, so they are left out.
 */
export function dragProps(sortable: {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
}) {
  return {
    ...sortable.listeners,
    'aria-describedby': sortable.attributes['aria-describedby'],
  };
}
