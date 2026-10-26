# 2026-10-26: Claude (Sonnet 5.5): P3 Kanban view

Spec: `docs/specs/P3-kanban.md` (the measured version). Branch `claude/p3-kanban`.

## What was done

- **Settings:** `settings.kanban` is now a zod schema in `packages/shared/src/schemas/view.ts` (`kanbanSettingsSchema`, `defaultKanbanSettings`, `KANBAN_EMPTY_LANE`). `cardColumnIds: null` means "the first three non-status, non-derived columns". Firestore rules were not changed: they already accept `settings.kanban` as a map, and the zod schema validates it in the client.
- **Per-view state:** `ViewState` in `filter-store.ts` carries `kanban` (null for tables). Card fields, the lane column, empty lanes and collapsed lanes are unsaved view changes until "Save to this view". New actions: `setKanban`, `toggleLane`; new hook `useKanbanSettings`.
- **UI:** `apps/web/src/components/board-kanban/` (`KanbanBoard`, `KanbanLane`, `KanbanCard`, `KanbanSettingsPopover`, the pure `kanban-model.ts`). Tokens are in `theme/kanban-tokens.css`.
- **Writes:** `itemWrites.setValueAndMove` and `tableActions.setCellAndMove` write the status and the new position in one document write. A drop inside a lane writes the position only (`tableActions.moveItem`).
- **Toolbar:** `BoardToolbar` takes `variant="kanban"` (no New item, Hide or Group by) and a `trailing` slot (status bar and settings gear).
- **Tests:** model and board tests in `board-kanban/`, store tests in `view-state.test.ts`, showcase "Status board" view, visual screens `board-kanban` and `board-kanban-collapsed`.

## Gotchas

- Cards in a lane are ordered by `position` alone. Items of different groups can share a lane, so positions of different groups interleave; that is intended.
- dnd-kit's keyboard sensor needs the card's own `onKeyDown` to call the sensor's handler (see `CardBody`). Space picks a card up and drops it; Enter opens the item.
- Lanes with more than 100 cards virtualise against the board's scroll element (`VirtualCards`). It is not covered by a unit test (jsdom has no layout).

## Next

- Ophelia's measured VF pass against monday's real Kanban (card field rows for people and dates, dark lane body contrast).
- Subitem count on a card opens the full item view; monday expands subitems inline.
