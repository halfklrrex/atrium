import { Button, Checkbox, RadioButton } from '@vibe/core';
import { NavigationChevronDown } from '@vibe/icons';
import { FILES_VIEW_KINDS, type FilesViewKind, type FilesViewSettings } from '@atrium/shared';
import { useState, type ReactNode } from 'react';
import { useFilterStore } from '../board-filters';
import filters from '../board-filters/board-filters.module.css';
import { Popover } from '../Popover';
import styles from './files-view.module.css';

const KIND_LABELS: Record<FilesViewKind, string> = {
  image: 'Images',
  pdf: 'PDFs',
  document: 'Documents',
  spreadsheet: 'Spreadsheets',
  presentation: 'Presentations',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archives',
  other: 'Other',
};

const SORT_LABELS: Record<FilesViewSettings['sort'], string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  name: 'Name (A to Z)',
  item: 'Item (board order)',
};

export interface FilesViewControlsProps {
  boardId: string;
  settings: FilesViewSettings;
  /** The board's Files columns, in order. */
  fileColumns: readonly { id: string; title: string }[];
}

function Picker({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={label}
      align="end"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          rightIcon={NavigationChevronDown}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${summary}`}
          onClick={() => setOpen((v) => !v)}
        >
          {summary}
        </Button>
      }
    >
      <div className={`${filters.popoverPanel} ${styles.pickerPanel}`}>
        <div className={filters.popoverHeader}>
          <span className={filters.popoverTitle}>{label}</span>
        </div>
        {children}
      </div>
    </Popover>
  );
}

/** Source, column, file type and sort pickers of the Files view; changes are unsaved view changes. */
export function FilesViewControls({ boardId, settings, fileColumns }: FilesViewControlsProps) {
  const set = (patch: Partial<FilesViewSettings>) =>
    useFilterStore.getState().setTypeSettings(boardId, 'files', patch);

  const allIds = fileColumns.map((c) => c.id);
  const chosen = settings.columnIds ?? allIds;
  const toggleColumn = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    const ordered = allIds.filter((x) => next.includes(x));
    set({ columnIds: ordered.length === allIds.length ? null : ordered });
  };
  const toggleKind = (kind: FilesViewKind) => {
    const has = settings.kinds.includes(kind);
    set({
      kinds: FILES_VIEW_KINDS.filter((k) => (k === kind ? !has : settings.kinds.includes(k))),
    });
  };

  const columnSummary =
    settings.columnIds === null
      ? 'All columns'
      : settings.columnIds.length === 1
        ? (fileColumns.find((c) => c.id === settings.columnIds![0])?.title ?? '1 column')
        : `${settings.columnIds.length} columns`;
  const kindSummary =
    settings.kinds.length === 0
      ? 'All types'
      : settings.kinds.length === 1
        ? KIND_LABELS[settings.kinds[0]!]
        : `${settings.kinds.length} types`;

  return (
    <>
      <Picker
        label="Source"
        summary={settings.includeUpdates ? 'Columns and updates' : 'Columns only'}
      >
        <div role="radiogroup" aria-label="Source" className={styles.pickerList}>
          <RadioButton
            name={`files-source-${boardId}`}
            text="Columns only"
            checked={!settings.includeUpdates}
            onSelect={() => set({ includeUpdates: false })}
          />
          <RadioButton
            name={`files-source-${boardId}`}
            text="Columns and updates"
            checked={settings.includeUpdates}
            onSelect={() => set({ includeUpdates: true })}
          />
        </div>
      </Picker>
      {fileColumns.length > 1 ? (
        <Picker label="Files columns" summary={columnSummary}>
          <ul className={styles.pickerList} aria-label="Files columns">
            {fileColumns.map((c) => (
              <li key={c.id}>
                <Checkbox
                  label={c.title}
                  checked={chosen.includes(c.id)}
                  onChange={() => toggleColumn(c.id)}
                />
              </li>
            ))}
          </ul>
        </Picker>
      ) : null}
      <Picker label="File type" summary={kindSummary}>
        <ul className={styles.pickerList} aria-label="File types">
          {FILES_VIEW_KINDS.map((kind) => (
            <li key={kind}>
              <Checkbox
                label={KIND_LABELS[kind]}
                checked={settings.kinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
            </li>
          ))}
        </ul>
        {settings.kinds.length > 0 ? (
          <Button kind="tertiary" size="small" onClick={() => set({ kinds: [] })}>
            Show all types
          </Button>
        ) : null}
      </Picker>
      <Picker label="Sort" summary={SORT_LABELS[settings.sort]}>
        <div role="radiogroup" aria-label="Sort" className={styles.pickerList}>
          {(Object.keys(SORT_LABELS) as FilesViewSettings['sort'][]).map((key) => (
            <RadioButton
              key={key}
              name={`files-sort-${boardId}`}
              text={SORT_LABELS[key]}
              checked={settings.sort === key}
              onSelect={() => set({ sort: key })}
            />
          ))}
        </div>
      </Picker>
    </>
  );
}
