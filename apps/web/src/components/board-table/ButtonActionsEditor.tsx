import {
  BUTTON_ACTION_LABELS,
  BUTTON_LIMITS,
  type ButtonAction,
  type GroupDef,
} from '@atrium/shared';
import { IconButton } from '@vibe/core';
import { Delete, DropdownChevronDown, DropdownChevronUp } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { PersonRow } from '../../columns/people';
import { getColumnUi } from '../../columns/registry';
import { useWorkspaceMembers } from '../../data/members-store';
import popups from '../../columns/popups.module.css';
import type { CellContext } from '../../columns/types';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import type { ColumnView } from './table-model';
import { isWritableByButton } from './button-actions';
import styles from './ButtonActionsEditor.module.css';

const ACTION_TYPES = Object.keys(BUTTON_ACTION_LABELS) as ButtonAction['type'][];
const ADD_DISABLED_REASON = `A button runs at most ${BUTTON_LIMITS.maxActions} actions`;

/** The column's own cell editor for a `set_value` action's value, plus "Clear the cell". */
function ValueField({
  column,
  value,
  onChange,
}: {
  column: ColumnView;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const env = useTableEnv();
  const ui = getColumnUi(column.def.type);
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!ui) return null;

  const ctx: CellContext = {
    highlight: '',
    rowDone: false,
    canEdit: true,
    boardId: env.boardId,
    getItems: env.getItems,
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
              saveSettings={(settings) =>
                void tableActions.updateColumn(env.ctx, column.def.id, {
                  settings: settings as Record<string, unknown>,
                })
              }
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
          saveSettings={(settings) =>
            void tableActions.updateColumn(env.ctx, column.def.id, {
              settings: settings as Record<string, unknown>,
            })
          }
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

function ActionRow({
  action,
  index,
  count,
  error,
  columns,
  groups,
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
  }
}

/** The ordered action list of a button column (up to five), edited in its settings popover. */
export function ButtonActionsEditor({
  actions,
  errors,
  columns,
  groups,
  onChange,
}: {
  actions: readonly ButtonAction[];
  errors: readonly (string | null)[];
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
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
              onChange={(next) => replace(index, next)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => onChange(actions.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      ) : (
        <p className={styles.helper}>No actions: a click is only recorded in the activity log.</p>
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
          {ACTION_TYPES.map((type) => (
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
