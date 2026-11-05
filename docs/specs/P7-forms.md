# P7: forms

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: P7 · Docs & forms (Forms) · Outline: `docs/plans/2026-11-04-feature-push.md`, Track D · Branches `claude/forms-backend`, `claude/forms-web`

## What the owner gets

A **Form** view on a board. The board owner picks which columns become questions, writes a title, description and thank-you message, and switches **Accepting responses** on. They share a link. Anyone who opens it and signs in with a Google account (a board member or not) fills it in and submits; each submission becomes a new item in the chosen group.

**Access (decision of 2026-11-04, reversible).** First slice: a share link that requires Google sign-in, any account allowed, no membership needed. **Anonymous "anyone with the link" forms are not built.** They would be Atrium's first unauthenticated surface and need App Check and their own security review, so a question goes to the owner on the Forms item with Actionable = Yes.

## Design

### Where the form lives

A new view type `form`, like Gantt and Workload: add `'form'` to `viewTypeSchema` (`packages/shared/src/schemas/view.ts`) and a `settings.form` object next to `settings.kanban` etc.:

- `title` (max 120), `description` (max 1000), `thankYou` (max 500);
- `targetGroupId` (slug id; must exist on the board, checked at publish and at submit; a deleted group falls back to the board's first group);
- `questions`: up to 30, each `{ columnId, label (max 120), help (max 300, optional), required }`; the **item name** is always the first question (`columnId: 'name'`, `required: true`, not removable);
- `acceptingResponses`: bool (default `false`).

Only column types in a small allow-list may be questions: `FORM_QUESTION_TYPES` in `packages/shared` (text, long text, numbers, status, dropdown, date, checkbox, email, phone, link, rating; the implementer confirms the exact registry type ids). People, files, button, mirror, derived, server-managed and time-tracking columns are never questions in v1. File questions are a later slice: the upload flow needs an existing item, so they need staged uploads.

Rules (`firestore.rules`, views): add `'form'` to the `hasOnly` list in `viewSettingsOk` and keep the same writers as other views. This is the **only** rules change; it is a hot-spot file, so keep the PR small, with an allow and a deny test (a non-owner can't set `settings.form`; an unknown settings key is still refused).

### Reading a form without board access

A visitor may not be able to read the board, so the browser never reads the view. A callable **`getForm({ boardId, viewId })`** (any signed-in user) loads the view and the board with the Admin SDK and returns, **only if `acceptingResponses` is true**: title, description, thank-you text, and per question the label, help, required flag, column type and the few settings needed to draw the input (status labels and colours, dropdown options, number format, rating scale). It returns nothing else: no member lists, no item data, no other columns, no board name. If the form is off or the view isn't a form, it fails with `not-found` (the same error for "doesn't exist" and "off", so a visitor learns nothing).

### Submitting

A callable **`submitForm({ boardId, viewId, answers })`** (any signed-in user):

1. Loads the view and board (Admin SDK); refuses unless `acceptingResponses` and the board is active.
2. **Rate limit**, in a transaction before anything is written: at most **10 submissions per person per form per hour** and **200 per form per hour**, counted in Functions-only counter documents under `boards/{boardId}/counters/` (the collection the automation counter uses; `expiresAt` set a day ahead for TTL cleanup). Over the limit returns `resource-exhausted` with a plain message.
3. Validates every answer: only question columns are accepted (unknown keys are refused, not ignored); each value goes through `columnRegistry.validateCell` (schema, then the optional `validateValue`); required questions must be non-empty by the registry's emptiness rule; name is 1 to 200 characters; total payload is size-capped.
4. Creates the item with the Admin SDK in the target group at the end (position key as the existing item-create path does), with `createdBy` = the submitter's uid and `values` from the answers. **The item-number sequence comes from the existing `onItemCreated` path**; do not duplicate it.
5. Writes the usual `item_created` activity entry with the submitter as actor and `data.source: 'form'`. That is what lets an "Item created" automation react to submissions (depth 0).
6. Returns `{ ok: true }` and the thank-you text; never the item id (the submitter may not be allowed to read the board).

The submitter doesn't become a member and gains no access. Check that no rule grants anything to an item's `createdBy` (it must not).

### Web

- **Form view** (`components/board-form/`): added in the view picker like the other views. The editor has a questions list (add from the allow-listed columns, drag to reorder, edit label and help, required switch, remove), title / description / thank-you fields and the target group picker, a live preview on the right, and a **Share** panel with the link, the **Accepting responses** switch and a "Copy link" button. Only owners and editors can edit; viewers see the preview. Empty, loading and error states as VF3.
- **Public page:** route `/forms/:boardId/:viewId`, **outside `AppShell`** but inside `RequireAuth` (App.tsx), so a visitor sees only the form on a plain page (`FormPage`, `FullPage` layout). It calls `getForm`, draws the inputs with the existing cell editors in a form layout where they exist and plain Vibe fields otherwise, validates on the client for convenience (the server is the authority), then calls `submitForm` and shows the thank-you with "Submit another response". A form that is off or missing shows one neutral "This form isn't available" page.
- Tokens only, Vibe components, light and dark, `prefers-reduced-motion`. Compare the builder with monday's form view if a screenshot exists in `docs/reference/monday/`; otherwise log the gap in the VF group.
- **Showcase:** per AGENTS.md rule 10, add a Form view with a few questions to the showcase board (`scripts/showcase/data.mjs`), accepting responses off.

## Tests

- Shared: schema accepts/refuses (unknown keys, 31 questions, disallowed column types, name not first), one test per allowed question type's answer validation.
- Rules: the `hasOnly` change with allow and deny per role.
- Functions (emulator): `getForm` returns the safe shape and nothing more, and `not-found` when off; `submitForm` creates the item with `source: 'form'` and the submitter as `createdBy`, refuses unknown columns, missing required answers, invalid values, an off form, and a signed-out caller, enforces both rate limits, and does not grant the submitter board access.
- Web: question list editing, preview, share switch, the public page (loading, off, submit, thank-you, server error).
- Visual: `form-builder-{light,dark}` and the public page; run the baselines workflow.

## PR split

- **F1 (`claude/forms-backend`):** shared schema, the rules key, both callables with tests, rate limit counters. Hot spots: `packages/shared`, `firestore.rules`, `tests/rules`.
- **F2 (`claude/forms-web`, after F1):** the view, the public page, the route, the showcase, visuals and baselines.

## Out of scope and follow-ups

Anonymous submissions (owner decision pending), file questions, conditional questions, form themes and branding, email notification on submit (an "Item created" automation covers it once P5 ships), CAPTCHA, editing a submission after sending.
