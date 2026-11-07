import {
  AUTOMATION_LIMITS,
  BUTTON_LIMITS,
  isScheduledTrigger,
  type AutomationCondition,
  type AutomationTrigger,
  type BoardRole,
  type ButtonAction,
  type ColumnDef,
} from '@atrium/shared';
import { Button, IconButton, TextField } from '@vibe/core';
import { Add, Check, CloseSmall } from '@vibe/icons';
import { useId, useMemo, useState } from 'react';
import { UNKNOWN_PERSON_NAME, useUserLookup, useWorkspaceMembers } from '../../data/members-store';
import { useUserTimezone } from '../../data/user-timezone';
import { automationWrites, type AutomationDoc, type AutomationInput } from '../../data/automations';
import type { BoardDoc } from '../../data/model';
import { buildColumnViews } from '../board-table/table-model';
import { describeError } from '../boards/board-actions';
import { showToast } from '../toast-store';
import { ActionLine } from './ActionLine';
import {
  RECURRING_ACTION_TYPES,
  TRIGGER_TYPES,
  WEEKDAY_NAMES,
  checkBlankableDraft,
  conditionColumns,
  conditionOps,
  defaultTrigger,
  isDraftOk,
  needsValue,
  newCondition,
  resolveRecipeTimezone,
  triggerColumns,
} from './recipe-draft';
import { describeAutomationParts, type DescribePart } from './describe-automation';
import { SentenceProblem, SentenceToken, TokenInput, type TokenOption } from './SentenceToken';
import styles from './RecipeBuilder.module.css';

export interface RecipeBuilderProps {
  board: BoardDoc;
  role: BoardRole | null;
  /** The signed-in board owner; saving makes them the person the recipe runs as. */
  uid: string;
  /** Recipes already on the board (the cap is checked against it for a new one). */
  existingCount: number;
  /** The board's recipes, for the cap on scheduled ones; the one being edited is left out. */
  existing?: readonly AutomationDoc[];
  /** The recipe being edited, or `null` for a new one. */
  automation: AutomationDoc | null;
  /** A starter or other preset a new recipe begins from. */
  initial?: AutomationInput;
  onCancel: () => void;
  /** Called after a save, with the id of the created or edited recipe. */
  onSaved: (automationId: string) => void;
}

interface Label {
  index: number;
  id: string | number;
  label: string;
  color?: string;
}

function labelsOf(column: ColumnDef | undefined): Label[] {
  const labels = (column?.settings as { labels?: Label[] } | undefined)?.labels;
  return Array.isArray(labels) ? labels : [];
}

/** The status or dropdown labels of a column as list rows, each a chip in the label's own colour. */
function labelOptions(column: ColumnDef | undefined, key: 'index' | 'id'): TokenOption[] {
  return labelsOf(column)
    .filter((l) => l.label !== '')
    .map((l) => ({ value: String(l[key]), label: l.label, chip: l.color }));
}

/** How each trigger reads in the list of choices. */
const TRIGGER_PHRASE: Record<AutomationTrigger['type'], string> = {
  item_created: 'an item is created',
  item_moved: 'an item is moved to a group',
  person_assigned: 'a person is assigned',
  status_changed: 'a status changes',
  button_clicked: 'a button is clicked',
  date_arrives: 'a date arrives',
  recurring: 'every day, week or month',
};

const MISSING_COLUMN: Partial<Record<AutomationTrigger['type'], string>> = {
  status_changed: '(no Status column)',
  button_clicked: '(no Button column)',
  person_assigned: '(no People column)',
  date_arrives: '(no Date column)',
};

/** A column as a token: blank while none is chosen, "a deleted column" when it is gone. */
function ColumnToken({
  label,
  columns,
  value,
  placeholder = 'a column',
  onChange,
}: {
  label: string;
  columns: readonly ColumnDef[];
  value: string;
  placeholder?: string;
  onChange: (id: string) => void;
}) {
  const known = columns.some((c) => c.id === value);
  return (
    <SentenceToken
      label={label}
      placeholder={placeholder}
      value={value === '' ? null : value}
      display={value !== '' && !known ? 'a deleted column' : undefined}
      options={columns.map((c) => ({ value: c.id, label: c.title }))}
      emptyText="No matching column on this board"
      onChange={onChange}
    />
  );
}

/** "Anyone" or one workspace member (a person who has left stays selectable so it can be changed). */
function AssigneeToken({
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
    <SentenceToken
      label="Assigned person"
      placeholder="anyone"
      value={value ?? ''}
      display={value === undefined ? 'anyone' : known ? undefined : 'a former member'}
      options={[
        { value: '', label: 'anyone' },
        ...members.map((m) => ({
          value: m.id,
          label: lookup(m.id)?.name ?? UNKNOWN_PERSON_NAME,
          uid: m.id,
        })),
      ]}
      onChange={onChange}
    />
  );
}

/** The trigger part of the sentence, after "When". */
function TriggerLine({
  board,
  trigger,
  timezone,
  onChange,
}: {
  board: BoardDoc;
  trigger: AutomationTrigger | null;
  /** The zone a scheduled recipe will be saved with, shown next to its time. */
  timezone: string;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  const fits = (type: AutomationTrigger['type']) => {
    if (type === 'status_changed') return triggerColumns(board, 'status').length > 0;
    if (type === 'button_clicked') return triggerColumns(board, 'button').length > 0;
    if (type === 'person_assigned') return triggerColumns(board, 'people').length > 0;
    if (type === 'date_arrives') return triggerColumns(board, 'date').length > 0;
    return true;
  };
  const typeOptions: TokenOption[] = TRIGGER_TYPES.map((type) => ({
    value: type,
    label: TRIGGER_PHRASE[type],
    disabled: !fits(type) && type !== trigger?.type,
    hint: fits(type) ? undefined : MISSING_COLUMN[type],
  }));
  const pickType = (type: string) =>
    onChange(defaultTrigger(type as AutomationTrigger['type'], board));
  // The type list is a token for a blank trigger and "an item is created / moved"; the other
  // triggers read as their own phrase and offer "Change trigger" instead.
  const changeTrigger = (
    <SentenceToken
      variant="link"
      label="Change trigger"
      placeholder="Change trigger"
      display="Change trigger"
      value={trigger?.type ?? null}
      options={typeOptions}
      onChange={pickType}
    />
  );

  if (trigger === null) {
    return (
      <SentenceToken
        label="Trigger"
        placeholder="something happens"
        value={null}
        options={typeOptions}
        onChange={pickType}
      />
    );
  }

  if (trigger.type === 'item_created' || trigger.type === 'item_moved') {
    const missing = trigger.groupId && !board.groups.some((g) => g.id === trigger.groupId);
    return (
      <>
        <SentenceToken
          label="Trigger"
          placeholder="something happens"
          value={trigger.type}
          display={TRIGGER_PHRASE[trigger.type].replace(' to a group', '')}
          options={typeOptions}
          onChange={pickType}
        />
        <span className={styles.word}>{trigger.type === 'item_moved' ? 'to' : 'in'}</span>
        <SentenceToken
          label={trigger.type === 'item_moved' ? 'Moved to group' : 'In group'}
          placeholder="any group"
          value={trigger.groupId ?? ''}
          display={missing ? 'a deleted group' : undefined}
          options={[
            { value: '', label: 'any group' },
            ...board.groups.map((g) => ({ value: g.id, label: g.title, dot: g.color })),
          ]}
          onChange={(groupId) =>
            onChange(groupId ? { type: trigger.type, groupId } : { type: trigger.type })
          }
        />
      </>
    );
  }

  if (trigger.type === 'status_changed') {
    const column = board.columns.find((c) => c.id === trigger.columnId);
    return (
      <>
        <ColumnToken
          label="Status column"
          columns={triggerColumns(board, 'status')}
          value={trigger.columnId}
          onChange={(columnId) => onChange({ type: 'status_changed', columnId })}
        />
        <span className={styles.word}>changes to</span>
        <SentenceToken
          label="Changes to"
          placeholder="anything"
          value={trigger.toLabelId === undefined ? '' : String(trigger.toLabelId)}
          display={
            trigger.toLabelId === undefined
              ? 'anything'
              : (labelsOf(column).find((l) => l.index === trigger.toLabelId)?.label ?? 'a label')
          }
          options={[{ value: '', label: 'anything' }, ...labelOptions(column, 'index')]}
          onChange={(next) =>
            onChange({
              type: 'status_changed',
              columnId: trigger.columnId,
              ...(next === '' ? {} : { toLabelId: Number(next) }),
            })
          }
        />
        {changeTrigger}
      </>
    );
  }

  if (trigger.type === 'button_clicked') {
    return (
      <>
        <ColumnToken
          label="Button column"
          columns={triggerColumns(board, 'button')}
          value={trigger.columnId}
          onChange={(columnId) => onChange({ type: 'button_clicked', columnId })}
        />
        <span className={styles.word}>is clicked</span>
        {changeTrigger}
      </>
    );
  }

  if (trigger.type === 'person_assigned') {
    return (
      <>
        <AssigneeToken
          value={trigger.uid}
          onChange={(uid) =>
            onChange({
              type: 'person_assigned',
              columnId: trigger.columnId,
              ...(uid === '' ? {} : { uid }),
            })
          }
        />
        <span className={styles.word}>is assigned to</span>
        <ColumnToken
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
        {changeTrigger}
      </>
    );
  }

  if (trigger.type === 'date_arrives') {
    return (
      <>
        {trigger.offsetDays !== 0 ? (
          <TokenInput
            label="Days"
            type="number"
            min={1}
            max={30}
            size="narrow"
            value={String(Math.abs(trigger.offsetDays))}
            onChange={(_text, number) => {
              const days = Math.min(30, Math.max(1, Math.trunc(number) || 1));
              onChange({ ...trigger, offsetDays: trigger.offsetDays < 0 ? -days : days });
            }}
          />
        ) : null}
        <SentenceToken
          label="When relative to the date"
          placeholder="on the day"
          value={trigger.offsetDays < 0 ? 'before' : trigger.offsetDays > 0 ? 'after' : 'on'}
          options={[
            { value: 'on', label: 'on the day' },
            { value: 'before', label: 'days before' },
            { value: 'after', label: 'days after' },
          ]}
          onChange={(when) =>
            onChange({
              ...trigger,
              offsetDays:
                when === 'on'
                  ? 0
                  : when === 'before'
                    ? -Math.abs(trigger.offsetDays || 1)
                    : Math.abs(trigger.offsetDays || 1),
            })
          }
        />
        <ColumnToken
          label="Date column"
          columns={triggerColumns(board, 'date')}
          value={trigger.columnId}
          onChange={(columnId) => onChange({ ...trigger, columnId })}
        />
        <span className={styles.word}>{trigger.offsetDays === 0 ? 'arrives at' : 'at'}</span>
        <TokenInput
          label="Time of day"
          type="time"
          value={trigger.at ?? ''}
          placeholder="its own time"
          onChange={(value) => {
            const { at: _at, ...rest } = trigger;
            onChange(value ? { ...rest, at: value } : rest);
          }}
        />
        <span className={styles.note}>
          {trigger.at ? `(${timezone})` : `(the date's own time, else 09:00, ${timezone})`}
        </span>
        {changeTrigger}
      </>
    );
  }

  // recurring
  return (
    <>
      <span className={styles.word}>every</span>
      <SentenceToken
        label="Repeat"
        placeholder="day"
        value={trigger.every}
        options={[
          { value: 'day', label: 'day' },
          { value: 'week', label: 'week' },
          { value: 'month', label: 'month' },
        ]}
        onChange={(every) => {
          if (every === 'week') onChange({ type: 'recurring', every, weekday: 1, at: trigger.at });
          else if (every === 'month') {
            onChange({ type: 'recurring', every, dayOfMonth: 1, at: trigger.at });
          } else onChange({ type: 'recurring', every: 'day', at: trigger.at });
        }}
      />
      {trigger.every === 'week' ? (
        <>
          <span className={styles.word}>on</span>
          <SentenceToken
            label="Weekday"
            placeholder="Monday"
            value={String(trigger.weekday ?? 1)}
            options={WEEKDAY_NAMES.map((name, i) => ({ value: String(i), label: name }))}
            onChange={(weekday) => onChange({ ...trigger, weekday: Number(weekday) })}
          />
        </>
      ) : null}
      {trigger.every === 'month' ? (
        <>
          <span className={styles.word}>on day</span>
          <SentenceToken
            label="Day of month"
            placeholder="1"
            value={String(trigger.dayOfMonth ?? 1)}
            options={Array.from({ length: 28 }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            }))}
            onChange={(day) => onChange({ ...trigger, dayOfMonth: Number(day) })}
          />
        </>
      ) : null}
      <span className={styles.word}>at</span>
      <TokenInput
        label="Time of day"
        type="time"
        value={trigger.at}
        required
        onChange={(value) => {
          if (value) onChange({ ...trigger, at: value });
        }}
      />
      <span className={styles.note}>({timezone})</span>
      {changeTrigger}
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
      <SentenceToken
        label="Value"
        placeholder="a value"
        value={current === undefined ? null : String(current)}
        options={labelOptions(column, 'index')}
        onChange={(next) => onChange({ index: Number(next) })}
      />
    );
  }
  if (column.type === 'dropdown') {
    const current = (value as { ids?: number[] } | undefined)?.ids?.[0];
    return (
      <SentenceToken
        label="Value"
        placeholder="a value"
        value={current === undefined ? null : String(current)}
        options={labelOptions(column, 'id')}
        onChange={(next) => onChange({ ids: [Number(next)] })}
      />
    );
  }
  if (column.type === 'numbers') {
    return (
      <TokenInput
        label="Value"
        type="number"
        placeholder="a number"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(text, number) =>
          onChange(text === '' || !Number.isFinite(number) ? undefined : number)
        }
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
    <TokenInput
      label="Value"
      placeholder="a value"
      value={text}
      maxLength={1000}
      onChange={(next) => {
        if (next === '') onChange(undefined);
        else onChange(column.type === 'long_text' ? { text: next } : next);
      }}
    />
  );
}

function ConditionLine({
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
      <div className={`${styles.line} ${styles.sub}`}>
        <span className={styles.keyword}>and only if</span>
        <ColumnToken
          label="Column"
          columns={columns}
          value={condition.columnId}
          onChange={(columnId) => onChange(newCondition(columns.find((c) => c.id === columnId)))}
        />
        {column ? (
          <SentenceToken
            label="Operator"
            placeholder="is"
            value={condition.op}
            options={ops.map((o) => ({ value: o.op, label: o.label }))}
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
          />
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
          size="small"
          aria-label={`Remove condition ${index + 1}`}
          onClick={onRemove}
        />
      </div>
      <SentenceProblem message={problem} />
    </li>
  );
}

/** The described sentence with bold names and coloured label chips. */
function RichSentence({ parts }: { parts: readonly DescribePart[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.color ? (
          <span key={i} className={styles.chip} style={{ backgroundColor: part.color }}>
            {part.text}
          </span>
        ) : part.strong ? (
          <strong key={i}>{part.text}</strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

const COMING_SOON = [
  { badge: 'P9', text: 'Email, calendar and chat apps' },
  { badge: 'P5c', text: 'A connected item changes status' },
] as const;

/**
 * The recipe builder as one sentence: "When [trigger], and only if [condition], then [action]".
 * Each part is an inline blank that opens a short list. A "Reads as" panel shows the finished
 * sentence, and the footer counts the blanks left. Save stays disabled until none is left and the
 * draft would pass `validateAutomation`; the first failure shows next to the part it is about.
 * Rendered inside the Automation center's shell, under its back bar.
 */
export function RecipeBuilder({
  board,
  role,
  uid,
  existingCount,
  existing = [],
  automation,
  initial,
  onCancel,
  onSaved,
}: RecipeBuilderProps) {
  const start = automation
    ? {
        name: automation.name,
        trigger: automation.trigger as AutomationTrigger | null,
        conditions: automation.conditions,
        actions: automation.actions as (ButtonAction | null)[],
      }
    : initial
      ? { ...initial, trigger: initial.trigger as AutomationTrigger | null }
      : // From scratch: a blank trigger and a blank action to fill in.
        {
          name: '',
          trigger: null as AutomationTrigger | null,
          conditions: [] as AutomationCondition[],
          actions: [null] as (ButtonAction | null)[],
        };
  const [name, setName] = useState(start.name);
  const [trigger, setTrigger] = useState<AutomationTrigger | null>(start.trigger);
  const [conditions, setConditions] = useState<AutomationCondition[]>([...start.conditions]);
  const [actions, setActions] = useState<(ButtonAction | null)[]>([...start.actions]);
  const [saving, setSaving] = useState(false);
  const noteId = useId();
  const readsId = useId();

  // A scheduled recipe keeps the zone it was saved with; saving it as someone else (or a new one)
  // uses the saver's profile zone, else the browser's.
  const profileZone = useUserTimezone(uid);
  const timezone =
    automation?.timezone && automation.runAs === uid
      ? automation.timezone
      : resolveRecipeTimezone(profileZone);
  const others = useMemo(
    () => existing.filter((a) => a.id !== automation?.id),
    [existing, automation?.id],
  );

  const { members } = useWorkspaceMembers();
  const lookup = useUserLookup();
  const describeOptions = useMemo(
    () => ({
      personName: (id: string) =>
        lookup(id)?.name ?? members.find((m) => m.id === id)?.displayName ?? null,
    }),
    [lookup, members],
  );

  const columnViews = useMemo(() => buildColumnViews(board.columns), [board.columns]);
  const { problems, blanks } = useMemo(
    () =>
      checkBlankableDraft(
        { trigger, conditions, actions },
        board,
        role,
        automation ? null : existingCount,
        { timezone, others },
      ),
    [trigger, conditions, actions, board, role, automation, existingCount, timezone, others],
  );
  const complete = blanks.total === 0 && isDraftOk(problems, actions.length);
  const canSave = complete && !saving;
  const takesOver = automation !== null && automation.runAs !== uid;
  const eligible = conditionColumns(board);
  const atConditionCap = conditions.length >= AUTOMATION_LIMITS.maxConditions;
  const atActionCap = actions.length >= BUTTON_LIMITS.maxActions;
  const readsParts =
    blanks.total === 0 && trigger
      ? describeAutomationParts(
          {
            trigger,
            conditions,
            actions: actions.filter((a): a is ButtonAction => a !== null),
            timezone,
          },
          board,
          describeOptions,
        )
      : null;

  const save = async () => {
    if (!canSave || trigger === null) return;
    setSaving(true);
    const input: AutomationInput = {
      name: name.trim(),
      trigger,
      conditions,
      actions: actions.filter((a): a is ButtonAction => a !== null),
      ...(isScheduledTrigger(trigger) ? { timezone } : {}),
    };
    const ctx = { boardId: board.id, uid, board, role };
    try {
      let savedId: string;
      if (automation) {
        await automationWrites.update(ctx, automation.id, input, others);
        savedId = automation.id;
      } else {
        savedId = await automationWrites.create(ctx, input, existingCount, { others });
      }
      showToast(automation ? 'Automation saved' : 'Automation created and switched on', {
        type: 'positive',
      });
      onSaved(savedId);
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

  const status =
    blanks.total > 0
      ? `${blanks.total} ${blanks.total === 1 ? 'blank' : 'blanks'} left to fill`
      : complete
        ? 'Ready'
        : 'Fix the problem marked in red to continue';

  return (
    <form
      className={styles.builder}
      aria-label={automation ? 'Edit automation' : 'New automation'}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.canvas}>
        <section className={styles.part} aria-label="Trigger">
          <div className={styles.line}>
            <span className={`${styles.keyword} ${styles.keywordStrong}`}>When</span>
            <TriggerLine
              board={board}
              trigger={trigger}
              timezone={timezone}
              onChange={setTrigger}
            />
          </div>
          <SentenceProblem message={problems.trigger} />
        </section>

        <section className={styles.part} aria-label="Conditions">
          {conditions.length > 0 ? (
            <ol className={styles.list} aria-label="Conditions">
              {conditions.map((condition, i) => (
                <ConditionLine
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
          ) : null}
          <div className={styles.addRow}>
            <Button
              kind="tertiary"
              size="small"
              leftIcon={Add}
              disabled={atConditionCap || eligible.length === 0 || trigger === null}
              onClick={() => setConditions([...conditions, newCondition(eligible[0])])}
            >
              Add a condition
            </Button>
            <span className={styles.count}>
              ({conditions.length}/{AUTOMATION_LIMITS.maxConditions})
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
          <ol className={styles.list} aria-label="Actions">
            {actions.map((action, i) => (
              <ActionLine
                key={i}
                action={action}
                index={i}
                keyword={i === 0 ? 'then' : 'and'}
                columns={columnViews}
                groups={board.groups}
                boardId={board.id}
                allowedTypes={trigger?.type === 'recurring' ? RECURRING_ACTION_TYPES : undefined}
                error={problems.actions[i] ?? null}
                canRemove={actions.length > 1}
                onChange={(next) => setActions(actions.map((a, j) => (j === i ? next : a)))}
                onRemove={() => setActions(actions.filter((_, j) => j !== i))}
              />
            ))}
          </ol>
          <div className={styles.addRow}>
            <Button
              kind="tertiary"
              size="small"
              leftIcon={Add}
              disabled={atActionCap}
              onClick={() => setActions([...actions, null])}
            >
              Add an action
            </Button>
            <span className={styles.count}>
              ({actions.length}/{BUTTON_LIMITS.maxActions})
            </span>
          </div>
          <SentenceProblem message={problems.general} />
        </section>
      </div>

      <aside className={styles.side} aria-label="About this automation">
        <h3 className={styles.sideHeading} id={readsId}>
          Reads as
        </h3>
        <p className={styles.reads} role="status" aria-labelledby={readsId}>
          {readsParts ? (
            <RichSentence parts={readsParts} />
          ) : (
            'Fill in the blue blanks to finish the sentence.'
          )}
        </p>
        <h3 className={styles.sideHeading}>Coming soon to the builder</h3>
        <ul className={styles.soon}>
          {COMING_SOON.map((row) => (
            <li key={row.badge}>
              <span className={styles.badge}>{row.badge}</span>
              <span>{row.text}</span>
            </li>
          ))}
        </ul>
        <p className={styles.footnote}>
          {`Each automation runs at most ${AUTOMATION_LIMITS.maxRunsPerHour} times an hour, and a chain of automations stops after ${AUTOMATION_LIMITS.maxDepth} steps. `}
          Use {'{name}'} for the item&apos;s name and {'{date}'} for today&apos;s date in names and
          updates.
        </p>
      </aside>

      <div className={styles.footer}>
        <div className={styles.nameField}>
          <TextField
            id="recipe-name"
            title="Name (optional)"
            inputAriaLabel="Name"
            value={name}
            onChange={(value: string) => setName(value)}
            maxLength={AUTOMATION_LIMITS.name}
            placeholder="e.g. Escalate blocked work"
            size="small"
          />
        </div>
        <div className={styles.message}>
          <span role="status" aria-label="Blanks left" className={styles.status}>
            {complete ? <Check className={styles.statusIcon} aria-hidden="true" /> : null}
            {status}
          </span>
          {takesOver ? (
            <span id={noteId} className={styles.takeOver} role="note">
              Saving makes you the person this runs as.
            </span>
          ) : null}
        </div>
        <Button kind="secondary" size="small" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          kind="primary"
          size="small"
          type="submit"
          disabled={!canSave}
          loading={saving}
          aria-describedby={takesOver ? noteId : undefined}
        >
          {automation ? 'Save changes' : 'Create automation'}
        </Button>
      </div>
    </form>
  );
}
