import { Button, Tab, TabList, TextField } from '@vibe/core';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { handleGridKeys } from './grid-keys';
import {
  findWorkspaceIcon,
  isIconKeyValue,
  searchWorkspaceIcons,
  toStoredIcon,
  WORKSPACE_ICON_GROUPS,
  type WorkspaceIconDef,
} from './icons';
import styles from './IconPicker.module.css';

type RegularPaths = Readonly<Record<string, string>>;

/** The regular-weight paths load with the picker, not with the app; `null` until then (fill is shown). */
function useRegularPaths(): RegularPaths | null {
  const [paths, setPaths] = useState<RegularPaths | null>(null);
  useEffect(() => {
    let live = true;
    void import('./icons-regular.generated').then((m) => {
      if (live) setPaths(m.REGULAR_PATHS);
    });
    return () => {
      live = false;
    };
  }, []);
  return paths;
}

const EmojiTab = lazy(() => import('./EmojiTab'));

type PickerTab = 'icons' | 'emoji' | 'letter';
const TABS: readonly { id: PickerTab; label: string }[] = [
  { id: 'icons', label: 'Icons' },
  { id: 'emoji', label: 'Emoji' },
  { id: 'letter', label: 'Letter' },
];

const clampGlyphs = (text: string, max: number): string => [...text].slice(0, max).join('');

function initialTab(value: string | null, emptyTab: PickerTab = 'letter'): PickerTab {
  if (value === null) return emptyTab;
  if (isIconKeyValue(value)) return 'icons';
  return /^[\p{L}\p{N}]{1,2}$/u.test(value) ? 'letter' : 'emoji';
}

function IconsTab({ value, onPick }: { value: string | null; onPick: (stored: string) => void }) {
  const [query, setQuery] = useState('');
  const regularPaths = useRegularPaths();
  // A legacy `mi:` value resolves to its mapped Phosphor icon, which is marked as selected.
  const selectedKey = (value ? findWorkspaceIcon(value)?.key : undefined) ?? null;
  const results = useMemo(() => searchWorkspaceIcons(query), [query]);
  const groups = useMemo(
    () =>
      WORKSPACE_ICON_GROUPS.map((group) => ({
        ...group,
        icons: results.filter((icon) => icon.group === group.id),
      })).filter((group) => group.icons.length),
    [results],
  );
  // One tab stop for the whole grid: the selected icon, else the first one shown.
  const tabStopKey = results.some((i) => i.key === selectedKey) ? selectedKey : results[0]?.key;

  return (
    <div className={styles.picker}>
      <TextField
        inputAriaLabel="Search icons"
        placeholder="Search icons"
        value={query}
        size="small"
        onChange={(v: string) => setQuery(v)}
      />
      <div
        className={styles.scroll}
        onKeyDown={handleGridKeys}
        data-weights-loaded={regularPaths ? 'true' : 'false'}
      >
        {groups.length ? (
          groups.map((group) => (
            <section key={group.id} aria-label={group.label}>
              <h4 className={styles.heading}>{group.label}</h4>
              <div className={styles.grid}>
                {group.icons.map((icon: WorkspaceIconDef) => (
                  <button
                    key={icon.key}
                    type="button"
                    data-grid-cell=""
                    className={styles.cell}
                    aria-label={icon.label}
                    title={icon.label}
                    aria-pressed={icon.key === selectedKey}
                    tabIndex={icon.key === tabStopKey ? 0 : -1}
                    onFocus={(e) => {
                      const root = e.currentTarget.closest('[data-grid-root]') ?? document;
                      for (const b of root.querySelectorAll<HTMLElement>('[data-grid-cell]')) {
                        b.tabIndex = b === e.currentTarget ? 0 : -1;
                      }
                    }}
                    onClick={() => onPick(toStoredIcon(icon.key))}
                  >
                    <svg
                      className={styles.glyph}
                      viewBox="0 0 256 256"
                      fill="currentColor"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d={
                          icon.key === selectedKey
                            ? icon.fill
                            : (regularPaths?.[icon.key] ?? icon.fill)
                        }
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className={styles.empty}>No icons found</p>
        )}
      </div>
    </div>
  );
}

/**
 * Icon control for the workspace dialogs: Icons (Phosphor, searchable), Emoji and Letter.
 * `value` is the stored icon (`ph:<key>` or a legacy `mi:<key>`, emoji or letter) or `null` for the automatic first
 * letter of the name.
 *
 * Folders pass `noIconLabel`: `null` then means "no icon" (the default folder glyph), which shows
 * as a visible choice above the tabs, and there is no automatic letter.
 */
export function IconPicker({
  value,
  onChange,
  letterPlaceholder,
  noIconLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** The automatic letter, shown as the placeholder of the Letter field. */
  letterPlaceholder: string;
  /** Shows a "no icon" choice with this label; `null` then stands for it instead of the first letter. */
  noIconLabel?: string;
}) {
  const [tab, setTab] = useState<PickerTab>(() =>
    initialTab(value, noIconLabel ? 'icons' : 'letter'),
  );
  const activeIndex = TABS.findIndex((t) => t.id === tab);

  function changeTab(id: number) {
    const next = TABS[id]?.id ?? 'icons';
    setTab(next);
    // The Letter tab means "use a letter": drop an icon or emoji picked earlier.
    if (next === 'letter' && value !== null && initialTab(value) !== 'letter') onChange(null);
  }

  return (
    <div className={styles.picker} data-grid-root="">
      {noIconLabel ? (
        <div>
          <Button
            kind="tertiary"
            size="small"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
          >
            {noIconLabel}
          </Button>
        </div>
      ) : null}
      <TabList activeTabId={activeIndex} onTabChange={changeTab}>
        {TABS.map((t) => (
          <Tab key={t.id}>{t.label}</Tab>
        ))}
      </TabList>
      {tab === 'icons' ? <IconsTab value={value} onPick={onChange} /> : null}
      {tab === 'emoji' ? (
        <Suspense fallback={<p className={styles.empty}>Loading emoji</p>}>
          <EmojiTab value={value} onPick={onChange} />
        </Suspense>
      ) : null}
      {tab === 'letter' ? (
        <div className={styles.letterPanel}>
          <p className={styles.hint}>
            {noIconLabel
              ? 'Type one or two letters to show on the folder.'
              : 'The tile shows the first letter of the workspace name unless you type your own.'}
          </p>
          <TextField
            title="Letter"
            inputAriaLabel="Letter"
            value={value !== null && initialTab(value) === 'letter' ? value : ''}
            placeholder={letterPlaceholder}
            size="small"
            onChange={(v: string) => {
              const letters = clampGlyphs(v.trim(), 2);
              onChange(letters || null);
            }}
          />
          {value !== null && !noIconLabel ? (
            <div>
              <Button kind="tertiary" size="small" onClick={() => onChange(null)}>
                Use the first letter of the name
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
