import {
  BUTTON_ACTION_LABELS,
  BUTTON_LIMITS,
  columnRegistry,
  type ButtonAction,
  type GroupDef,
} from '@atrium/shared';
import { Button, IconButton } from '@vibe/core';
import { Add, CloseSmall } from '@vibe/icons';
import classNames from 'classnames';
import { useContext, useState } from 'react';
import { getColumnUi } from '../../columns/registry';
import type { CellContext } from '../../columns/types';
import { UNKNOWN_PERSON_NAME, useUserLookup, useWorkspaceMembers } from '../../data/members-store';
import { isWritableByButton } from '../board-table/button-actions';
import { TableEnvContext } from '../board-table/table-env';
import type { ColumnView } from '../board-table/table-model';
import { newAction } from './new-action';
import {
  SentenceMultiToken,
  SentenceProblem,
  SentenceToken,
  TokenInput,
  type TokenOption,
} from './SentenceToken';
import tokens from './SentenceToken.module.css';
import styles from './ActionLine.module.css';

/** How each action type reads in the list of choices. */
const TYPE_OPTION: Record<ButtonAction['type'], string> = {
  set_value: 'set a value',
  rename_item: 'rename the item',
  move_to_group: 'move the item',
  archive_item: 'archive the item',
  notify: 'notify someone',
  create_item: 'create an item',
  post_update: 'post an update',
};

/** How the chosen type reads in the sentence, before its own blanks. */
const TYPE_TOKEN: Record<ButtonAction['type'], string> = {
  set_value: 'set',
  rename_item: 'rename the item',
  move_to_group: 'move the item',
  archive_item: 'archive the item',
  notify: 'notify',
  create_item: 'create an item',
  post_update: 'post an update',
};

const ACTION_ORDER = Object.keys(BUTTON_ACTION_LABELS) as ButtonAction['type'][];

/** "Avery Quinn", "Avery Quinn and Sam Rivera", "Avery Quinn, Sam Rivera and Kit Lane". */
const joinNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** The value a `set_value` action (or a created item's column) writes, edited with the column's own editor. */
function ValueToken({
  column,
  value,
  boardId,
  label,
  onChange,
}: {
  column: ColumnView;
  value: unknown;
  boardId: string;
  label: string;
  onChange: (value: unknown) => void;
}) {
  // Inside the board table the env is there; the Automation center renders outside it.
  const env = useContext(TableEnvContext);
  const ui = getColumnUi(column.def.type);
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!ui) return null;

  const ctx: CellContext = {
    highlight: '',
    rowDone: false,
    canEdit: true,
    boardId: env?.boardId ?? boardId,
    getItems: env?.getItems ?? (() => []),
  };
  const cleared = value === null;
  const current = value === undefined || value === null ? null : value;
  const Editor = ui.Editor;
  let text = 'a value';
  if (cleared) text = 'empty';
  else if (current !== null) {
    try {
      text = columnRegistry.toText(column.def.type, current, column.settings) || 'a value';
    } catch {
      text = 'a value';
    }
  }
  const filled = value !== undefined;
  const open = () => {
    if (ui.editor === 'toggle' && ui.toggle) onChange(ui.toggle(current));
    else setEditing(true);
  };
  const common = {
    value: current,
    settings: column.settings,
    column: column.def,
    ctx,
    anchor,
    onChange,
    onClose: () => setEditing(false),
    // The center cannot change column settings (labels are edited on the board).
    saveSettings: () => undefined,
  };

  return (
    <span className={styles.value}>
      <span ref={setAnchor} className={tokens.wrap}>
        {editing && ui.editor === 'inline' && Editor ? (
          <span className={styles.inlineEditor}>
            <Editor {...common} />
          </span>
        ) : (
          <button
            type="button"
            className={filled ? tokens.token : tokens.blank}
            aria-label={`${label}: ${text}`}
            aria-haspopup="dialog"
            data-blank={filled ? undefined : ''}
            disabled={cleared}
            onClick={open}
          >
            {text}
          </button>
        )}
      </span>
      {editing && ui.editor === 'popover' && Editor ? <Editor {...common} /> : null}
      <label className={styles.clear}>
        <input
          type="checkbox"
          checked={cleared}
          onChange={(event) => onChange(event.target.checked ? null : undefined)}
        />
        <span>clear the cell</span>
      </label>
    </span>
  );
}

function usePeopleOptions(selected: readonly string[]): TokenOption[] {
  const { members } = useWorkspaceMembers();
  const lookup = useUserLookup();
  const known = new Set(members.map((m) => m.id));
  return [
    ...members.map((m) => ({
      value: m.id,
      label: lookup(m.id)?.name ?? UNKNOWN_PERSON_NAME,
      uid: m.id,
    })),
    // Someone already chosen who has since left stays listed so they can be removed.
    ...selected
      .filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: lookup(id)?.name ?? 'Former member', uid: id })),
  ];
}

function NotifyTokens({
  action,
  onChange,
}: {
  action: Extract<ButtonAction, { type: 'notify' }>;
  onChange: (action: ButtonAction) => void;
}) {
  const options = usePeopleOptions(action.uids);
  const names = action.uids.map((id) => options.find((o) => o.value === id)?.label ?? 'Someone');
  const set = (uids: string[], message = action.message) =>
    onChange({ type: 'notify', uids, ...(message ? { message } : {}) });
  return (
    <>
      <SentenceMultiToken
        label="People to notify"
        placeholder="someone"
        values={action.uids}
        options={options}
        max={BUTTON_LIMITS.maxNotifyUids}
        display={joinNames(names)}
        onChange={(uids) => set(uids)}
      />
      <span className={styles.word}>with</span>
      <TokenInput
        label="Message"
        placeholder="a message (optional)"
        value={action.message ?? ''}
        maxLength={BUTTON_LIMITS.maxNotifyMessage}
        size="wide"
        onChange={(message) => set(action.uids, message)}
      />
    </>
  );
}

const groupOptions = (groups: readonly GroupDef[]): TokenOption[] =>
  groups.map((g) => ({ value: g.id, label: g.title, dot: g.color }));

function CreateItemTokens({
  action,
  columns,
  groups,
  boardId,
  onChange,
}: {
  action: Extract<ButtonAction, { type: 'create_item' }>;
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  boardId: string;
  onChange: (action: ButtonAction) => void;
}) {
  const writable = columns.filter(isWritableByButton);
  const values = action.values ?? {};
  const entries = Object.entries(values);
  const free = writable.filter((c) => !(c.def.id in values));
  const setValues = (next: Record<string, unknown>) => {
    const { values: _old, ...rest } = action;
    onChange(Object.keys(next).length > 0 ? { ...rest, values: next } : rest);
  };
  const groupKnown = action.groupId === undefined || groups.some((g) => g.id === action.groupId);
  return (
    <>
      <TokenInput
        label="Item name"
        placeholder="a name"
        value={action.name}
        maxLength={BUTTON_LIMITS.maxCreateName}
        title="Use {name} for the current name and {date} for today (YYYY-MM-DD)."
        onChange={(name) => onChange({ ...action, name })}
      />
      <span className={styles.word}>in</span>
      <SentenceToken
        label="In group"
        placeholder="the default group"
        value={action.groupId ?? ''}
        display={groupKnown ? undefined : 'a deleted group'}
        options={[{ value: '', label: 'the default group' }, ...groupOptions(groups)]}
        onChange={(groupId) => {
          const { groupId: _old, ...rest } = action;
          onChange(groupId ? { ...rest, groupId } : rest);
        }}
      />
      {entries.length > 0 || free.length > 0 ? (
        <span className={styles.subLines}>
          {entries.map(([columnId, value], i) => {
            const target = columns.find((c) => c.def.id === columnId);
            return (
              <span
                key={columnId}
                role="group"
                aria-label={`Value ${i + 1}`}
                className={styles.sub}
              >
                <span className={styles.word}>with</span>
                <SentenceToken
                  label="Value column"
                  placeholder="a column"
                  value={target ? columnId : null}
                  display={target ? undefined : 'a deleted column'}
                  options={[
                    ...(target ? [{ value: columnId, label: target.def.title }] : []),
                    ...free.map((c) => ({ value: c.def.id, label: c.def.title })),
                  ]}
                  onChange={(next) =>
                    setValues(
                      Object.fromEntries(
                        entries.map(([k, v]) => (k === columnId ? [next, undefined] : [k, v])),
                      ),
                    )
                  }
                />
                <span className={styles.word}>set to</span>
                {target ? (
                  <ValueToken
                    key={columnId}
                    column={target}
                    value={value}
                    boardId={boardId}
                    label={`Value for ${target.def.title}`}
                    onChange={(next) => setValues({ ...values, [columnId]: next })}
                  />
                ) : null}
                <IconButton
                  icon={CloseSmall}
                  kind="tertiary"
                  size="small"
                  aria-label={`Remove value ${i + 1}`}
                  onClick={() =>
                    setValues(Object.fromEntries(entries.filter(([k]) => k !== columnId)))
                  }
                />
              </span>
            );
          })}
          <Button
            kind="tertiary"
            size="small"
            leftIcon={Add}
            disabled={entries.length >= BUTTON_LIMITS.maxCreateValues || free.length === 0}
            onClick={() => setValues({ ...values, [free[0]!.def.id]: undefined })}
          >
            Add a value
          </Button>
          <span className={styles.count}>
            ({entries.length}/{BUTTON_LIMITS.maxCreateValues})
          </span>
        </span>
      ) : null}
    </>
  );
}

export interface ActionLineProps {
  /** `null` is a blank action: "do something". */
  action: ButtonAction | null;
  index: number;
  /** "then" for the first action, "and" for the rest. */
  keyword: string;
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  boardId: string;
  /** Narrows the list of choices (a recurring recipe has no item to act on). */
  allowedTypes?: readonly ButtonAction['type'][];
  /** The first failure of this action, or `null` (also while it still has blanks). */
  error: string | null;
  canRemove: boolean;
  onChange: (action: ButtonAction) => void;
  onRemove: () => void;
}

/**
 * One action as a line of the sentence: "then [move the item] to [a group]". Each blank is an
 * inline token; later actions start with "and". Built on `SentenceToken`, and does not use the
 * button column's action editor.
 */
export function ActionLine({
  action,
  index,
  keyword,
  columns,
  groups,
  boardId,
  allowedTypes,
  error,
  canRemove,
  onChange,
  onRemove,
}: ActionLineProps) {
  const writable = columns.filter(isWritableByButton);
  const target =
    action?.type === 'set_value' ? columns.find((c) => c.def.id === action.columnId) : undefined;
  const typeOptions: TokenOption[] = [
    ...ACTION_ORDER.filter((type) => !allowedTypes || allowedTypes.includes(type)).map((type) => ({
      value: type,
      label: TYPE_OPTION[type],
    })),
    { value: 'send_email', label: 'send an email', disabled: true, badge: 'Planned' },
  ];

  return (
    <li
      role="group"
      aria-label={
        action ? `Action ${index + 1}: ${BUTTON_ACTION_LABELS[action.type]}` : `Action ${index + 1}`
      }
      className={classNames(styles.item)}
    >
      <div className={styles.line}>
        <span className={classNames(styles.keyword, index === 0 && styles.keywordStrong)}>
          {keyword}
        </span>
        <SentenceToken
          label="Action"
          placeholder="do something"
          value={action ? action.type : null}
          display={action ? TYPE_TOKEN[action.type] : undefined}
          options={typeOptions}
          onChange={(type) => onChange(newAction(type as ButtonAction['type']))}
        />

        {action?.type === 'set_value' ? (
          <>
            <SentenceToken
              label="Column to set"
              placeholder="a column"
              value={target ? action.columnId : null}
              display={action.columnId && !target ? 'a deleted column' : undefined}
              options={writable.map((c) => ({ value: c.def.id, label: c.def.title }))}
              onChange={(columnId) => onChange({ type: 'set_value', columnId, value: undefined })}
            />
            <span className={styles.word}>to</span>
            {target ? (
              <ValueToken
                key={target.def.id}
                column={target}
                value={action.value}
                boardId={boardId}
                label={`Value for ${target.def.title}`}
                onChange={(value) => onChange({ ...action, value })}
              />
            ) : (
              <span className={styles.word}>a value</span>
            )}
          </>
        ) : null}

        {action?.type === 'rename_item' ? (
          <>
            <span className={styles.word}>to</span>
            <TokenInput
              label="New name"
              placeholder="e.g. {date} {name}"
              value={action.template}
              maxLength={200}
              title="Use {name} for the current name and {date} for today (YYYY-MM-DD)."
              onChange={(template) => onChange({ type: 'rename_item', template })}
            />
          </>
        ) : null}

        {action?.type === 'move_to_group' ? (
          <>
            <span className={styles.word}>to</span>
            <SentenceToken
              label="Group"
              placeholder="a group"
              value={action.groupId === '' ? null : action.groupId}
              display={
                action.groupId && !groups.some((g) => g.id === action.groupId)
                  ? 'a deleted group'
                  : undefined
              }
              options={groupOptions(groups)}
              onChange={(groupId) => onChange({ type: 'move_to_group', groupId })}
            />
          </>
        ) : null}

        {action?.type === 'notify' ? <NotifyTokens action={action} onChange={onChange} /> : null}

        {action?.type === 'create_item' ? (
          <CreateItemTokens
            action={action}
            columns={columns}
            groups={groups}
            boardId={boardId}
            onChange={onChange}
          />
        ) : null}

        {action?.type === 'post_update' ? (
          <TokenInput
            label="Update text"
            placeholder="the update text"
            value={action.text}
            maxLength={BUTTON_LIMITS.maxUpdateText}
            size="wide"
            title="Posted as Automations. Use {name} and {date} like in a rename."
            onChange={(text) => onChange({ type: 'post_update', text })}
          />
        ) : null}

        {canRemove ? (
          <IconButton
            icon={CloseSmall}
            kind="tertiary"
            size="small"
            aria-label={`Remove action ${index + 1}`}
            onClick={onRemove}
          />
        ) : null}
      </div>
      <SentenceProblem message={error} />
    </li>
  );
}
