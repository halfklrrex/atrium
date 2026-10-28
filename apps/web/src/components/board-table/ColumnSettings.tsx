import {
  validateFormulaSettings,
  type BoardRelationSettings,
  type ButtonSettings,
  type DependencySettings,
  type DropdownSettings,
  type FilesSettings,
  type FormulaSettings,
  type HourSettings,
  type NumbersSettings,
  type StatusSettings,
  type TimeTrackingSettings,
  type TimelineSettings,
  type WeekSettings,
  type WorldClockSettings,
} from '@atrium/shared';
import classNames from 'classnames';
import { useState } from 'react';
import { DropdownLabelEditor, StatusLabelEditor } from '../../columns/LabelEditors';
import popups from '../../columns/popups.module.css';
import { useBoards } from '../../data';
import { GROUP_COLORS } from '../../theme/palette';
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

/** Max file size (1..100 MB) and allowed file types for a files column. */
function FilesSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: FilesSettings;
  onSave: (settings: FilesSettings) => void;
  onCancel: () => void;
}) {
  const [maxSize, setMaxSize] = useState(String(settings.maxFileSizeMb ?? 50));
  const [allowedTypes, setAllowedTypes] = useState((settings.allowedTypes ?? []).join(', '));

  const save = () => {
    const parsedSize = Number(maxSize);
    const maxFileSizeMb =
      Number.isFinite(parsedSize) && maxSize.trim() !== ''
        ? Math.max(1, Math.min(100, Math.round(parsedSize)))
        : 50;
    const parsedTypes = allowedTypes
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    onSave(
      parsedTypes.length > 0 ? { maxFileSizeMb, allowedTypes: parsedTypes } : { maxFileSizeMb },
    );
  };

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Max file size (MB)</span>
        <input
          className={popups.input}
          type="number"
          min={1}
          max={100}
          value={maxSize}
          onChange={(event) => setMaxSize(event.target.value)}
        />
      </label>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Allowed types</span>
        <input
          className={popups.input}
          value={allowedTypes}
          placeholder=".pdf, image/*"
          onChange={(event) => setAllowedTypes(event.target.value)}
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

/** Label text and palette colour for a button column. */
function ButtonSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: ButtonSettings;
  onSave: (settings: ButtonSettings) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(settings.label ?? 'Click');
  const [color, setColor] = useState(settings.color ?? GROUP_COLORS[17]!.hex);

  const save = () => {
    const cleanLabel = label.trim().slice(0, 50) || 'Click';
    onSave({ label: cleanLabel, color });
  };

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Button label</span>
        <input
          className={popups.input}
          value={label}
          maxLength={50}
          placeholder="Click"
          autoFocus
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <div className={popups.field}>
        <span className={popups.fieldLabel}>Button colour</span>
        <div className={popups.palette} role="radiogroup" aria-label="Button colour">
          {GROUP_COLORS.map((swatch) => {
            const selected = swatch.hex.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={swatch.hex}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={swatch.label}
                title={swatch.label}
                className={classNames(popups.paletteSwatch, selected && popups.paletteSelected)}
                style={{ backgroundColor: swatch.hex }}
                onClick={() => setColor(swatch.hex)}
              />
            );
          })}
        </div>
      </div>
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

/** Session history and required note toggles for a time tracking column. */
function TimeTrackingSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: TimeTrackingSettings;
  onSave: (settings: TimeTrackingSettings) => void;
  onCancel: () => void;
}) {
  const [trackHistory, setTrackHistory] = useState(settings.trackHistory ?? true);
  const [requireNote, setRequireNote] = useState(settings.requireNote ?? false);

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={trackHistory}
          onChange={(event) => setTrackHistory(event.target.checked)}
        />
        <span>Track session history</span>
      </label>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={requireNote}
          onChange={(event) => setRequireNote(event.target.checked)}
        />
        <span>Require a note when starting</span>
      </label>
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={popups.linkButton}
          onClick={() => onSave({ trackHistory, requireNote })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** Expression editor, column chips, live validation, output type and formatting for a formula column. */
function FormulaSettingsEditor({
  column,
  settings,
  onSave,
  onCancel,
}: {
  column: ColumnView;
  settings: FormulaSettings;
  onSave: (settings: FormulaSettings) => void;
  onCancel: () => void;
}) {
  const env = useTableEnv();
  const [expression, setExpression] = useState(settings.expression ?? '');
  const [outputType, setOutputType] = useState<FormulaSettings['outputType']>(
    settings.outputType ?? 'text',
  );
  const [decimalPlaces, setDecimalPlaces] = useState(
    settings.decimalPlaces === undefined ? '' : String(settings.decimalPlaces),
  );
  const [currencySymbol, setCurrencySymbol] = useState(settings.currencySymbol ?? '');

  const allColumns = env.allColumns ?? env.columns;
  const otherColumns = allColumns.filter((c) => c.def.id !== column.def.id);
  const validation = validateFormulaSettings(
    expression,
    allColumns.map((c) => c.def),
    column.def.id,
  );

  const save = () => {
    if (!validation.valid) return;
    const next: FormulaSettings = {
      expression,
      outputType,
    };
    if (outputType === 'number') {
      const trimmedDecimals = decimalPlaces.trim();
      if (trimmedDecimals !== '') {
        const parsed = Number(trimmedDecimals);
        if (Number.isFinite(parsed)) {
          next.decimalPlaces = Math.max(0, Math.min(10, Math.round(parsed)));
        }
      }
      const trimmedSymbol = currencySymbol.trim();
      if (trimmedSymbol !== '') {
        next.currencySymbol = trimmedSymbol;
      }
    }
    onSave(next);
  };

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Formula expression</span>
        <textarea
          className={popups.textarea}
          aria-label="Formula expression"
          value={expression}
          placeholder="e.g. {Budget} * 1.2"
          onChange={(event) => setExpression(event.target.value)}
        />
      </label>
      {!validation.valid && (
        <p className={popups.error} role="alert">
          {validation.error}
        </p>
      )}
      {otherColumns.length > 0 && (
        <div className={popups.field}>
          <span className={popups.fieldLabel}>Insert column</span>
          <div className={popups.selectedPills}>
            {otherColumns.map((col) => (
              <button
                key={col.def.id}
                type="button"
                className={popups.selectedPill}
                onClick={() => setExpression((prev) => `${prev}{${col.def.title}}`)}
              >
                {`{${col.def.title}}`}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Output type</span>
        <select
          className={popups.input}
          aria-label="Output type"
          value={outputType}
          onChange={(event) => setOutputType(event.target.value as FormulaSettings['outputType'])}
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="boolean">Boolean</option>
        </select>
      </label>
      {outputType === 'number' && (
        <>
          <label className={popups.field}>
            <span className={popups.fieldLabel}>Decimal places</span>
            <input
              className={popups.input}
              type="number"
              min={0}
              max={10}
              value={decimalPlaces}
              placeholder="Auto"
              onChange={(event) => setDecimalPlaces(event.target.value)}
            />
          </label>
          <label className={popups.field}>
            <span className={popups.fieldLabel}>Currency symbol</span>
            <input
              className={popups.input}
              value={currencySymbol}
              maxLength={8}
              placeholder="$, €"
              onChange={(event) => setCurrencySymbol(event.target.value)}
            />
          </label>
        </>
      )}
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={popups.linkButton}
          disabled={!validation.valid}
          onClick={save}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** Strict mode toggle and date/timeline column picker for a dependency column. */
function DependencySettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: DependencySettings;
  onSave: (settings: DependencySettings) => void;
  onCancel: () => void;
}) {
  const env = useTableEnv();
  const [strict, setStrict] = useState(settings.strict ?? false);
  const [timeColumnId, setTimeColumnId] = useState(settings.timeColumnId ?? '');
  const timeColumns = (env.allColumns ?? env.columns).filter(
    (c) => c.def.type === 'date' || c.def.type === 'timeline',
  );

  const save = () => {
    onSave({
      strict,
      ...(timeColumnId ? { timeColumnId } : {}),
    });
  };

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={strict}
          onChange={(event) => setStrict(event.target.checked)}
        />
        <span>Strict mode</span>
      </label>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Time column</span>
        <select
          className={popups.input}
          aria-label="Time column"
          value={timeColumnId}
          onChange={(event) => setTimeColumnId(event.target.value)}
        >
          <option value="">None</option>
          {timeColumns.map((col) => (
            <option key={col.def.id} value={col.def.id}>
              {col.def.title}
            </option>
          ))}
        </select>
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

/** Workspace readable boards picker and multi-item toggle for a connect boards column. */
function BoardRelationSettingsEditor({
  settings,
  onSave,
  onCancel,
}: {
  settings: BoardRelationSettings;
  onSave: (settings: BoardRelationSettings) => void;
  onCancel: () => void;
}) {
  const env = useTableEnv();
  const liveBoards = useBoards(env.workspaceBoards ? undefined : env.workspaceId, env.uid || null);
  const boards = env.workspaceBoards ?? liveBoards.data;
  const [boardIds, setBoardIds] = useState<string[]>(settings.boardIds ?? []);
  const [allowMultipleItems, setAllowMultipleItems] = useState(settings.allowMultipleItems ?? true);

  const toggleBoard = (boardId: string) => {
    setBoardIds((prev) =>
      prev.includes(boardId) ? prev.filter((id) => id !== boardId) : [...prev, boardId],
    );
  };

  return (
    <div className={popups.body} onKeyDown={(event) => event.stopPropagation()}>
      <div className={popups.field}>
        <span className={popups.fieldLabel}>Connected boards</span>
        {boards.length === 0 ? (
          <p className={popups.muted}>No boards available</p>
        ) : (
          <div className={popups.list}>
            {boards.map((board) => (
              <label key={board.id} className={popups.checkboxRow}>
                <input
                  type="checkbox"
                  checked={boardIds.includes(board.id)}
                  onChange={() => toggleBoard(board.id)}
                />
                <span>{board.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={allowMultipleItems}
          onChange={(event) => setAllowMultipleItems(event.target.checked)}
        />
        <span>Allow linking multiple items</span>
      </label>
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={popups.linkButton}
          onClick={() => onSave({ boardIds, allowMultipleItems, twoWay: false })}
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
      ) : column.def.type === 'files' ? (
        <FilesSettingsEditor
          settings={column.settings as FilesSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'button' ? (
        <ButtonSettingsEditor
          settings={column.settings as ButtonSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'time_tracking' ? (
        <TimeTrackingSettingsEditor
          settings={column.settings as TimeTrackingSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'formula' ? (
        <FormulaSettingsEditor
          column={column}
          settings={column.settings as FormulaSettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'dependency' ? (
        <DependencySettingsEditor
          settings={column.settings as DependencySettings}
          onSave={save}
          onCancel={close}
        />
      ) : column.def.type === 'board_relation' ? (
        <BoardRelationSettingsEditor
          settings={column.settings as BoardRelationSettings}
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
