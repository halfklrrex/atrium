import {
  AUTOMATION_LIMITS,
  AUTOMATION_TRIGGER_LABELS,
  BUTTON_LIMITS,
  type AutomationCondition,
  type AutomationTrigger,
  type BoardRole,
  type ButtonAction,
  type ColumnDef,
} from '@atrium/shared';
import { Button, IconButton, TextField } from '@vibe/core';
import { CloseSmall } from '@vibe/icons';
import classNames from 'classnames';
import { useId, useMemo, useState } from 'react';
import { UNKNOWN_PERSON_NAME, useUserLookup, useWorkspaceMembers } from '../../data/members-store';
import { automationWrites, type AutomationDoc, type AutomationInput } from '../../data/automations';
import type { BoardDoc } from '../../data/model';
import { buildColumnViews } from '../board-table/table-model';
import { ButtonActionsEditor } from '../board-table/ButtonActionsEditor';
import { describeError } from '../boards/board-actions';
import { showToast } from '../toast-store';
import {
  TRIGGER_TYPES,
  checkDraft,
  conditionColumns,
  conditionOps,
  defaultTrigger,
  isDraftOk,
  needsValue,
  newCondition,
  triggerColumns,
} from './recipe-draft';
import { describeAutomation } from './describe-automation';
import styles from './RecipeBuilder.module.css';

export interface RecipeBuilderProps {
  board: BoardDoc;
  role: BoardRole | null;
  /** The signed-in board owner; saving makes them the person the recipe runs as. */
  uid: string;
  /** Recipes already on the board (the cap is checked against it for a new one). */
  existingCount: number;
  /** The recipe being edited, or `null` for a new one. */
  automation: AutomationDoc | null;
  /** A starter or other preset a new recipe begins from. */
  initial?: AutomationInput;
  onCancel: () => void;
  onSaved: () => void;
}

const EMPTY_INPUT: AutomationInput = {
  name: '',
  trigger: { type: 'item_created' },
  conditions: [],
  actions: [],
};

interface Label {
  index: number;
  id: string | number;
  label: string;
}

function labelsOf(column: ColumnDef | undefined): Label[] {
  const labels = (column?.settings as { labels?: Label[] } | undefined)?.labels;
  return Array.isArray(labels) ? labels : [];
}

/** A native select styled as a sentence token; `label` is its accessible name. */
function TokenSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      className={styles.token}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className={styles.problem}>
      {message}
    </p>
  ) : null;
}

function ColumnSelect({
  label,
  columns,
  value,
  onChange,
}: {
  label: string;
  columns: readonly ColumnDef[];
  value: string;
  onChange: (id: string) => void;
}) {
  const known = columns.some((c) => c.id === value);
  return (
    <TokenSelect label={label} value={known ? value : ''} onChange={onChange}>
      <option value="" disabled>
        {value && !known ? 'Deleted column' : 'Choose a column'}
      </option>
      {columns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </TokenSelect>
  );
}

/** "Anyone" or one workspace member (a person who has left stays selectable so it can be changed). */
function AssigneeSelect({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (uid: string) => void;
}) {
  const { members } = useWorkspaceMembers();
  const lookup = useUserLookup();
  const known = value === undefined || members.some((m) => m.id === value);
  return (
    <TokenSelect label="Assigned person" value={value ?? ''} onChange={onChange}>
      <option value="">anyone</option>
      {known ? null : <option value={value}>Former member</option>}
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {lookup(m.id)?.name ?? UNKNOWN_PERSON_NAME}
        </option>
      ))}
    </TokenSelect>
  );
}

/** The trigger part of the sentence, after "When". */
function TriggerFields({
  board,
  trigger,
  onChange,
}: {
  board: BoardDoc;
  trigger: AutomationTrigger;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  const hasStatus = triggerColumns(board, 'status').length > 0;
  const hasButton = triggerColumns(board, 'button').length > 0;
  const hasPeople = triggerColumns(board, 'people').length > 0;
  const fits = (type: AutomationTrigger['type']) => {
    if (type === 'status_changed') return hasStatus;
    if (type === 'button_clicked') return hasButton;
    if (type === 'person_assigned') return hasPeople;
    return true;
  };
  const missing: Partial<Record<AutomationTrigger['type'], string>> = {
    status_changed: ' (no Status column)',
    button_clicked: ' (no Button column)',
    person_assigned: ' (no People column)',
  };

  return (
    <>
      <TokenSelect
        label="When"
        value={trigger.type}
        onChange={(type) => onChange(defaultTrigger(type as AutomationTrigger['type'], board))}
      >
        {TRIGGER_TYPES.map((type) => (
          <option key={type} value={type} disabled={!fits(type) && type !== trigger.type}>
            {AUTOMATION_TRIGGER_LABELS[type]}
            {fits(type) ? '' : missing[type]}
          </option>
        ))}
      </TokenSelect>

      {trigger.type === 'item_created' || trigger.type === 'item_moved' ? (
        <>
          <span className={styles.word}>{trigger.type === 'item_moved' ? 'to' : 'in'}</span>
          <TokenSelect
            label={trigger.type === 'item_moved' ? 'Moved to group' : 'In group'}
            value={trigger.groupId ?? ''}
            onChange={(groupId) =>
              onChange(groupId ? { type: trigger.type, groupId } : { type: trigger.type })
            }
          >
            <option value="">any group</option>
            {trigger.groupId && !board.groups.some((g) => g.id === trigger.groupId) ? (
              <option value={trigger.groupId}>Deleted group</option>
            ) : null}
            {board.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </TokenSelect>
        </>
      ) : null}

      {trigger.type === 'status_changed' ? (
        <>
          <span className={styles.word}>on</span>
          <ColumnSelect
            label="Status column"
            columns={triggerColumns(board, 'status')}
            value={trigger.columnId}
            onChange={(columnId) => onChange({ type: 'status_changed', columnId })}
          />
          <span className={styles.word}>to</span>
          <TokenSelect
            label="Changes to"
            value={trigger.toLabelId ?? ''}
            onChange={(next) =>
              onChange({
                type: 'status_changed',
                columnId: trigger.columnId,
                ...(next === '' ? {} : { toLabelId: Number(next) }),
              })
            }
          >
            <option value="">any status</option>
            {labelsOf(board.columns.find((c) => c.id === trigger.columnId)).map((l) => (
              <option key={l.index} value={l.index}>
                {l.label}
              </option>
            ))}
          </TokenSelect>
        </>
      ) : null}

      {trigger.type === 'person_assigned' ? (
        <>
          <span className={styles.word}>in</span>
          <ColumnSelect
            label="People column"
            columns={triggerColumns(board, 'people')}
            value={trigger.columnId}
            onChange={(columnId) =>
              onChange({
                type: 'person_assigned',
                columnId,
                ...(trigger.uid === undefined ? {} : { uid: trigger.uid }),
              })
            }
          />
          <span className={styles.word}>is</span>
          <AssigneeSelect
            value={trigger.uid}
            onChange={(uid) =>
              onChange({
                type: 'person_assigned',
                columnId: trigger.columnId,
                ...(uid === '' ? {} : { uid }),
              })
            }
          />
        </>
      ) : null}

      {trigger.type === 'button_clicked' ? (
        <>
          <span className={styles.word}>in</span>
          <ColumnSelect
            label="Button column"
            columns={triggerColumns(board, 'button')}
            value={trigger.columnId}
            onChange={(columnId) => onChange({ type: 'button_clicked', columnId })}
          />
        </>
      ) : null}
    </>
  );
}

function ConditionValue({
  column,
  condition,
  onChange,
}: {
  column: ColumnDef;
  condition: AutomationCondition;
  onChange: (value: unknown) => void;
}) {
  const { value } = condition;
  if (column.type === 'status') {
    const current = (value as { index?: number } | undefined)?.index;
    return (
      <TokenSelect
        label="Value"
        value={current ?? ''}
        onChange={(next) => onChange(next === '' ? undefined : { index: Number(next) })}
      >
        <option value="" disabled>
          Choose a label
        </option>
        {labelsOf(column).map((l) => (
          <option key={l.index} value={l.index}>
            {l.label}
          </option>
        ))}
      </TokenSelect>
    );
  }
  if (column.type === 'dropdown') {
    const current = (value as { ids?: number[] } | undefined)?.ids?.[0];
    return (
      <TokenSelect
        label="Value"
        value={current ?? ''}
        onChange={(next) => onChange(next === '' ? undefined : { ids: [Number(next)] })}
      >
        <option value="" disabled>
          Choose an option
        </option>
        {labelsOf(column).map((l) => (
          <option key={String(l.id)} value={l.id}>
            {l.label}
          </option>
        ))}
      </TokenSelect>
    );
  }
  if (column.type === 'numbers') {
    const current = typeof value === 'number' ? String(value) : '';
    return (
      <input
        className={styles.tokenInput}
        aria-label="Value"
        type="number"
        value={current}
        onChange={(event) => {
          const parsed = event.target.valueAsNumber;
          onChange(event.target.value === '' || !Number.isFinite(parsed) ? undefined : parsed);
        }}
      />
    );
  }
  // text and long text
  const text =
    column.type === 'long_text'
      ? ((value as { text?: string } | undefined)?.text ?? '')
      : typeof value === 'string'
        ? value
        : '';
  return (
    <input
      className={styles.tokenInput}
      aria-label="Value"
      placeholder="a value"
      value={text}
      maxLength={1000}
      onChange={(event) => {
        const next = event.target.value;
        if (next === '') onChange(undefined);
        else onChange(column.type === 'long_text' ? { text: next } : next);
      }}
    />
  );
}

function ConditionRow({
  index,
  condition,
  board,
  problem,
  onChange,
  onRemove,
}: {
  index: number;
  condition: AutomationCondition;
  board: BoardDoc;
  problem: string | null;
  onChange: (condition: AutomationCondition) => void;
  onRemove: () => void;
}) {
  const columns = conditionColumns(board);
  const column = board.columns.find((c) => c.id === condition.columnId);
  const ops = column ? conditionOps(column.type) : [];
  return (
    <li role="group" aria-label={`Condition ${index + 1}`} className={styles.item}>
      <div className={styles.line}>
        <span className={styles.keyword}>and only if</span>
        <ColumnSelect
          label="Column"
          columns={columns}
          value={condition.columnId}
          onChange={(columnId) => onChange(newCondition(columns.find((c) => c.id === columnId)))}
        />
        {column ? (
          <TokenSelect
            label="Operator"
            value={condition.op}
            onChange={(next) => {
              const op = next as AutomationCondition['op'];
              onChange({
                columnId: condition.columnId,
                op,
                ...(needsValue(op) && condition.value !== undefined
                  ? { value: condition.value }
                  : {}),
              });
            }}
          >
            {ops.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </TokenSelect>
        ) : null}
        {column && needsValue(condition.op) ? (
          <ConditionValue
            column={column}
            condition={condition}
            onChange={(value) =>
              onChange({
                columnId: condition.columnId,
                op: condition.op,
                ...(value === undefined ? {} : { value }),
              })
            }
          />
        ) : null}
        <IconButton
          icon={CloseSmall}
          kind="tertiary"
          size="xxs"
          aria-label={`Remove condition ${index + 1}`}
          onClick={onRemove}
        />
      </div>
      <Problem message={problem} />
    </li>
  );
}

/**
 * The recipe builder as one sentence: "When [trigger], and only if [condition], then [action]".
 * Each part is an inline picker. Save stays disabled until the draft would pass
 * `validateAutomation`; the first failure shows next to the part it is about. Rendered inside the
 * Automation center's shell.
 */
export function RecipeBuilder({
  board,
  role,
  uid,
  existingCount,
  automation,
  initial,
  onCancel,
  onSaved,
}: RecipeBuilderProps) {
  const start = automation
    ? {
        name: automation.name,
        trigger: automation.trigger,
        conditions: automation.conditions,
        actions: automation.actions,
      }
    : (initial ?? EMPTY_INPUT);
  const [name, setName] = useState(start.name);
  const [trigger, setTrigger] = useState<AutomationTrigger>(start.trigger);
  const [conditions, setConditions] = useState<AutomationCondition[]>(start.conditions);
  const [actions, setActions] = useState<ButtonAction[]>(start.actions);
  const [saving, setSaving] = useState(false);
  const noteId = useId();

  const columnViews = useMemo(() => buildColumnViews(board.columns), [board.columns]);
  const problems = useMemo(
    () =>
      checkDraft({ trigger, conditions, actions }, board, role, automation ? null : existingCount),
    [trigger, conditions, actions, board, role, automation, existingCount],
  );
  const canSave = isDraftOk(problems, actions.length) && !saving;
  const takesOver = automation !== null && automation.runAs !== uid;
  const eligible = conditionColumns(board);
  const atConditionCap = conditions.length >= AUTOMATION_LIMITS.maxConditions;
  const reads = isDraftOk(problems, actions.length)
    ? describeAutomation({ trigger, conditions, actions }, board)
    : 'Fill in the highlighted parts to finish the sentence.';

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const input: AutomationInput = { name: name.trim(), trigger, conditions, actions };
    const ctx = { boardId: board.id, uid, board, role };
    try {
      if (automation) await automationWrites.update(ctx, automation.id, input);
      else await automationWrites.create(ctx, input, existingCount);
      showToast(automation ? 'Automation saved.' : 'Automation created.', { type: 'positive' });
      onSaved();
    } catch (error) {
      console.error('Could not save the automation.', error);
      showToast(
        error instanceof Error && !(error as { code?: string }).code
          ? error.message
          : describeError(error, 'Could not save the automation.'),
        { type: 'negative' },
      );
      setSaving(false);
    }
  };

  return (
    <form
      className={styles.builder}
      aria-label={automation ? 'Edit automation' : 'New automation'}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.sentence}>
        <section className={styles.part} aria-label="Trigger">
          <div className={styles.line}>
            <span className={classNames(styles.keyword, styles.keywordStrong)}>When</span>
            <TriggerFields board={board} trigger={trigger} onChange={setTrigger} />
          </div>
          <Problem message={problems.trigger} />
        </section>

        <section className={styles.part} aria-label="Conditions">
          {conditions.length > 0 ? (
            <ol className={styles.list} aria-label="Conditions">
              {conditions.map((condition, i) => (
                <ConditionRow
                  key={i}
                  index={i}
                  condition={condition}
                  board={board}
                  problem={problems.conditions[i] ?? null}
                  onChange={(next) => setConditions(conditions.map((c, j) => (j === i ? next : c)))}
                  onRemove={() => setConditions(conditions.filter((_, j) => j !== i))}
                />
              ))}
            </ol>
          ) : (
            <p className={styles.hint}>Every {board.itemTerminology} that matches the trigger.</p>
          )}
          <div className={styles.addRow}>
            <Button
              kind="tertiary"
              size="small"
              disabled={atConditionCap || eligible.length === 0}
              onClick={() => setConditions([...conditions, newCondition(eligible[0])])}
            >
              + Add condition
            </Button>
            <span className={styles.count}>
              {conditions.length}/{AUTOMATION_LIMITS.maxConditions}
            </span>
            {atConditionCap ? (
              <span className={styles.count}>
                {`At most ${AUTOMATION_LIMITS.maxConditions} conditions.`}
              </span>
            ) : null}
            {eligible.length === 0 ? (
              <span className={styles.count}>No column here can be used in a condition.</span>
            ) : null}
          </div>
        </section>

        <section className={styles.part} aria-label="Actions">
          <div className={styles.line}>
            <span className={classNames(styles.keyword, styles.keywordStrong)}>then</span>
            <span className={styles.count}>
              {actions.length}/{BUTTON_LIMITS.maxActions} actions
            </span>
          </div>
          <div className={styles.actions}>
            <ButtonActionsEditor
              actions={actions}
              errors={problems.actions}
              columns={columnViews}
              groups={board.groups}
              boardId={board.id}
              allowAutomationOnly
              emptyHint="Add at least one action: what should happen."
              onChange={setActions}
            />
          </div>
          <Problem message={problems.general} />
        </section>
      </div>

      <p className={styles.reads} aria-live="polite">
        <span className={styles.readsLabel}>Reads as</span> {reads}
      </p>

      {takesOver ? (
        <p id={noteId} className={styles.note} role="note">
          Saving makes you the person this runs as.
        </p>
      ) : null}

      <div className={styles.footer}>
        <div className={styles.nameField}>
          <TextField
            id="recipe-name"
            title="Name (optional)"
            inputAriaLabel="Name"
            value={name}
            onChange={(value: string) => setName(value)}
            maxLength={AUTOMATION_LIMITS.name}
            placeholder="Shown instead of the sentence"
            size="medium"
          />
        </div>
        <Button kind="tertiary" size="medium" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          kind="primary"
          size="medium"
          type="submit"
          disabled={!canSave}
          loading={saving}
          aria-describedby={takesOver ? noteId : undefined}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
