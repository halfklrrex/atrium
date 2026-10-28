# BUG: flaky MembersDialog test times out under load

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: 🐞 "Flaky test: MembersDialog … times out in CI" (3311591279) · Branch `claude/fix-flaky-members-test`

## Cause

In `apps/web/src/components/membership/membership.test.tsx`, each UI wait uses `SLOW_UI = { timeout: 5000 }` (`:155`). The MembersDialog tests chain several of them: `pickMenuAction` waits for the menu item, then for the confirmation dialog, then the test waits for a toast. Vitest's default per-test timeout is also 5000 ms. Under load (the full suite runs about 57 jsdom environments), the waits add up to more than 5 s and the **test** times out although no single wait failed. It was seen in CI and in a local full run on 2026-10-28; the file passes alone.

## Fix

1. Give the `MembersDialog` and `InvitePage` describe blocks a test timeout that covers their chained waits: `describe('MembersDialog', { timeout: 20_000 }, () => …)`. Use one named constant next to `SLOW_UI` (for example `UI_TEST_TIMEOUT = 20_000`) with a one-line comment explaining why (several `SLOW_UI` waits per test). Check the installed Vitest version supports the options argument in that position; if not, use its supported form.
2. Don't change the assertions, `SLOW_UI`, or the global Vitest config.
3. Look for other test files whose single tests chain two or more 5000 ms waits (for example `UserMenu.test.tsx:33`). List them in your report; don't change them.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Run `pnpm --filter web test -- membership` five times in a row, and the full `pnpm test` twice: all green.
