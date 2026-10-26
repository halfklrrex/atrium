# FW1: Column framework, derived columns and `validateValue`

Author: Ophelia (Claude Opus 5.5, lead) · Implementer: Sonnet 5.5 (high effort) · Branch `claude/fw1-column-framework` · Worktree `ATRIUM_PORT_OFFSET=90`

These are accepted decisions on the Decisions board (2026-10-24):

- **Derived column types store no value.** Their values are computed from item metadata or other cells, and **clients can't write them, enforced by Firestore rules**.
- **An optional `validateValue(value, settings)` hook** on column types.
- **One canonical, monday-compatible value shape per type.**

Ava's open PRs (#13 computed columns, #21 mirror, #22 formula, and others) carry `TODO(derived)` markers and standalone validators, waiting to plug into this. **This PR builds the framework only.** It doesn't convert her column types; she does that when she rebases. Keep the API small and stable.

## 1. `ColumnType` additions (`packages/shared/src/columns/types.ts`)

```ts
/** Context available when computing a derived value or validating a cell. */
export interface ColumnContext {
  boardId: string;
  item: {
    id: string;
    values: Record<string, unknown>;
    createdAt?: unknown;
    createdBy?: string;
    updatedAt?: unknown;
    updatedBy?: string;
    groupId?: string;
  };
  /** All column defs of the board (for cross-column derivations like progress/formula). */
  columns: readonly ColumnDef[];
}

export type ValidationResult = { ok: true } | { ok: false; message: string };

interface ColumnType<Settings, Value> {
  // ...existing...
  /** True when the type's value is computed, never stored (formula, mirror, progress, item ID, creation log, last updated). */
  readonly derived?: boolean;
  /** Derived types: compute the display value for one item. Must be pure and fast. */
  compute?(ctx: ColumnContext, settings: Settings): Value | null;
  /** Settings-dependent validation beyond `valueSchema` (e.g. rating ≤ limit). Pure. */
  validateValue?(value: Value, settings: Settings, ctx?: ColumnContext): ValidationResult;
}
```

- **Invariant, enforced at registration (throws):** `derived === true` requires `compute`, and `derived` types must not be writable (see §2).
- **Size:** keep `ColumnContext` minimal. `item` is the plain item data the client already has.

## 2. Registry (`registry.ts`)

- `isDerived(type): boolean`
- `computeValue(def, ctx)`: for derived types, calls `compute`; returns `null` for unknown types.
- `validateCell(def, value, ctx?)`: runs `parseValue` (the schema), then `validateValue` if present. Returns `ValidationResult`. **Rejects any value for a derived type** with "This column is calculated automatically".
- `derivedColumnIds(columns: readonly ColumnDef[]): string[]`: a pure helper, reused by the client, the Function and the tests.
- **No production column type is derived yet.** Add a test-only derived type in the registry tests to cover the paths.

## 3. Client write path (`apps/web/src/data/item-writes.ts` and the cell editors)

- `setCell` (and any batch value writes, including CSV or paste paths) calls `registry.validateCell` first. On `{ok:false}` it doesn't write, and shows the message in an error toast.
- **Derived columns:** cells render `computeValue(...)` read-only (no editor opens), with the cursor and hover of a read-only cell, as monday does. The table must **never** write `values.<derivedColumnId>`.
- **New items** never include derived column ids in `values`.

## 4. Server enforcement (the important part)

**`boards/{id}.derivedColumnIds: string[]`** is maintained **only by a Cloud Function**:

- `onBoardColumnsWritten` is a Firestore trigger (`onDocumentWritten('boards/{boardId}')`, region `europe-west1`).
- It recomputes `derivedColumnIds(columns)` with the shared registry, and writes it back **only if it changed**. That avoids loops: compare sorted arrays.
- It's idempotent. The board is created by the client with `derivedColumnIds: []`.

**Rules (`firestore.rules`):**

- **Board create:** must include `derivedColumnIds == []`.
- **Board update:** clients may **never** change `derivedColumnIds`. Add it to the protected keys, so it isn't in the editable `hasOnly` list.
- **Item create:** `!request.resource.data.values.keys().hasAny(board.derivedColumnIds)`.
- **Item update:** `!request.resource.data.values.diff(resource.data.values).affectedKeys().hasAny(board.derivedColumnIds)`.
  - Reuse the board `get()` that `canEditBoard` already performs. Rules cache repeated `get()`s of the same document, but check the 10-`get` budget. Use `let board = get(...)` style helpers if needed.
  - Handle older boards with no `derivedColumnIds` field: treat it as `[]` (`board.get('derivedColumnIds', [])`).
- **Rules tests:**
  - an editor can't write a derived value on create or update
  - an editor can still write normal values
  - a client can't change `derivedColumnIds`
  - create requires `[]`
  - legacy boards without the field still work

**Function tests:** unit-test the recompute logic, including the "no write when unchanged" path, against the emulator or with an injected store.

**Small migration:** a one-off, idempotent script `scripts/migrations/2026-10-backfill-derived-column-ids.mjs`. It sets `derivedColumnIds` on existing boards (it will be `[]` everywhere today), with a dry run by default, using the same REST and `gcloud` approach as `scripts/showcase/`. Document it in the PR. Ophelia runs it after deploy. The trigger would also backfill on the next board write.

## 5. Deploy prerequisites (2nd-gen Firestore triggers use Eventarc)

Work out, from the firebase-tools and Google docs, exactly what the **deployer** (`github-deployer@atrium-board.iam.gserviceaccount.com`) and the project need for the first Firestore-triggered function. Typically:

- `roles/eventarc.admin` for the deployer
- the Eventarc, Pub/Sub and Cloud Run service agents and APIs (`eventarc.googleapis.com`, `pubsub.googleapis.com`)
- the runtime service account getting `roles/eventarc.eventReceiver`
- the Pub/Sub service agent getting `roles/iam.serviceAccountTokenCreator`

**Verify; don't guess.** Add a precise, copy-pasteable section to `docs/DEPLOY.md` under "Roles to add later → Firestore-triggered functions", and list the commands in the PR description. **Don't run any IAM commands yourself.** The owner runs them before the merge.

## 6. Docs

- `docs/architecture.md` §6: document `derived`, `compute`, `validateValue`, `ColumnContext`, `derivedColumnIds` and the enforcement model. Update the §5.4 board fields.
- `AGENTS.md`: one short bullet under the engineering rules, covering derived columns, `validateValue`, and that `derivedColumnIds` is server-maintained.

## Constraints

- Work only in your worktree, on `claude/fw1-column-framework` created from `origin/main`. **Push early and often.**
- Don't modify Ava's column modules on her branches. On `main`, only touch existing column modules if the interface change forces it.
- Keep `pnpm-lock.yaml` untouched unless needed.
- No deploys, IAM changes or merges.

## Done

- `pnpm lint`, `typecheck`, `test`, `test:rules` and `build` pass, and the CI `verify` and `visual` jobs are green.
- A PR is open to `main`. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, and end the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Report:** the PR URL, the API summary, the rules changes and tests, the exact owner IAM commands for Eventarc, and the migration command.
