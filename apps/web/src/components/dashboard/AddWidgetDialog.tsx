import {
  DASHBOARD_LIMITS,
  type ColumnDef,
  type DashboardWidget,
  type DashboardWidgetType,
  type StatusSettings,
} from '@atrium/shared';
import {
  Checkbox,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TextField,
} from '@vibe/core';
import { useState } from 'react';
import { dashboardWrites, type BoardDoc, type DashboardDoc } from '../../data';
import { describeError } from '../boards/board-actions';
import dialogStyles from '../dialogs/dialogs.module.css';
import { submitOnEnter } from '../dialogs/submitOnEnter';
import styles from './dashboard.module.css';
import {
  NUMBERS_MODE_LABELS,
  type NumbersMode,
  type NumbersSettings,
} from './widgets/numbers-model';
import type { BatterySettings } from './widgets/battery-model';
import {
  DEFAULT_WIDGET_TITLE,
  WIDGET_TYPES,
  defaultWidgetSettings,
} from './widgets/widget-catalog';
import { columnOptions, isNumericColumn, isStatusColumn } from './widgets/widget-columns';

export interface AddWidgetDialogProps {
  dashboard: DashboardDoc;
  /** The dashboard's readable boards, for the column pickers. */
  boards: readonly BoardDoc[];
  /** Set to edit this widget (its type cannot change); unset to add a new one. */
  widget?: DashboardWidget;
  onClose: () => void;
}

type Settings = NumbersSettings | BatterySettings;

/** Status labels of the column `columnId`, from the first board that has it. */
function labelsOf(boards: readonly BoardDoc[], columnId: string | null) {
  if (!columnId) return [];
  for (const board of boards) {
    const def: ColumnDef | undefined = board.columns.find((c) => c.id === columnId);
    if (def && isStatusColumn(def)) {
      return [...((def.settings as unknown as StatusSettings).labels ?? [])]
        .filter((l) => l.label.trim() !== '')
        .sort((a, b) => a.index - b.index);
    }
  }
  return [];
}

/** Adds a widget to a dashboard, or edits one: type (new only), title and its settings. */
export function AddWidgetDialog({ dashboard, boards, widget, onClose }: AddWidgetDialogProps) {
  const editing = widget !== undefined;
  const [type, setType] = useState<DashboardWidgetType>(widget?.type ?? 'numbers');
  const [title, setTitle] = useState(widget?.title ?? DEFAULT_WIDGET_TITLE[type]);
  const [titleTouched, setTitleTouched] = useState(editing);
  const [settings, setSettings] = useState<Settings>(
    (widget?.settings as Settings | undefined) ?? defaultWidgetSettings('numbers'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numberColumns = columnOptions(boards, isNumericColumn);
  const statusColumns = columnOptions(boards, isStatusColumn);

  const chooseType = (next: DashboardWidgetType) => {
    setType(next);
    setSettings(defaultWidgetSettings(next as 'numbers') as Settings);
    if (!titleTouched) setTitle(DEFAULT_WIDGET_TITLE[next]);
  };

  const numbers = type === 'numbers' ? (settings as NumbersSettings) : null;
  const battery = type === 'battery' ? (settings as BatterySettings) : null;

  const needsColumn = numbers !== null && numbers.mode !== 'count';
  const missingColumn = needsColumn && !numbers.columnId;
  const titleOk = title.trim().length > 0 && title.length <= DASHBOARD_LIMITS.widgetTitle;
  const valid = titleOk && !missingColumn;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const cleanTitle = title.trim();
      if (widget) {
        await dashboardWrites.updateWidget(dashboard.id, widget.id, {
          title: cleanTitle,
          settings: settings as DashboardWidget['settings'],
        });
      } else {
        await dashboardWrites.addWidget(dashboard.id, {
          type,
          title: cleanTitle,
          settings: settings as DashboardWidget['settings'],
        });
      }
      onClose();
    } catch (e) {
      setError(describeError(e, 'Could not save the widget.'));
      setSaving(false);
    }
  }

  const filterLabels = labelsOf(boards, numbers?.filter?.columnId ?? null);
  const doneLabels = labelsOf(boards, battery?.statusColumnId ?? null);

  const toggleIn = (list: readonly string[], id: string): string[] =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];

  return (
    <Modal id="add-widget-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={editing ? 'Edit widget' : 'Add widget'} />
        <ModalContent>
          <form
            className={dialogStyles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {editing ? null : (
              <div role="radiogroup" aria-label="Widget type">
                <div className={styles.typeGrid}>
                  {WIDGET_TYPES.map((info) => (
                    <button
                      key={info.type}
                      type="button"
                      role="radio"
                      aria-checked={type === info.type}
                      disabled={!info.available}
                      className={styles.typeOption}
                      onClick={() => chooseType(info.type)}
                    >
                      {info.label}
                      <span className={styles.typeHint}>
                        {info.available ? info.hint : 'Coming soon'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <TextField
              title="Title"
              inputAriaLabel="Widget title"
              value={title}
              onChange={(value: string) => {
                setTitle(value);
                setTitleTouched(true);
              }}
              onKeyDown={submitOnEnter(() => void save())}
              maxLength={DASHBOARD_LIMITS.widgetTitle}
              size="medium"
            />

            {numbers ? (
              <>
                <label className={styles.field}>
                  <span className={dialogStyles.fieldLabel}>Show</span>
                  <select
                    className={styles.select}
                    aria-label="Calculation"
                    value={numbers.mode}
                    onChange={(e) =>
                      setSettings({
                        ...numbers,
                        mode: e.target.value as NumbersMode,
                        columnId: e.target.value === 'count' ? null : numbers.columnId,
                      })
                    }
                  >
                    {(Object.keys(NUMBERS_MODE_LABELS) as NumbersMode[]).map((mode) => (
                      <option key={mode} value={mode}>
                        {NUMBERS_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                </label>
                {needsColumn ? (
                  <label className={styles.field}>
                    <span className={dialogStyles.fieldLabel}>Column</span>
                    <select
                      className={styles.select}
                      aria-label="Column"
                      value={numbers.columnId ?? ''}
                      onChange={(e) =>
                        setSettings({ ...numbers, columnId: e.target.value || null })
                      }
                    >
                      <option value="">Choose a column</option>
                      {numberColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    {numberColumns.length === 0 ? (
                      <span className={dialogStyles.hint}>
                        None of the boards has a Numbers, Progress or number Formula column.
                      </span>
                    ) : null}
                  </label>
                ) : null}
                <label className={styles.field}>
                  <span className={dialogStyles.fieldLabel}>Only items with status in</span>
                  <select
                    className={styles.select}
                    aria-label="Filter by status column"
                    value={numbers.filter?.columnId ?? ''}
                    onChange={(e) =>
                      setSettings({
                        ...numbers,
                        filter: e.target.value ? { columnId: e.target.value, values: [] } : null,
                      })
                    }
                  >
                    <option value="">All items</option>
                    {statusColumns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                {numbers.filter ? (
                  <ul className={styles.checkList} aria-label="Status labels">
                    {filterLabels.map((label) => (
                      <li key={label.id}>
                        <Checkbox
                          label={label.label}
                          checked={numbers.filter?.values.includes(label.id) ?? false}
                          onChange={() =>
                            numbers.filter &&
                            setSettings({
                              ...numbers,
                              filter: {
                                ...numbers.filter,
                                values: toggleIn(numbers.filter.values, label.id),
                              },
                            })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}

            {battery ? (
              <>
                <label className={styles.field}>
                  <span className={dialogStyles.fieldLabel}>Status column</span>
                  <select
                    className={styles.select}
                    aria-label="Status column"
                    value={battery.statusColumnId ?? ''}
                    onChange={(e) =>
                      setSettings({
                        statusColumnId: e.target.value || null,
                        doneLabelIds: [],
                      })
                    }
                  >
                    <option value="">First status column of each board</option>
                    {statusColumns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                {battery.statusColumnId ? (
                  <ul className={styles.checkList} aria-label="Done labels">
                    {doneLabels.map((label) => (
                      <li key={label.id}>
                        <Checkbox
                          label={label.label}
                          checked={battery.doneLabelIds.includes(label.id)}
                          onChange={() =>
                            setSettings({
                              ...battery,
                              doneLabelIds: toggleIn(battery.doneLabelIds, label.id),
                            })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className={dialogStyles.hint}>
                  {battery.doneLabelIds.length > 0
                    ? 'The checked labels count as done.'
                    : 'Labels marked as done on the board count as done.'}
                </p>
              </>
            ) : null}

            {error ? (
              <p className={dialogStyles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: editing ? 'Save' : 'Add widget',
          onClick: () => void save(),
          disabled: !valid || saving,
          loading: saving,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: saving }}
      />
    </Modal>
  );
}
