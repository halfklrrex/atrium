import {
  statusSettingsSchema,
  type DropdownLabel,
  type DropdownSettings,
  type StatusLabel,
  type StatusSettings,
} from '@atrium/shared';
import { Add, Check, Delete } from '@vibe/icons';
import classNames from 'classnames';
import { useState, type KeyboardEvent } from 'react';
import { newSlugId } from '../lib/ids';
import { LabelSortable, SortableLabelRow, moveAnnouncement } from './LabelSortable';
import { ColorPicker } from './ColorPicker';
import { customLabelColors, isPaletteColor } from './label-color';
import { moveItem, moveItemOver } from './reorder';
import { STATUS_LABEL_COLORS, nextGroupColor } from '../theme/palette';
import popups from './popups.module.css';

const MAX_LABEL = 60;

/**
 * The color choices for one label: the recommended swatches, the board's saved custom colors and a
 * color-wheel swatch that opens an inline picker.
 */
function LabelPalette({
  color,
  saved,
  onPick,
}: {
  color: string;
  saved: readonly string[];
  onPick: (color: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const current = color.toLowerCase();
  const custom = !isPaletteColor(current);
  const swatch = (hex: string, label: string, extra?: string) => (
    <button
      key={hex}
      type="button"
      role="radio"
      aria-checked={hex.toLowerCase() === current}
      aria-label={label}
      title={label}
      className={classNames(
        popups.paletteSwatch,
        hex.toLowerCase() === current && popups.paletteSelected,
        extra,
      )}
      style={{ backgroundColor: hex }}
      onClick={() => onPick(hex)}
    />
  );
  return (
    <>
      <div className={popups.palette} role="radiogroup" aria-label="Label color">
        {STATUS_LABEL_COLORS.map((c) => swatch(c.hex, c.label))}
      </div>
      <p className={popups.customCaption}>Custom</p>
      <div className={popups.customRow} role="radiogroup" aria-label="Custom label colors">
        {saved.map((hex) => swatch(hex, `Custom color ${hex}`))}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          aria-expanded={picking}
          aria-label="Pick a custom color"
          title="Pick a custom color"
          className={classNames(
            popups.paletteSwatch,
            popups.paletteWheel,
            custom && popups.paletteSelected,
          )}
          onClick={() => setPicking((open) => !open)}
        />
      </div>
      {picking ? (
        <ColorPicker
          value={current}
          onCancel={() => setPicking(false)}
          onUse={(hex) => {
            setPicking(false);
            onPick(hex);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * "Edit Labels" for a status column: rename, recolor, mark as done, add and delete labels. The
 * grey label with no text (monday's "no status" default) is kept as it is and not listed.
 */
export function StatusLabelEditor({
  settings,
  boardColors = [],
  onSave,
  onCancel,
}: {
  settings: StatusSettings;
  /** Custom colors the board's labels already use (any column), offered for reuse. */
  boardColors?: readonly string[];
  onSave: (settings: StatusSettings) => void;
  onCancel: () => void;
}) {
  const [fixed] = useState(() => settings.labels.filter((l) => l.label.trim() === ''));
  const [labels, setLabels] = useState<StatusLabel[]>(() =>
    settings.labels.filter((l) => l.label.trim() !== '').map((l) => ({ ...l })),
  );
  const [openPalette, setOpenPalette] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const move = (id: string, delta: -1 | 1) =>
    setLabels((list) => {
      const from = list.findIndex((l) => l.id === id);
      const next = moveItem(list, from, from + delta);
      const to = next.findIndex((l) => l.id === id);
      if (to !== from)
        setAnnouncement(moveAnnouncement(list[from]?.label ?? '', to + 1, list.length));
      return next;
    });

  // Saved custom colors: the board's, plus any picked in this editor before Apply.
  const customColors = customLabelColors([{ labels: labels.map((l) => ({ color: l.color })) }]);
  const savedColors = [...new Set([...boardColors.map((c) => c.toLowerCase()), ...customColors])];

  const patch = (id: string, change: Partial<StatusLabel>) =>
    setLabels((list) => list.map((l) => (l.id === id ? { ...l, ...change } : l)));

  const add = () => {
    const all = [...fixed, ...labels];
    const index = Math.max(-1, ...all.map((l) => l.index)) + 1;
    const color = nextGroupColor(labels.map((l) => l.color));
    const label: StatusLabel = { id: newSlugId(), index, label: '', color };
    setLabels((list) => [...list, label]);
  };

  const save = () => {
    const kept = labels
      .filter((l) => l.label.trim() !== '')
      .map((l) => ({ ...l, label: l.label.trim() }));
    // The list order is the saved order. `index` is what cell values reference, so it is never
    // renumbered; the blank "no status" label stays out of the list and sorts first in pickers.
    const next = { labels: [...kept, ...fixed] };
    const parsed = statusSettingsSchema.safeParse(next);
    if (!parsed.success || kept.length === 0) {
      setError('Keep at least one label with a name.');
      return;
    }
    onSave(parsed.data);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
      event.preventDefault();
    }
  };

  return (
    <div className={popups.body} onKeyDown={onKeyDown}>
      <div className={popups.labelRows}>
        <LabelSortable
          ids={labels.map((l) => l.id)}
          onDragMove={(id, overId) =>
            setLabels((list) => moveItemOver(list, (l) => l.id, id, overId))
          }
        >
          {labels.map((label) => (
            <SortableLabelRow
              key={label.id}
              id={label.id}
              name={label.label}
              onMove={(delta) => move(label.id, delta)}
            >
              <div className={popups.labelRow}>
                <button
                  type="button"
                  className={popups.swatch}
                  style={{ backgroundColor: label.color }}
                  aria-label={`Color of ${label.label || 'new label'}`}
                  onClick={() => setOpenPalette(openPalette === label.id ? null : label.id)}
                />
                <input
                  className={popups.input}
                  value={label.label}
                  maxLength={MAX_LABEL}
                  placeholder="Label name"
                  aria-label="Label name"
                  onChange={(event) => patch(label.id, { label: event.target.value })}
                />
                <button
                  type="button"
                  className={classNames(popups.iconButton)}
                  aria-label={`${label.isDone ? 'Unmark' : 'Mark'} ${label.label || 'label'} as done`}
                  aria-pressed={label.isDone === true}
                  title="Counts as done"
                  onClick={() => patch(label.id, { isDone: label.isDone ? undefined : true })}
                >
                  <Check aria-hidden="true" style={{ opacity: label.isDone ? 1 : 0.35 }} />
                </button>
                <button
                  type="button"
                  className={popups.iconButton}
                  aria-label={`Delete ${label.label || 'label'}`}
                  disabled={labels.length <= 1}
                  onClick={() => setLabels((list) => list.filter((l) => l.id !== label.id))}
                >
                  <Delete aria-hidden="true" />
                </button>
              </div>
              {openPalette === label.id ? (
                <LabelPalette
                  color={label.color}
                  saved={savedColors}
                  onPick={(color) => {
                    patch(label.id, { color });
                    setOpenPalette(null);
                  }}
                />
              ) : null}
            </SortableLabelRow>
          ))}
        </LabelSortable>
      </div>
      <span className={popups.srOnly} data-testid="label-live" role="status" aria-live="polite">
        {announcement}
      </span>
      <button type="button" className={popups.editLink} onClick={add}>
        <Add aria-hidden="true" /> New label
      </button>
      {error ? <p className={popups.error}>{error}</p> : null}
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={popups.linkButton} onClick={save}>
          Apply
        </button>
      </div>
    </div>
  );
}

/** Label list editor for a dropdown column: rename, add and delete. */
export function DropdownLabelEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: DropdownSettings;
  onSave: (settings: DropdownSettings) => void;
  onCancel: () => void;
}) {
  const [labels, setLabels] = useState<DropdownLabel[]>(() =>
    settings.labels.map((l) => ({ ...l })),
  );

  const [announcement, setAnnouncement] = useState('');

  const move = (id: number, delta: -1 | 1) =>
    setLabels((list) => {
      const from = list.findIndex((l) => l.id === id);
      const next = moveItem(list, from, from + delta);
      const to = next.findIndex((l) => l.id === id);
      if (to !== from)
        setAnnouncement(moveAnnouncement(list[from]?.label ?? '', to + 1, list.length));
      return next;
    });

  const add = () =>
    setLabels((list) => [...list, { id: Math.max(-1, ...list.map((l) => l.id)) + 1, label: '' }]);

  const save = () => {
    const kept = labels.map((l) => ({ ...l, label: l.label.trim() })).filter((l) => l.label !== '');
    onSave({ ...settings, labels: kept });
  };

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <div className={popups.labelRows}>
        {labels.length === 0 ? <p className={popups.muted}>No labels yet</p> : null}
        <LabelSortable
          ids={labels.map((l) => l.id)}
          onDragMove={(id, overId) =>
            setLabels((list) => moveItemOver(list, (l) => l.id, id, overId))
          }
        >
          {labels.map((label) => (
            <SortableLabelRow
              key={label.id}
              id={label.id}
              name={label.label}
              onMove={(delta) => move(label.id, delta)}
            >
              <div className={popups.labelRow}>
                <input
                  className={popups.input}
                  value={label.label}
                  maxLength={MAX_LABEL}
                  placeholder="Label name"
                  aria-label="Label name"
                  onChange={(event) =>
                    setLabels((list) =>
                      list.map((l) =>
                        l.id === label.id ? { ...l, label: event.target.value } : l,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className={popups.iconButton}
                  aria-label={`Delete ${label.label || 'label'}`}
                  onClick={() => setLabels((list) => list.filter((l) => l.id !== label.id))}
                >
                  <Delete aria-hidden="true" />
                </button>
              </div>
            </SortableLabelRow>
          ))}
        </LabelSortable>
      </div>
      <span className={popups.srOnly} data-testid="label-live" role="status" aria-live="polite">
        {announcement}
      </span>
      <button type="button" className={popups.editLink} onClick={add}>
        <Add aria-hidden="true" /> New label
      </button>
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={popups.linkButton} onClick={save}>
          Apply
        </button>
      </div>
    </div>
  );
}
