import {
  BUTTON_ACTION_LABELS,
  isAutomationOnlyAction,
  BUTTON_LIMITS,
  type ButtonAction,
  type GroupDef,
} from '@atrium/shared';
import { Button, IconButton } from '@vibe/core';
import { Delete, DropdownChevronDown, DropdownChevronUp } from '@vibe/icons';
import classNames from 'classnames';
import { useContext, useState } from 'react';
import { PersonRow } from '../../columns/people';
import { getColumnUi } from '../../columns/registry';
import { useWorkspaceMembers } from '../../data/members-store';
import popups from '../../columns/popups.module.css';
import type { CellContext } from '../../columns/types';
import { tableActions } from './table-actions';
import { TableEnvContext } from './table-env';
import type { ColumnView } from './table-model';
import { isWritableByButton } from './button-actions';
import styles from './ButtonActionsEditor.module.css';

const ACTION_TYPES = Object.keys(BUTTON_ACTION_LABELS) as ButtonAction['type'][];
/** What a button column offers: the automation-only types stay out of its settings. */
const BUTTON_ACTION_TYPES = ACTION_TYPES.filter((type) => !isAutomationOnlyAction(type));
const ADD_DISABLED_REASON = `A button runs at most ${BUTTON_LIMITS.maxActions} actions`;

/** The column's own cell editor for a `set_value` action's value, plus "Clear the cell". */
function ValueField({
  column,
  value,
  boardId,
  onChange,
}: {
  column: ColumnView;
  value: unknown;
  boardId?: string;
  onChange: (value: unknown) => void;
}) {
  // Inside the board table the env is there; the Automation center renders outside it and passes
  // `boardId` instead (it then can't change column settings, so label editing is read-only).
  const env = useContext(TableEnvContext);
  const saveColumnSettings = (settings: unknown) => {
    if (env) {
      void tableActions.updateColumn(env.ctx, column.def.id, {
        settings: settings as Record<string, unknown>,
      });
    }
  };
  const ui = getColumnUi(column.def.type);
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!ui) return null;

  const ctx: CellContext = {
    highlight: '',
    rowDone: false,
    canEdit: true,
    boardId: env?.boardId ?? boardId ?? '',
    getItems: env?.getItems ?? (() => []),
  };
  const cleared = value === null;
  const current = value === undefined || value === null ? null : value;
  const Editor = ui.Editor;
  const open = () => {
    if (ui.editor === 'toggle' && ui.toggle) onChange(ui.toggle(current));
    else setEditing(true);
  };

  return (
    <div className={popups.field}>
      <span className={popups.fieldLabel}>Value</span>
      <div
        ref={setAnchor}
        role="button"
        tabIndex={0}
        aria-label={`Value for ${column.def.title}`}
        className={styles.valueBox}
        onClick={cleared ? undefined : open}
        onKeyDown={(event) => {
          if (!cleared && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            open();
          }
        }}
      >
        <div className={styles.valueBoxCell}>
          {editing && ui.editor === 'inline' && Editor ? (
            <Editor
              value={current}
              settings={column.settings}
              column={column.def}
              ctx={ctx}
              anchor={anchor}
              onChange={onChange}
              onClose={() => setEditing(false)}
              saveSettings={saveColumnSettings}
            />
          ) : cleared ? null : (
            <ui.Cell
              value={current}
              settings={column.settings}
              column={column.def}
              ctx={ctx}
              onChange={onChange}
            />
          )}
        </div>
      </div>
      {editing && ui.editor === 'popover' && Editor ? (
        <Editor
          value={current}
          settings={column.settings}
          column={column.def}
          ctx={ctx}
          anchor={anchor}
          onChange={onChange}
          onClose={() => setEditing(false)}
          saveSettings={saveColumnSettings}
        />
      ) : null}
      <label className={popups.checkboxRow}>
        <input
          type="checkbox"
          checked={cleared}
          onChange={(event) => onChange(event.target.checked ? null : undefined)}
        />
        <span>Clear value</span>
      </label>
    </div>
  );
}

/** The people a `notify` action tells: the workspace's members (the People picker's rows). */
function NotifyFields({
  action,
  onChange,
}: {
  action: Extract<ButtonAction, { type: 'notify' }>;
  onChange: (action: ButtonAction) => void;
}) {
  const { members } = useWorkspaceMembers();
  const selected = new Set(action.uids);
  const known = new Set(members.map((m) => m.id));
  // Members, plus anyone already chosen who has since left (so they can be removed).
  const candidates = [...members.map((m) => m.id), ...action.uids.filter((id) => !known.has(id))];
  const full = action.uids.length >= BUTTON_LIMITS.maxNotifyUids;
  const set = (uids: string[], message = action.message) =>
    onChange({ type: 'notify', uids, ...(message ? { message } : {}) });

  return (
    <>
      <div className={popups.field}>
        <span className={popups.fieldLabel}>People</span>
        <div
          className={popups.list}
          role="listbox"
          aria-label="People to notify"
          aria-multiselectable
        >
          {candidates.length === 0 ? (
            <p className={popups.muted}>No one found</p>
          ) : (
            candidates.map((id) => (
              <PersonRow
                key={id}
                uid={id}
                selected={selected.has(id)}
                onToggle={() => {
                  if (selected.has(id)) set(action.uids.filter((u) => u !== id));
                  else if (!full) set([...action.uids, id]);
                }}
              />
            ))
          )}
        </div>
        <span className={styles.helper}>
          {action.uids.length} of {BUTTON_LIMITS.maxNotifyUids} chosen. You are never notified of
          your own click.
        </span>
      </div>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Message (optional)</span>
        <input
          className={popups.input}
          value={action.message ?? ''}
          maxLength={BUTTON_LIMITS.maxNotifyMessage}
          onChange={(event) => set(action.uids, event.target.value)}
        />
      </label>
    </>
  );
}

/** The new item a `create_item` action makes: its name, optional group and up to 10 values. */
function CreateItemFields({
  action,
  columns,
  groups,
  boardId,
  onChange,
}: {
  action: Extract<ButtonAction, { type: 'create_item' }>;
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  boardId?: string;
  onChange: (action: ButtonAction) => void;
}) {
  const writable = columns.filter(isWritableByButton);
  const values = action.values ?? {};
  const entries = Object.entries(values);
  const free = writable.filter((c) => !(c.def.id in values));
  const set = (next: Record<string, unknown>) => {
    const { values: _old, ...rest } = action;
    onChange(Object.keys(next).length > 0 ? { ...rest, values: next } : rest);
  };
  const setGroup = (groupId: string) => {
    const { groupId: _old, ...rest } = action;
    onChange(groupId ? { ...rest, groupId } : rest);
  };
  // Swapping a row's column keeps its place in the list and clears its value.
  const replaceKey = (from: string, to: string) =>
    Object.fromEntries(entries.map(([k, v]) => (k === from ? [to, undefined] : [k, v])));

  return (
    <>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>Name</span>
        <input
          className={popups.input}
          value={action.name}
          maxLength={BUTTON_LIMITS.maxCreateName}
          onChange={(event) => onChange({ ...action, name: event.target.value })}
        />
        <span className={styles.helper}>
          Use {'{name}'} for the current name and {'{date}'} for today (YYYY-MM-DD).
        </span>
      </label>
      <label className={popups.field}>
        <span className={popups.fieldLabel}>In group</span>
        <select
          className={popups.input}
          value={action.groupId ?? ''}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option value="">Default group</option>
          {action.groupId && !groups.some((g) => g.id === action.groupId) ? (
            <option value={action.groupId}>Deleted group</option>
          ) : null}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </label>
      {entries.map(([columnId, value], i) => {
        const target = columns.find((c) => c.def.id === columnId);
        return (
          <div
            key={columnId}
            role="group"
            aria-label={`Value ${i + 1}`}
            className={styles.valueRow}
          >
            <label className={popups.field}>
              <span className={popups.fieldLabel}>Column</span>
              <select
                className={popups.input}
                value={target ? columnId : ''}
                onChange={(event) => set(replaceKey(columnId, event.target.value))}
              >
                {target ? null : (
                  <option value="" disabled>
                    Deleted column
                  </option>
                )}
                {target ? <option value={columnId}>{target.def.title}</option> : null}
                {free
                  .filter((c) => c.def.id !== columnId)
                  .map((c) => (
                    <option key={c.def.id} value={c.def.id}>
                      {c.def.title}
                    </option>
                  ))}
              </select>
            </label>
            {target ? (
              <ValueField
                key={columnId}
                column={target}
                value={value}
                boardId={boardId}
                onChange={(next) => set({ ...values, [columnId]: next })}
              />
            ) : null}
            <div>
              <Button
                kind="tertiary"
                size="small"
                aria-label={`Remove value ${i + 1}`}
                onClick={() => set(Object.fromEntries(entries.filter(([k]) => k !== columnId)))}
              >
                Remove value
              </Button>
            </div>
          </div>
        );
      })}
      <div>
        <Button
          kind="tertiary"
          size="small"
          disabled={entries.length >= BUTTON_LIMITS.maxCreateValues || free.length === 0}
          onClick={() => set({ ...values, [free[0]!.def.id]: undefined })}
        >
          + Add value
        </Button>
        {entries.length >= BUTTON_LIMITS.maxCreateValues ? (
          <span
            className={styles.helper}
          >{` At most ${BUTTON_LIMITS.maxCreateValues} values.`}</span>
        ) : null}
      </div>
    </>
  );
}

function ActionRow({
  action,
  index,
  count,
  error,
  columns,
  groups,
  boardId,
  onChange,
  onMove,
  onRemove,
}: {
  action: ButtonAction;
  index: number;
  count: number;
  error: string | null;
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  boardId?: string;
  onChange: (action: ButtonAction) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = BUTTON_ACTION_LABELS[action.type];
  const writable = columns.filter(isWritableByButton);
  const target =
    action.type === 'set_value' ? columns.find((c) => c.def.id === action.columnId) : null;

  return (
    <li
      role="group"
      aria-label={`Action ${index + 1}: ${label}`}
      className={classNames(styles.row, error && styles.rowError)}
    >
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>
          {index + 1}. {label}
        </span>
        <span className={styles.rowButtons}>
          <IconButton
            icon={DropdownChevronUp}
            kind="tertiary"
            size="xxs"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon={DropdownChevronDown}
            kind="tertiary"
            size="xxs"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          />
          <IconButton
            icon={Delete}
            kind="tertiary"
            size="xxs"
            aria-label="Remove"
            onClick={onRemove}
          />
        </span>
      </div>

      {action.type === 'set_value' ? (
        <>
          <label className={popups.field}>
            <span className={popups.fieldLabel}>Column</span>
            <select
              className={popups.input}
              value={target ? action.columnId : ''}
              onChange={(event) =>
                onChange({ type: 'set_value', columnId: event.target.value, value: undefined })
              }
            >
              <option value="" disabled>
                {action.columnId && !target ? 'Deleted column' : 'Choose a column'}
              </option>
              {writable.map((c) => (
                <option key={c.def.id} value={c.def.id}>
                  {c.def.title}
                </option>
              ))}
            </select>
          </label>
          {target ? (
            <ValueField
              key={target.def.id}
              column={target}
              value={action.value}
              boardId={boardId}
              onChange={(value) => onChange({ ...action, value })}
            />
          ) : null}
        </>
      ) : null}

      {action.type === 'rename_item' ? (
        <label className={popups.field}>
          <span className={popups.fieldLabel}>New name</span>
          <input
            className={popups.input}
            value={action.template}
            maxLength={200}
            onChange={(event) => onChange({ type: 'rename_item', template: event.target.value })}
          />
          <span className={styles.helper}>
            Use {'{name}'} for the current name and {'{date}'} for today (YYYY-MM-DD).
          </span>
        </label>
      ) : null}

      {action.type === 'move_to_group' ? (
        <div className={popups.field}>
          <span className={popups.fieldLabel}>Group</span>
          <div className={styles.groups} role="radiogroup" aria-label="Group">
            {groups.map((g) => {
              const selected = g.id === action.groupId;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={classNames(styles.group, selected && styles.groupOn)}
                  onClick={() => onChange({ type: 'move_to_group', groupId: g.id })}
                >
                  <span className={styles.dot} style={{ backgroundColor: g.color }} />
                  {g.title}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {action.type === 'notify' ? <NotifyFields action={action} onChange={onChange} /> : null}

      {action.type === 'create_item' ? (
        <CreateItemFields
          action={action}
          columns={columns}
          groups={groups}
          boardId={boardId}
          onChange={onChange}
        />
      ) : null}

      {action.type === 'post_update' ? (
        <label className={popups.field}>
          <span className={popups.fieldLabel}>Update text</span>
          <textarea
            className={popups.input}
            rows={3}
            value={action.text}
            maxLength={BUTTON_LIMITS.maxUpdateText}
            onChange={(event) => onChange({ type: 'post_update', text: event.target.value })}
          />
          <span className={styles.helper}>
            Posted as &quot;Automations&quot;. Use {'{name}'} and {'{date}'} like in a rename.
          </span>
        </label>
      ) : null}

      {action.type === 'archive_item' ? (
        <p className={styles.helper}>The item moves to the archive.</p>
      ) : null}

      {error ? (
        <p role="alert" className={popups.error}>
          {error}
        </p>
      ) : null}
    </li>
  );
}

function newAction(type: ButtonAction['type'], groups: readonly GroupDef[]): ButtonAction {
  switch (type) {
    case 'set_value':
      return { type, columnId: '', value: undefined };
    case 'rename_item':
      return { type, template: '{name}' };
    case 'move_to_group':
      return { type, groupId: groups[0]?.id ?? '' };
    case 'archive_item':
      return { type };
    case 'notify':
      return { type, uids: [] };
    case 'create_item':
      return { type, name: '' };
    case 'post_update':
      return { type, text: '' };
  }
}

/** The ordered action list of a button column (up to five), edited in its settings popover. */
export function ButtonActionsEditor({
  actions,
  errors,
  columns,
  groups,
  boardId,
  emptyHint = 'No actions: a click is only recorded in the activity log.',
  allowAutomationOnly = false,
  allowedTypes,
  onChange,
}: {
  actions: readonly ButtonAction[];
  errors: readonly (string | null)[];
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  /** Needed outside the board table (no table env there), e.g. in the recipe builder. */
  boardId?: string;
  /** Shown while the list is empty (a recipe needs at least one action). */
  emptyHint?: string;
  /** Offer `create_item` / `post_update`; only a recipe may. */
  allowAutomationOnly?: boolean;
  /** Narrows the "Add action" list further (a recurring recipe has no item to act on). */
  allowedTypes?: readonly ButtonAction['type'][];
  onChange: (actions: ButtonAction[]) => void;
}) {
  const full = actions.length >= BUTTON_LIMITS.maxActions;
  const replace = (index: number, next: ButtonAction) =>
    onChange(actions.map((a, i) => (i === index ? next : a)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...actions];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };

  return (
    <div className={styles.root}>
      <span className={popups.fieldLabel}>Actions</span>
      {actions.length > 0 ? (
        <ol className={styles.list} aria-label="Actions">
          {actions.map((action, index) => (
            <ActionRow
              key={index}
              action={action}
              index={index}
              count={actions.length}
              error={errors[index] ?? null}
              columns={columns}
              groups={groups}
              boardId={boardId}
              onChange={(next) => replace(index, next)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => onChange(actions.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      ) : (
        <p className={styles.helper}>{emptyHint}</p>
      )}
      <div className={styles.addRow}>
        <select
          className={popups.input}
          aria-label="Add action"
          value=""
          disabled={full}
          title={full ? ADD_DISABLED_REASON : undefined}
          onChange={(event) => {
            const type = event.target.value as ButtonAction['type'];
            if (type) onChange([...actions, newAction(type, groups)]);
          }}
        >
          <option value="">Add action</option>
          {(allowAutomationOnly ? ACTION_TYPES : BUTTON_ACTION_TYPES)
            .filter((type) => !allowedTypes || allowedTypes.includes(type))
            .map((type) => (
              <option key={type} value={type}>
                {BUTTON_ACTION_LABELS[type]}
              </option>
            ))}
        </select>
        {full ? <span className={styles.helper}>{ADD_DISABLED_REASON}.</span> : null}
      </div>
    </div>
  );
}
