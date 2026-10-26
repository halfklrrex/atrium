import { findStatusLabel, type StatusSettings, type StatusValue } from '@atrium/shared';
import { Edit, Status as StatusIcon } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import styles from './cells.module.css';
import { StatusLabelEditor } from './LabelEditors';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

/** Full-bleed colour with a white label; the empty value is the grey default with no text. */
function StatusCell({ value, settings }: CellProps<StatusValue, StatusSettings>) {
  const label = value ? findStatusLabel(value, settings) : null;
  return (
    <div className={styles.status} style={label ? { backgroundColor: label.color } : undefined}>
      {label?.label ? <span className={styles.statusText}>{label.label}</span> : null}
    </div>
  );
}

function StatusEditor({
  value,
  settings,
  column,
  anchor,
  onChange,
  onClose,
  saveSettings,
}: EditorProps<StatusValue, StatusSettings>) {
  const [editingLabels, setEditingLabels] = useState(false);
  const selected = value ? findStatusLabel(value, settings) : null;
  const labels = [...settings.labels].sort((a, b) => a.index - b.index);

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={`${column.title} labels`} center>
      {editingLabels ? (
        <StatusLabelEditor
          settings={settings}
          onCancel={() => setEditingLabels(false)}
          onSave={(next) => {
            saveSettings(next);
            setEditingLabels(false);
          }}
        />
      ) : (
        <div className={popups.body}>
          <div className={popups.chips} role="listbox" aria-label={column.title}>
            {labels.map((label) => (
              <button
                key={label.id}
                type="button"
                role="option"
                aria-selected={selected?.id === label.id}
                aria-label={label.label || 'No label'}
                className={classNames(
                  popups.chip,
                  selected?.id === label.id && popups.chipSelected,
                )}
                style={{ backgroundColor: label.color }}
                onClick={() => {
                  // The blank grey label is "no status": clearing is an empty value, not an index.
                  onChange(label.label.trim() === '' ? null : { index: label.index });
                  onClose();
                }}
              >
                {label.label}
              </button>
            ))}
          </div>
          <hr className={popups.divider} />
          <button type="button" className={popups.editLink} onClick={() => setEditingLabels(true)}>
            <Edit aria-hidden="true" /> Edit Labels
          </button>
        </div>
      )}
    </AnchoredPopup>
  );
}

export const statusUi = defineColumnUi<StatusValue, StatusSettings>({
  type: 'status',
  icon: StatusIcon,
  tone: 'green',
  editor: 'popover',
  Cell: StatusCell,
  Editor: StatusEditor,
});
