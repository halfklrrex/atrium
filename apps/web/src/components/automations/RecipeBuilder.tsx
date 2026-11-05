import {
  AUTOMATION_LIMITS,
  AUTOMATION_TRIGGER_LABELS,
  type AutomationCondition,
  type AutomationTrigger,
  type BoardRole,
  type ButtonAction,
  type ColumnDef,
} from '@atrium/shared';
import { Button, TextField } from '@vibe/core';
import { useId, useMemo, useState } from 'react';
import { automationWrites, type AutomationDoc, type AutomationInput } from '../../data/automations';
import popups from '../../columns/popups.module.css';
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={popups.field} htmlFor={htmlFor}>
      <span className={popups.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className={popups.error}>
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
    <Field label={label}>
      <select
        className={popups.input}
        value={known ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          {value && !known ? 'Deleted column' : 'Choose a column'}
        </option>
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </Field>
  );
}

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
  const fits = (type: AutomationTrigger['type']) =>
    type === 'item_created' || (type === 'status_changed' ? hasStatus : hasButton);

  return (
    <>
      <Field label="When">
        <select
          className={popups.input}
          value={trigger.type}
          onChange={(event) =>
            onChange(defaultTrigger(event.target.value as AutomationTrigger['type'], board))
          }
        >
          {TRIGGER_TYPES.map((type) => (
            <option key={type} value={type} disabled={!fits(type) && type !== trigger.type}>
              {AUTOMATION_TRIGGER_LABELS[type]}
              {fits(type)
                ? ''
                : type === 'status_changed'
                  ? ' (no Status column)'
                  : ' (no Button column)'}
            </option>
          ))}
        </select>
      </Field>

      {trigger.type === 'item_created' ? (
        <Field label="In group">
          <select
            className={popups.input}
            value={trigger.groupId ?? ''}
            onChange={(event) =>
              onChange(
                event.target.value
                  ? { type: 'item_created', groupId: event.target.value }
                  : { type: 'item_created' },
              )
            }
          >
            <option value="">Any group</option>
            {trigger.groupId && !board.groups.some((g) => g.id === trigger.groupId) ? (
              <option value={trigger.groupId}>Deleted group</option>
            ) : null}
            {board.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {trigger.type === 'status_changed' ? (
        <>
          <ColumnSelect
            label="Status column"
            columns={triggerColumns(board, 'status')}
            value={trigger.columnId}
            onChange={(columnId) => onChange({ type: 'status_changed', columnId })}
          />
          <Field label="Changes to">
            <select
              className={popups.input}
              value={trigger.toLabelId ?? ''}
              onChange={(event) =>
                onChange({
                  type: 'status_changed',
                  columnId: trigger.columnId,
                  ...(event.target.value === '' ? {} : { toLabelId: Number(event.target.value) }),
                })
              }
            >
              <option value="">Any status</option>
              {labelsOf(board.columns.find((c) => c.id === trigger.columnId)).map((l) => (
                <option key={l.index} value={l.index}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      {trigger.type === 'button_clicked' ? (
        <ColumnSelect
          label="Button column"
          columns={triggerColumns(board, 'button')}
          value={trigger.columnId}
          onChange={(columnId) => onChange({ type: 'button_clicked', columnId })}
        />
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
      <Field label="Value">
        <select
          className={popups.input}
          value={current ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : { index: Number(event.target.value) })
          }
        >
          <option value="" disabled>
            Choose a label
          </option>
          {labelsOf(column).map((l) => (
            <option key={l.index} value={l.index}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (column.type === 'dropdown') {
    const current = (value as { ids?: number[] } | undefined)?.ids?.[0];
    return (
      <Field label="Value">
        <select
          className={popups.input}
          value={current ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : { ids: [Number(event.target.value)] })
          }
        >
          <option value="" disabled>
            Choose an option
          </option>
          {labelsOf(column).map((l) => (
            <option key={String(l.id)} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (column.type === 'numbers') {
    const current = typeof value === 'number' ? String(value) : '';
    return (
      <Field label="Value">
        <input
          className={popups.input}
          type="number"
          value={current}
          onChange={(event) => {
            const parsed = event.target.valueAsNumber;
            onChange(event.target.value === '' || !Number.isFinite(parsed) ? undefined : parsed);
          }}
        />
      </Field>
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
    <Field label="Value">
      <input
        className={popups.input}
        value={text}
        maxLength={1000}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '') onChange(undefined);
          else onChange(column.type === 'long_text' ? { text: next } : next);
        }}
      />
    </Field>
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
    <li role="group" aria-label={`Condition ${index + 1}`} className={styles.condition}>
      <div className={styles.conditionFields}>
        <ColumnSelect
          label="Column"
          columns={columns}
          value={condition.columnId}
          onChange={(columnId) => onChange(newCondition(columns.find((c) => c.id === columnId)))}
        />
        {column ? (
          <Field label="Operator">
            <select
              className={popups.input}
              value={condition.op}
              onChange={(event) => {
                const op = event.target.value as AutomationCondition['op'];
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
            </select>
          </Field>
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
        <Button
          kind="tertiary"
          size="small"
          onClick={onRemove}
          aria-label={`Remove condition ${index + 1}`}
        >
          Remove
        </Button>
      </div>
      <Problem message={problem} />
    </li>
  );
}

/**
 * The recipe builder: "When [trigger] [params], and [conditions], then [actions]". Save stays
 * disabled until the draft would pass `validateAutomation`; the first failure shows next to the
 * part it is about. Rendered inside the Automation center's dialog.
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
      <TextField
        id="recipe-name"
        title="Name (optional)"
        inputAriaLabel="Name"
        value={name}
        onChange={(value: string) => setName(value)}
        maxLength={AUTOMATION_LIMITS.name}
        placeholder="Shown instead of the sentence"
        size="medium"
        autoFocus
      />

      <section className={styles.part} aria-label="Trigger">
        <TriggerFields board={board} trigger={trigger} onChange={setTrigger} />
        <Problem message={problems.trigger} />
      </section>

      <section className={styles.part} aria-label="Conditions">
        <span className={popups.fieldLabel}>Only if</span>
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
          <p className={popups.muted}>Every {board.itemTerminology} that matches the trigger.</p>
        )}
        <div>
          <Button
            kind="tertiary"
            size="small"
            disabled={atConditionCap || eligible.length === 0}
            onClick={() => setConditions([...conditions, newCondition(eligible[0])])}
          >
            + Add condition
          </Button>
          {atConditionCap ? (
            <span className={popups.muted}>
              {` At most ${AUTOMATION_LIMITS.maxConditions} conditions.`}
            </span>
          ) : null}
          {eligible.length === 0 ? (
            <span className={popups.muted}> No column here can be used in a condition.</span>
          ) : null}
        </div>
      </section>

      <section className={styles.part} aria-label="Actions">
        <ButtonActionsEditor
          actions={actions}
          errors={problems.actions}
          columns={columnViews}
          groups={board.groups}
          boardId={board.id}
          emptyHint="Add at least one action: what should happen."
          onChange={setActions}
        />
        <Problem message={problems.general} />
      </section>

      {takesOver ? (
        <p id={noteId} className={styles.note} role="note">
          Saving makes you the person this runs as.
        </p>
      ) : null}

      <div className={styles.footer}>
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
