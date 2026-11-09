import type { ThemePreference } from '@atrium/shared';
import { THEME_OPTIONS, useThemeStore } from '../../theme/theme';
import styles from './Settings.module.css';

/** A miniature window drawn with the tokens of one theme (the class scopes Vibe's variables). */
function Half({ theme }: { theme: 'light' | 'dark' | 'black' }) {
  return (
    <span className={`${styles.swatchHalf} ${theme}-app-theme`} aria-hidden="true">
      <span className={styles.swatchBar} />
      <span className={styles.swatchBarMuted} />
    </span>
  );
}

function Swatch({ value }: { value: ThemePreference }) {
  return (
    <span className={styles.swatch} aria-hidden="true">
      {value === 'system' ? (
        <>
          <Half theme="light" />
          <Half theme="dark" />
        </>
      ) : (
        <Half theme={value} />
      )}
    </span>
  );
}

/** Settings > Appearance: the theme chooser (System, Light, Dark, Black), saved to your account. */
export function AppearanceTab() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <section className={styles.section} aria-labelledby="theme-title">
      <h2 id="theme-title" className={styles.sectionTitle}>
        Theme
      </h2>
      <p className={styles.hint}>Your choice follows your account on every device.</p>
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
              <Swatch value={value} />
              <span className={styles.themeName}>{label}</span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
