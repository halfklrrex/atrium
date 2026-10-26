# 2026-10-24 · Claude · VF3 empty states and illustrations

## Done

- **`EmptyState` component** (`apps/web/src/components/EmptyState/`): `page`, `panel` and `inline` sizes, built from tokens. Actions can be a button, a link, a route, or a ready-made element. It fades in with an 8px rise (200ms, transform and opacity only) and respects `prefers-reduced-motion`.
- **Illustration set** (`apps/web/src/components/illustrations/`): `EmptyMyWork`, `EmptyWorkspace`, `EmptyRecents`, `NoSearchResults`, `AllCaughtUp`, `NotFound` and `NoFavorites`. All are original inline SVG, each well under 6 KB. Colours come from a compact `--illus-*` block in `tokens.css`, with separate dark and black values.
- **Wired in:**
  - `/my-work`: tab row, toolbar and the page state, with a local "Learn about My work" popover.
  - Home, "Recently visited".
  - An empty workspace.
  - The sidebar: "No boards yet" with "+ Create board", and the favorites hint.
  - The catch-all 404, which unknown workspace ids and unknown board ids also render.
  - The workspace switcher's "No workspaces match".
- **Notifications panel** (`AppShell/NotificationsPanel.tsx`): opened from the top bar's bell, 480px wide, slides in with a transform. It closes on Esc, outside click or the close button. It is a UI shell only; real notifications arrive in P4. `notificationsOpen` lives in `ui-store`.

## Gotchas

- `BoardPage.tsx` got a one-line change: its "board not found" branch now returns `<NotFoundPage />`. The spec asks for unknown boards to land on the 404. Nothing else in the page changed.
- `NoSearchResults` is exported for P1b's board search; it's only used in the workspace switcher for now.
- Vibe `IconButton` does not forward `data-*` attributes, so the bell is wrapped in a `span[data-notifications-trigger]`, which the panel uses for outside-click and focus return.
- Vibe disabled buttons use `aria-disabled`, not the `disabled` attribute.
- The dev server screenshot tool captures one frame behind, so animated states can look half-drawn. Take a second capture.

## Next

- A dedicated "Learn more" page for My work, if the owner wants one.
- Real notifications content and the Teams-style banner in P4.
