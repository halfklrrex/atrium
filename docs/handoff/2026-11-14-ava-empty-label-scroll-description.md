# 2026-11-14 · Ava (Antigravity, Claude Sonnet fallback) · empty label first, scrollable description

## Done

- Bug inbox: the grey "empty" label sat among the named labels in the Status/Priority picker. `orderStatusLabels` (`packages/shared/src/columns/status.ts`) puts the blank label first, then the rest by index; the picker (`apps/web/src/columns/status.tsx`) uses it. The Edit Labels dialog already hides the blank label, so it is unchanged. Kanban, charts and exports keep their own ordering (ask the owner if they should follow).
- Bug inbox: the sidebar description no longer clamps with Show more / Show less. `DescriptionEditor` has a `scrollable` prop (replaces `clamp`); the box grows to 12 lines (`--atrium-item-panel-desc-max-lines`, `DESCRIPTION_MAX_LINES`) then scrolls inside. `descriptionMode` and the measuring effect are gone.
- `AGENTS.md`: new rule that HANDOFF.md and monday are updated constantly.

## Next

- Owner checks both live; then set the two monday items to Done.
- Visual baselines may need the update workflow if the sidebar screenshot changes.

## Gotchas

- `pnpm lint` fails locally only on the untracked `.private/design/` files, not on repo code.
