import type { ThemePreference } from '@atrium/shared';
import { Check } from '@vibe/icons';
import { THEME_OPTIONS, useThemeStore } from '../../theme/theme';
import styles from './Settings.module.css';
import { SettingsCard } from './SettingsCard';

type Theme = 'light' | 'dark' | 'black';

/** A miniature app window drawn with the tokens of one theme (the class scopes Vibe's variables). */
function PreviewWindow({ theme }: { theme: Theme }) {
  return (
    <span className={`${styles.previewWindow} ${theme}-app-theme`} aria-hidden="true">
      <span className={styles.previewSidebar} />
      <span className={styles.previewContent}>
        <span className={styles.previewBar} />
        <span className={styles.previewBarMuted} />
        <span className={styles.previewBarMuted} />
      </span>
    </span>
  );
}

function ThemePreview({ value }: { value: ThemePreference }) {
  return (
    <span className={styles.preview} aria-hidden="true">
      {value === 'system' ? (
        <>
          <PreviewWindow theme="light" />
          <PreviewWindow theme="dark" />
        </>
      ) : (
        <PreviewWindow theme={value} />
      )}
    </span>
  );
}

/** Settings > Appearance: the theme chooser (System, Light, Dark, Black), saved to your account. */
export function AppearanceTab() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <SettingsCard
      title="Theme"
      titleId="theme-title"
      hint="Your choice follows your account on every device."
    >
      <fieldset className={styles.themeGrid} aria-labelledby="theme-title">
        {THEME_OPTIONS.map(({ value, label }) => {
          const on = preference === value;
          return (
            <label
              key={value}
              className={on ? `${styles.themeOption} ${styles.themeOptionOn}` : styles.themeOption}
            >
              <input
                type="radio"
                name="theme"
                className={styles.radioInput}
                value={value}
                checked={on}
                onChange={() => setPreference(value)}
              />
              <ThemePreview value={value} />
              <span className={styles.themeNameRow}>
                <span className={styles.themeName}>{label}</span>
                {on ? (
                  <span className={styles.themeSelected} aria-hidden="true">
                    <Check className={styles.themeSelectedIcon} />
                    Selected
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>
    </SettingsCard>
  );
}
