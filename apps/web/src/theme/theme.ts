import type { ThemePreference } from '@atrium/shared';
import { themePreferenceSchema } from '@atrium/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Concrete Vibe themes (CSS classes `light-app-theme`, `dark-app-theme`, `black-app-theme`). */
export type ResolvedTheme = 'light' | 'dark' | 'black';

export const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'black', label: 'Black' },
];

const themeClass = (theme: ResolvedTheme) => `${theme}-app-theme`;
const ALL_CLASSES = (['light', 'dark', 'black'] as const).map(themeClass);

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

/** Put the Vibe theme class on `<html>` so every token (and portalled modal/menu) picks it up. */
export function applyTheme(
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.remove(...ALL_CLASSES);
  root.classList.add(themeClass(theme));
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: 'atrium.theme',
      version: 1,
      partialize: (state) => ({ preference: state.preference }),
      // Ignore anything that is not a known preference (hand-edited or from an older build).
      merge: (persisted, current) => {
        const parsed = themePreferenceSchema.safeParse(
          (persisted as { preference?: unknown } | undefined)?.preference,
        );
        return { ...current, preference: parsed.success ? parsed.data : current.preference };
      },
    },
  ),
);

/** Apply the stored preference now and keep `<html>` in sync with it and the OS setting. */
export function startThemeSync(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => applyTheme(resolveTheme(useThemeStore.getState().preference, media.matches));
  sync();
  const unsubscribe = useThemeStore.subscribe(sync);
  media.addEventListener('change', sync);
  return () => {
    unsubscribe();
    media.removeEventListener('change', sync);
  };
}
