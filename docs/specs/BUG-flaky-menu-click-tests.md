# BUG: tests that click a Vibe menu item sometimes lose the click

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: 🐞 "Flaky test: UserMenu 'opens the About dialog' click doesn't register under load" (3314530597) · Branch `claude/fix-flaky-menu-click`

## Symptom

Under load, `apps/web/src/components/AppShell/UserMenu.test.tsx` > "opens the About dialog…" fails with `expected null to deeply equal { type: 'about' }`. The `menuitem` is found and clicked, but its `onClick` (`openDialog({ type: 'about' })`, `UserMenu.tsx:63`) never runs within the 5 s `waitFor`. This is not the per-test timeout fixed in PR #23.

## Cause (confirmed by reading Vibe, under `node_modules/@vibe/core/dist/components/`)

1. **The menu closes itself in jsdom (the main cause).** `menu-button/dist/MenuButton/MenuButton.js` defaults `hideWhenReferenceHidden` to true, and `dialog/dist/Dialog/Dialog.js` adds Floating UI's `hide()` middleware. When `isReferenceHidden` is true, an effect fires an "onReferenceHidden" hide event. jsdom measures every element as 0x0, so the reference always counts as hidden once positioning runs. A `MenuButton` menu therefore shows its items for about 100-250 ms after opening and then closes with no interaction. Under CPU load the test's click lands after that.
2. **Minor race.** `menu/dist/Menu/MenuItem/hooks/useMenuItemKeyboardEvents.js` only runs `onClick` when the item is active (`aria-selected`) or `isMouseEnter` is true (`menu/dist/Menu/hooks/useIsMouseEnter.js`, a native `mouseenter` listener feeding React state). The click handler reads that state from the render it closed over, so a click before the re-render commits is ignored. `onClick` then runs after two animation frames. Items are not re-mounted when the menu opens.
3. Hovering or arrow-keying alone is not a fix: the menu still closes about 250 ms after opening.

## Fix

1. In `setup.ts`, add the narrowest shim that stops the self-close: elements that measure 0x0 report a small non-zero `getBoundingClientRect`, and `clientWidth`/`clientHeight` fall back to a viewport size when they are 0 (menus inside a Modal are clipped by ancestors with zero client size). Comment why. Probe that a `UserMenu` menu stays open for at least 2 s.
2. Add one shared test helper (for example `apps/web/src/test/menu.ts`), `chooseMenuItem(user, name, options?)`. It does whatever Step 1 shows is reliable. For example:
   - wait until the menu has settled (the item is visible, connected and stable across one animation frame), then click the **freshly queried** element; or
   - activate the item with the keyboard (arrow to it, then Enter), if Vibe supports that and it's more reliable.

   Give it a short comment explaining why.

3. Use it in `UserMenu.test.tsx`, in `membership.test.tsx`'s `pickMenuAction`, and in `ViewTabs.test.tsx` wherever a menu item is clicked. Remove `pointerEventsCheck: 0` where the helper makes it unnecessary.
4. Don't change component code or assertions. A test-only shim in `apps/web/src/test/setup.ts` is allowed; the Vitest config stays as is.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- From `apps/web`, run `npx vitest run src/components/AppShell src/components/membership src/components/board-views` 10 times. Then run it 5 times under CPU pressure: `npx vitest run … --pool=threads --poolOptions.threads.maxThreads=1` while a second full `pnpm --filter web test` runs in parallel, or a similar way to load the machine. Report any failure with its test name and error. Run everything in the foreground.
