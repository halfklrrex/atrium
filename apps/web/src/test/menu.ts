import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Click an item of an open Vibe menu without losing the click under load.
 *
 * Vibe's BaseMenuItem only runs `onClick` when the item is the menu's active item or its
 * `mouseenter` state is true. Both are React state set from a native `mouseenter` listener,
 * and the click handler reads them from the render it closed over, so a click that lands
 * before that re-render commits is ignored. So: hover, wait until Vibe marks the item active
 * (`aria-selected="true"`), click a freshly queried element, then wait the two animation
 * frames Vibe defers `onClick` by. Callers still assert their effect with `waitFor`.
 *
 * Pass a `user` made with `pointerEventsCheck: 0`: the popover is `pointer-events: none`
 * while it animates in. The menu itself stays open because `setup.ts` stops jsdom's zero
 * rects from making Floating UI close it.
 */
export async function chooseMenuItem(
  user: UserEvent,
  name: string | RegExp,
  options: { timeout?: number } = {},
): Promise<void> {
  const { timeout = 5000 } = options;
  const find = () => screen.findByRole('menuitem', { name }, { timeout });
  await user.hover(await find());
  await waitFor(
    async () => {
      expect((await find()).getAttribute('aria-selected')).toBe('true');
    },
    { timeout },
  );
  await user.click(await find());
  await nextFrame();
  await nextFrame();
}
