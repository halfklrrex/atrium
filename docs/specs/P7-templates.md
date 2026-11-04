# P7: board templates (build spec)

**Roadmap:** Templates gallery (`3306244773`, P7, Medium). **Author:** Ophelia (Opus 5.5). **Implementers:** Sonnet 5.5 subagents. Forms come later in their own spec (`P7-forms.md`).

## What the owner gets

1. **New board from a template.** The new-board dialog (and the sidebar's Add menu) gets a **Templates** step: a gallery of built-in templates (Project tracker, Content calendar, Bug tracker, Family chores, Reading list) and the workspace's own saved templates. Picking one creates a board with that template's columns, groups and optionally its sample items.
2. **Save a board as a template.** The board menu gets **Save as template**: name, description, and a checkbox "Include items" (up to 50 active top-level items with their subitems excluded in v1). The template appears in that workspace's gallery for every member who can create boards.
3. Own templates can be renamed and deleted from the gallery by their creator or a workspace owner.

## Data

- **Built-in templates** are code, not data: `packages/shared/src/templates/` exports `BUILT_IN_TEMPLATES: BoardTemplate[]` (id, name, description, icon key, `structure`, optional `sampleItems`). Each is validated at test time with `columnDefSchema` and `columnRegistry.parseValue`/`validateCell` for the sample values (pattern: `scripts/showcase/data.mjs` `parseCell`). Column ids are slugs; derived and server-managed columns are allowed in a template, but their sample values must be absent.
- **Saved templates:** `workspaces/{workspaceId}/templates/{templateId}` (not a top-level collection, so the membership rules are one `get`): `{ name, description, structure { columns, subitemColumns, groups, itemTerminology }, sampleItems[] (max 50, each { name, groupId, values }), itemCount, createdBy, createdAt, updatedAt }`. `shared/src/schemas/template.ts` holds `boardTemplateSchema`, `TEMPLATE_LIMITS` (name 80, description 300, 50 items, 60 columns as for boards, doc must stay well under 1 MB) and `templateFromBoard(board, items, {includeItems})` (strips `migrating`/`lastTypeChange` via the same helper `duplicateBoard` uses, `withoutServerColumnFields` in `apps/web/src/data/server-column-fields.ts`: move it to shared if the template builder needs it there, with the web import updated).
- **Rules** (`firestore.rules`): `templates` read for workspace members; create for workspace members who can create boards (use the same helper `createBoard` rules use); update and delete for the creator or a workspace owner; shape check with `hasOnly`; size caps on `sampleItems`. `tests/rules/src/templates.test.ts`: allow and deny per workspace role (owner, member, viewer/guest if that role exists, non-member, signed out) and shape violations.

## Creating a board from a template

Reuse `createBoard` in `apps/web/src/data/firestore.ts`, which today builds `defaultBoardStructure(newSlugId)`: factor a `createBoardFromStructure(uid, workspaceId, input, position, structure, sampleItems)` that both use, so the existing path and its tests are unchanged. Rules for board create still require `derivedColumnIds` and `serverManagedColumnIds` to be `[]` (the trigger `onBoardColumnsWritten` fills them) and the sample items go in a second batch after the board exists (item rules `get()` the board), exactly as `createBoard` seeds its 5 items today. Item positions come from fractional indexing as elsewhere (`apps/web/src/data/item-writes.ts` helpers). Groups in the sample items must exist in the template's groups (validate). New ids for groups are **kept** (group ids are slugs local to the board) so sample items stay valid.

## UI

- `apps/web/src/components/boards/` already has the new-board dialog (see `ui-store.ts` `newBoard` dialog type): add a "Start from" choice (Blank board / Template) and a `TemplateGallery` (cards in a responsive grid: icon, name, description, column chips, "Includes N sample items"). Built-ins first, then "Saved in this workspace". Search box when more than 6.
- Board menu (`components/boards/BoardMenu.tsx`, `board-actions.ts`): **Save as template** opens a small dialog.
- Empty, loading and error states as VF3; Vibe components and tokens only; `describeCallableError`-style messages for failures; undo is not needed (creation navigates to the new board).
- Keyboard accessible gallery (roving tabindex or a list of buttons), focus returns sensibly.

## PR split

- **T1:** shared (`templates/`, `schemas/template.ts`, `templateFromBoard`), rules + tests, data layer (`createBoardFromStructure`, template queries and writes, hooks). Hot spots: `packages/shared`, `firestore.rules`, `tests/rules`.
- **T2:** web UI: gallery, new-board dialog step, Save as template, delete/rename, tests and visual screens (`new-board-templates-{light,dark}`; run the baselines workflow on the PR), showcase tweak if a saved template is worth seeding.

## Tests and QA

Unit tests for every built-in template (valid columns, valid sample values, groups referenced exist, no derived/server-managed values), `templateFromBoard` round trip (board -> template -> board has the same columns and groups; server-managed fields stripped), rules tests, component tests for the gallery and dialogs. Compare the gallery with monday's template center for tone and layout in light and dark; log gaps to the VF group.
