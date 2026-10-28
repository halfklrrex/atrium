# BUG: flaky MembersDialog test times out under load

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: 🐞 "Flaky test: MembersDialog … times out in CI" (3311591279) · Branch `claude/fix-flaky-members-test`

## Cause

In `apps/web/src/components/membership/membership.test.tsx`, each UI wait uses `SLOW_UI = { timeout: 5000 }` (`:155`). The MembersDialog tests chain several of them: `pickMenuAction` waits for the menu item, then for the confirmation dialog, then the test waits for a toast. Vitest's default per-test timeout is also 5000 ms. Under load (the full suite runs about 57 jsdom environments), the waits add up to more than 5 s and the **test** times out although no single wait failed. It was seen in CI and in a local full run on 2026-10-28; the file passes alone.

## Fix (revised 2026-10-28 after CI)

The first fix (a 20 s timeout on two describe blocks) passed locally, but CI then timed out a different test the same way: `UserMenu.test.tsx` > "opens the About dialog from the \"About Atrium\" item" ("Test timed out in 5000ms"). So the cause is suite-wide. Vibe's menus and dialogs render through async popper and portal steps, and on a loaded runner a test that waits for several of them overruns Vitest's default 5000 ms per-test timeout.

1. Set `testTimeout: 20_000` in the `test` block of `apps/web/vite.config.ts`, with a one-line comment saying why (Vibe's async menus and dialogs on loaded CI runners; individual waits keep their own shorter timeouts, so real hangs still fail).
2. Remove the per-describe `UI_TEST_TIMEOUT` from `membership.test.tsx` again, so there is one mechanism. Keep `SLOW_UI`.
3. Don't change any assertion or any other test file.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Run `pnpm --filter web test -- membership` five times in a row, and the full `pnpm test` twice: all green.
