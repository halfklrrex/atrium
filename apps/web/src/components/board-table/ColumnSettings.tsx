import type {
  DropdownSettings,
  HourSettings,
  NumbersSettings,
  StatusSettings,
  TimelineSettings,
  WeekSettings,
  WorldClockSettings,
} from '@atrium/shared';
import { useState } from 'react';
import { DropdownLabelEditor, StatusLabelEditor } from '../../columns/LabelEditors';
import popups from '../../columns/popups.module.css';
import { AnchoredPopup } from './AnchoredPopup';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import type { ColumnView } from './table-model';
import { useTableStore } from './table-store';

/** Unit symbol, its side and the number of decimals for a numbers column. */
function NumbersSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: NumbersSettings;
  onSave: (settings: NumbersSettings) => void;
  onCancel: () => void;
}) {
  const [symbol, setSymbol] = useState(settings.unit?.symbol ?? '');
  const [direction, setDirection] = useState<'left' | 'right'>(settings.unit?.direction ?? 'left');
  const [decimals, setDecimals] = useState(
    settings.decimals === null ? '' : String(settings.decimals),
  );

  const save = () => {
    const parsed =
      decimals.trim() === '' ? null : Math.max(0, Math.min(8, Math.round(Number(decimals))));
    onSave({
      unit: symbol.trim() ? { symbol: symbol.trim().slice(0, 8), direction } : null,
      decimals: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    });
  };

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Unit</span>
        <input
          className={popups.input}
          value={symbol}
          maxLength={8}
          placeholder="$, kg, %"
          autoFocus
          onChange={(event) => setSymbol(event.target.value)}
        />
      </label>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Unit position</span>
        <select
          className={popups.input}
          value={direction}
          onChange={(event) => setDirection(event.target.value as 'left' | 'right')}
        >
          <option value="left">Before the number</option>
          <option value="right">After the number</option>
        </select>
      </label>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Decimals</span>
        <input
          className={popups.input}
          value={decimals}
          inputMode="numeric"
          placeholder="As typed"
          onChange={(event) => setDecimals(event.target.value.replace(/[^\d]/g, '').slice(0, 1))}
        />
      </label>
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

/** Progress bar toggle for a timeline column. */
function TimelineSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: TimelineSettings;
  onSave: (settings: TimelineSettings) => void;
  onCancel: () => void;
}) {
  const [showProgress, setShowProgress] = useState(settings.showProgress ?? false);

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={showProgress}
          onChange={(event) => setShowProgress(event.target.checked)}
        />
        <span>Show progress bar</span>
      </label>
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={popups.linkButton}
          onClick={() => onSave({ showProgress })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** First day of week selector for a week column. */
function WeekSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: WeekSettings;
  onSave: (settings: WeekSettings) => void;
  onCancel: () => void;
}) {
  const [firstDayOfWeek, setFirstDayOfWeek] = useState<'monday' | 'sunday'>(
    settings.firstDayOfWeek ?? 'monday',
  );

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>First day of week</span>
        <select
          className={popups.input}
          value={firstDayOfWeek}
          onChange={(event) => setFirstDayOfWeek(event.target.value as 'monday' | 'sunday')}
        >
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
        </select>
      </label>
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={popups.linkButton}
          onClick={() => onSave({ firstDayOfWeek })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** 24-hour vs 12-hour format toggle for an hour column. */
function HourSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: HourSettings;
  onSave: (settings: HourSettings) => void;
  onCancel: () => void;
}) {
  const [format24Hour, setFormat24Hour] = useState(settings.format24Hour ?? true);

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={format24Hour}
          onChange={(event) => setFormat24Hour(event.target.checked)}
        />
        <span>24-hour format</span>
      </label>
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={popups.linkButton}
          onClick={() => onSave({ format24Hour })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** 24-hour format and city display toggles for a world clock column. */
function WorldClockSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: WorldClockSettings;
  onSave: (settings: WorldClockSettings) => void;
  onCancel: () => void;
}) {
  const [format24Hour, setFormat24Hour] = useState(settings.format24Hour ?? true);
  const [showCity, setShowCity] = useState(settings.showCity ?? true);

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={format24Hour}
          onChange={(event) => setFormat24Hour(event.target.checked)}
        />
        <span>24-hour format</span>
      </label>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={showCity}
          onChange={(event) => setShowCity(event.target.checked)}
        />
        <span>Show city name</span>
      </label>
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={popups.linkButton}
          onClick={() => onSave({ format24Hour, showCity })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** The settings popover of one column, opened from its header menu. */
export function ColumnSettingsPopup({
  column,
  anchor,
}: {
  column: ColumnView;
  anchor: HTMLElement | null;
}) {
  const env = useTableEnv();
  const close = () => useTableStore.getState().setSettingsFor(null);
  const save = (settings: unknown) => {
    void tableActions.updateColumn(env.ctx, column.def.id, {
      settings: settings as Record<string, unknown>,
    });
    close();
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={close} label={`${column.def.title} settings`} center>
      {column.def.type === 'status' ? (
        <StatusLabelEditor
          settings={column.settings as StatusSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'dropdown' ? (
        <DropdownLabelEditor
          settings={column.settings as DropdownSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'numbers' ? (
        <NumbersSettingsEditor
          settings={column.settings as NumbersSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'timeline' ? (
        <TimelineSettingsEditor
          settings={column.settings as TimelineSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'week' ? (
        <WeekSettingsEditor
          settings={column.settings as WeekSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'hour' ? (
        <HourSettingsEditor
          settings={column.settings as HourSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'world_clock' ? (
        <WorldClockSettingsEditor
          settings={column.settings as WorldClockSettings}
          onSave={save}
          onCancel={close}
        />
      ) : (
        <div className={popups.body}>
          <p className={popups.muted}>No settings for this column</p>
        </div>
      )}
    </AnchoredPopup>
  );
}
