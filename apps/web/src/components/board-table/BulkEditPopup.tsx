import { Button } from '@vibe/core';
import { useCallback, useEffect, useRef } from 'react';
import { AnchoredPopup } from './AnchoredPopup';
import { bulkPeers } from './bulk-edit';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import { useTableStore } from './table-store';
import styles from './table.module.css';

/**
 * "Apply to N selected items" under a cell that was just edited in a selected row. Dismissing it
 * (Escape, "Only this item", a click elsewhere) leaves the normal single edit.
 */
export function BulkEditPopup() {
  const env = useTableEnv();
  const offer = useTableStore((s) => s.bulkOffer);
  const applyRef = useRef<HTMLButtonElement>(null);

  // The edited cell is already mounted; the popup hangs from it.
  const anchor = offer
    ? document.querySelector<HTMLElement>(`[data-cell="${offer.itemId}:${offer.columnId}"]`)
    : null;
  // Enter on the primary button applies: focus it as soon as the popup is there.
  useEffect(() => {
    if (anchor) applyRef.current?.focus();
  }, [anchor, offer]);

  const close = useCallback(() => useTableStore.getState().setBulkOffer(null), []);

  if (!offer || !anchor) return null;
  const apply = () => {
    const { selected } = useTableStore.getState();
    const items = offer.ctx.getItems?.() ?? env.getItems();
    const edited = items.find((i) => i.id === offer.itemId);
    close();
    if (!edited) return;
    void tableActions.applyToSelected(offer, bulkPeers(items, selected, edited));
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={close} label="Apply to selected items">
      <div className={styles.bulkPopup}>
        <Button size="small" onClick={apply} ref={applyRef}>
          {`Apply to ${offer.count} selected items`}
        </Button>
        <Button size="small" kind="tertiary" onClick={close}>
          Only this item
        </Button>
      </div>
    </AnchoredPopup>
  );
}
