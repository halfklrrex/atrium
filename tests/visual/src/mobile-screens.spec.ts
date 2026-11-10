import { expect, shoot, test } from './fixtures';
import { BASELINE_SCREENS, MOBILE_SCREENS } from './mobile-screens';

/**
 * Light-theme baselines of fifteen key screens on an iPhone 15 (WebKit, touch, 3x). Linux images
 * only, made by the "Update visual baselines" workflow like every other baseline. Files are named
 * `phone-<screen>-light-linux.png`. The device (iPhone 15) comes from the `mobile-webkit` project. WebKit on Linux is not iOS Safari: see docs/visual-testing.md.
 */
for (const screen of MOBILE_SCREENS.filter((s) =>
  (BASELINE_SCREENS as readonly string[]).includes(s.name),
)) {
  test.describe(screen.name, () => {
    test.use(screen.signedOut ? { storageState: { cookies: [], origins: [] } } : {});
    if (screen.seed) test.beforeAll(screen.seed);
    if (screen.cleanup) test.afterAll(screen.cleanup);

    test(screen.title, async ({ page }) => {
      await screen.open(page);
      await shoot(page, `phone-${screen.name}-light`);
      expect(page.url()).toBeTruthy();
    });
  });
}
