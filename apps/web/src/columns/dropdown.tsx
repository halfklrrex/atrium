import type { DropdownSettings, DropdownValue } from '@atrium/shared';
import { Dropdown as DropdownIcon } from '@vibe/icons';
import classNames from 'classnames';
import { useState, type KeyboardEvent } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

const VISIBLE_PILLS = 2;

function labelOf(settings: DropdownSettings, id: number): string | undefined {
  return settings.labels.find((l) => l.id === id)?.label;
}

/** Light-blue pill tags; what does not fit collapses into "+N". */
function DropdownCell({ value, settings }: CellProps<DropdownValue, DropdownSettings>) {
  const names = (value?.ids ?? []).flatMap((id) => {
    const name = labelOf(settings, id);
    return name === undefined ? [] : [name];
  });
  if (names.length === 0) return <div className={styles.root} />;
  const shown = names.slice(0, VISIBLE_PILLS);
  const extra = names.length - shown.length;
  return (
    <div className={styles.root}>
      <span className={styles.pills}>
        {shown.map((name, i) => (
          <span key={i} className={styles.pill}>
            {name}
          </span>
        ))}
        {extra > 0 ? <span className={styles.more}>+{extra}</span> : null}
      </span>
    </div>
  );
}

function DropdownEditor({
  value,
  settings,
  column,
  anchor,
  onChange,
  onClose,
  saveSettings,
}: EditorProps<DropdownValue, DropdownSettings>) {
  const [query, setQuery] = useState('');
  const selected = value?.ids ?? [];
  const needle = query.trim().toLowerCase();
  const matches = settings.labels.filter((l) => l.label.toLowerCase().includes(needle));
  const exact = settings.labels.find((l) => l.label.toLowerCase() === needle);

  const write = (ids: number[]) => onChange(ids.length > 0 ? { ids } : null);

  const toggle = (id: number) => {
    if (selected.includes(id)) write(selected.filter((x) => x !== id));
    else if (settings.limitSelect) {
      write([id]);
      onClose();
    } else write([...selected, id]);
  };

  // Typing a label that does not exist and pressing Enter creates it in the column settings.
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key !== 'Enter' || needle === '') return;
    event.preventDefault();
    if (exact) {
      toggle(exact.id);
    } else {
      const id = Math.max(-1, ...settings.labels.map((l) => l.id)) + 1;
      saveSettings({ ...settings, labels: [...settings.labels, { id, label: query.trim() }] });
      write(settings.limitSelect ? [id] : [...selected, id]);
    }
    setQuery('');
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        {selected.length > 0 ? (
          <div className={popups.selectedPills}>
            {selected.map((id) => (
              <button
                key={id}
                type="button"
                className={popups.selectedPill}
                aria-label={`Remove ${labelOf(settings, id) ?? 'label'}`}
                onClick={() => write(selected.filter((x) => x !== id))}
              >
                {labelOf(settings, id)} ×
              </button>
            ))}
          </div>
        ) : null}
        <input
          className={popups.input}
          value={query}
          placeholder="Search or add"
          aria-label="Search or add a label"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={popups.list} role="listbox" aria-label={column.title} aria-multiselectable>
          {matches.map((label) => (
            <button
              key={label.id}
              type="button"
              role="option"
              aria-selected={selected.includes(label.id)}
              className={classNames(
                popups.listRow,
                selected.includes(label.id) && popups.listRowOn,
              )}
              onClick={() => toggle(label.id)}
            >
              <span className={styles.pill}>{label.label}</span>
            </button>
          ))}
          {needle !== '' && !exact ? (
            <p className={popups.muted}>Press Enter to create &ldquo;{query.trim()}&rdquo;</p>
          ) : null}
          {matches.length === 0 && needle === '' ? (
            <p className={popups.muted}>Type a name and press Enter to add a label</p>
          ) : null}
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const dropdownUi = defineColumnUi<DropdownValue, DropdownSettings>({
  type: 'dropdown',
  icon: DropdownIcon,
  tone: 'teal',
  editor: 'popover',
  Cell: DropdownCell,
  Editor: DropdownEditor,
});
