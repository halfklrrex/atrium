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
import { STATUS_LABEL_COLORS, nextGroupColor } from '../theme/palette';
import popups from './popups.module.css';

const MAX_LABEL = 60;

/**
 * "Edit Labels" for a status column: rename, recolour, mark as done, add and delete labels. The
 * grey label with no text (monday's "no status" default) is kept as it is and not listed.
 */
export function StatusLabelEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: StatusSettings;
  onSave: (settings: StatusSettings) => void;
  onCancel: () => void;
}) {
  const [fixed] = useState(() => settings.labels.filter((l) => l.label.trim() === ''));
  const [labels, setLabels] = useState<StatusLabel[]>(() =>
    settings.labels.filter((l) => l.label.trim() !== '').map((l) => ({ ...l })),
  );
  const [openPalette, setOpenPalette] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const next = { labels: [...kept, ...fixed].sort((a, b) => a.index - b.index) };
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
        {labels.map((label) => (
          <div key={label.id}>
            <div className={popups.labelRow}>
              <button
                type="button"
                className={popups.swatch}
                style={{ backgroundColor: label.color }}
                aria-label={`Colour of ${label.label || 'new label'}`}
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
              <div className={popups.palette} role="radiogroup" aria-label="Label colour">
                {STATUS_LABEL_COLORS.map((color) => (
                  <button
                    key={color.hex}
                    type="button"
                    role="radio"
                    aria-checked={color.hex === label.color}
                    aria-label={color.label}
                    title={color.label}
                    className={classNames(
                      popups.paletteSwatch,
                      color.hex === label.color && popups.paletteSelected,
                    )}
                    style={{ backgroundColor: color.hex }}
                    onClick={() => {
                      patch(label.id, { color: color.hex });
                      setOpenPalette(null);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
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
        {labels.map((label) => (
          <div key={label.id} className={popups.labelRow}>
            <input
              className={popups.input}
              value={label.label}
              maxLength={MAX_LABEL}
              placeholder="Label name"
              aria-label="Label name"
              onChange={(event) =>
                setLabels((list) =>
                  list.map((l) => (l.id === label.id ? { ...l, label: event.target.value } : l)),
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
        ))}
      </div>
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
