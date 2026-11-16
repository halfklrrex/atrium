# Label editor panel (Status, Priority and Dropdown "Edit Labels")

Owner bug: while dragging labels in the small scrolling popup, the scrollbar grows without end and
dropping a label as the last one is very hard.

## Goals

- "Edit Labels" opens a centered Vibe Modal, large enough to show the whole list without an inner
  scroll for typical lists (up to about 12 labels).
- Dropping a label as the last one is easy: an explicit drop zone below the last row, and the drag
  preview is clamped to the list (vertical axis only), so dragging can't stretch the scroll height.
- Same editors, same Apply / Cancel semantics, same saved data.

## Non-goals

- No change to settings schemas, rules, `packages/shared`, tokens or drag logic (dnd-kit stays).
- The dropdown cell's inline "type to add" flow is unchanged.

## UI

- `StatusLabelEditor` and `DropdownLabelEditor` render a `Modal` (`size="medium"`) with the header
  "Edit labels", the list in `ModalContent` and Cancel / Apply in `ModalFooter`. The status chip
  popup is unmounted while the modal is open and comes back on Cancel or Apply.
- Over about 12 labels the modal body (not the list) scrolls; dnd-kit auto-scrolls it while dragging.
- Z-order: the modal uses `--atrium-z-modal`; the dnd-kit `DragOverlay` (portal on `body`, its own
  z-index) draws above it.
- Opened from the status cell popup and from the column Settings (header menu); both render the
  modal directly.

## Accessibility

- Dialog role and focus trap come from the Modal. Escape cancels without applying; an open color
  picker consumes its own Escape first and returns focus to its swatch.
- Handles keep ArrowUp / ArrowDown reordering and the live-region announcements.
- After Cancel or Apply in the status cell editor, focus returns to the "Edit Labels" button.

## Mobile

- The app-wide phone rule in `index.css` fits every Vibe Modal to the screen (full width with a
  gutter, height capped); the body scrolls and the footer stays visible.

## Tests

- Opens as a dialog with all labels and the end drop zone.
- Keyboard reorder to the last position; Escape cancels without applying; Escape in the color
  picker does not close the modal; focus returns to "Edit Labels".
- `dropTargetId` plus `moveItemOver`: dropping on the end zone makes the row last.
- Existing reorder, color and picker tests keep passing.
