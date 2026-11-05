import { columnRegistry, isColumnValueEmpty } from './columns';
import type { ColumnDef } from './schemas/board';
import {
  FORM_LIMITS,
  FORM_NAME_COLUMN_ID,
  FORM_NAME_QUESTION_TYPE,
  FORM_QUESTION_TYPES,
  type FormQuestion,
  type FormSettings,
  type PublicFormQuestion,
} from './schemas/form';

/** The part of a board column the form logic reads. */
export type FormColumn = Pick<ColumnDef, 'id' | 'type' | 'settings'> & { migrating?: unknown };

const QUESTION_TYPES: ReadonlySet<string> = new Set(FORM_QUESTION_TYPES);

/** True when a column of this type may be a question. */
export const isFormQuestionType = (type: string): boolean => QUESTION_TYPES.has(type);

/**
 * The questions a form can really ask on this board: the name question, plus every question whose
 * column still exists, has an allowed type and isn't being converted. The rest are left out of both
 * the public form and the submit check, so a deleted or retyped column never blocks a submission.
 */
export function askableQuestions(
  settings: Pick<FormSettings, 'questions'>,
  columns: readonly FormColumn[],
): Array<{ question: FormQuestion; column: FormColumn | null }> {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const out: Array<{ question: FormQuestion; column: FormColumn | null }> = [];
  for (const question of settings.questions) {
    if (question.columnId === FORM_NAME_COLUMN_ID) {
      out.push({ question, column: null });
      continue;
    }
    const column = byId.get(question.columnId);
    if (!column || !isFormQuestionType(column.type) || column.migrating) continue;
    out.push({ question, column });
  }
  return out;
}

/** Problems that stop a form being published (empty = fine). */
export function formPublishProblems(
  settings: Pick<FormSettings, 'questions' | 'targetGroupId'>,
  board: { columns: readonly FormColumn[]; groups: ReadonlyArray<{ id: string }> },
): string[] {
  const problems: string[] = [];
  if (!board.groups.some((g) => g.id === settings.targetGroupId)) {
    problems.push('The group new responses go to no longer exists.');
  }
  const byId = new Map(board.columns.map((c) => [c.id, c]));
  for (const q of settings.questions) {
    if (q.columnId === FORM_NAME_COLUMN_ID) continue;
    const column = byId.get(q.columnId);
    if (!column) problems.push(`"${q.label}" asks about a column that no longer exists.`);
    else if (!isFormQuestionType(column.type)) {
      problems.push(`"${q.label}" asks about a ${column.type} column, which forms don't support.`);
    }
  }
  return problems;
}

/** Only what a status, dropdown, number or rating input needs to draw itself. */
function publicSettings(type: string, settings: unknown): Record<string, unknown> {
  const s = (settings ?? {}) as Record<string, unknown>;
  const labels = Array.isArray(s.labels) ? (s.labels as Array<Record<string, unknown>>) : [];
  switch (type) {
    case 'status':
      return {
        labels: labels.map((l) => ({ id: l.id, index: l.index, label: l.label, color: l.color })),
      };
    case 'dropdown':
      return {
        labels: labels.map((l) => ({ id: l.id, label: l.label })),
        limitSelect: s.limitSelect === true,
      };
    case 'numbers':
      return { unit: s.unit ?? null, decimals: s.decimals ?? null };
    case 'rating':
      return { limit: s.limit ?? 5, symbol: s.symbol ?? 'stars' };
    default:
      return {};
  }
}

/** The safe shape `getForm` returns for the questions. */
export function publicFormQuestions(
  settings: Pick<FormSettings, 'questions'>,
  columns: readonly FormColumn[],
): PublicFormQuestion[] {
  return askableQuestions(settings, columns).map(({ question, column }) => ({
    columnId: question.columnId,
    label: question.label,
    ...(question.help ? { help: question.help } : {}),
    required: question.required,
    type: column ? column.type : FORM_NAME_QUESTION_TYPE,
    settings: column ? publicSettings(column.type, column.settings) : {},
  }));
}

export type FormAnswersResult =
  | { ok: true; name: string; values: Record<string, unknown> }
  | { ok: false; columnId?: string; message: string };

/**
 * Checks a submission against the form and the board. Only question columns are accepted (an
 * unknown key is refused, not ignored); every value passes `columnRegistry.validateCell`; required
 * questions must be non-empty by `isColumnValueEmpty`. Empty answers are left out of `values`.
 */
export function validateFormAnswers(
  settings: Pick<FormSettings, 'questions'>,
  columns: readonly FormColumn[],
  answers: Record<string, unknown>,
): FormAnswersResult {
  if (utf8Bytes(JSON.stringify(answers)) > FORM_LIMITS.answersMaxBytes) {
    return { ok: false, message: 'The response is too large.' };
  }
  const asked = askableQuestions(settings, columns);
  const known = new Set(asked.map((a) => a.question.columnId));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) return { ok: false, columnId: key, message: 'Unknown question.' };
  }

  const rawName = answers[FORM_NAME_COLUMN_ID];
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 1 || name.length > FORM_LIMITS.nameMax) {
    return {
      ok: false,
      columnId: FORM_NAME_COLUMN_ID,
      message: `Enter a name of 1 to ${FORM_LIMITS.nameMax} characters.`,
    };
  }

  const values: Record<string, unknown> = {};
  for (const { question, column } of asked) {
    if (!column) continue;
    const value = answers[question.columnId];
    // Validate first: a malformed value must be refused, not mistaken for an empty answer.
    const checked = columnRegistry.validateCell(column as ColumnDef, value);
    if (!checked.ok) {
      return { ok: false, columnId: question.columnId, message: checked.message };
    }
    if (isColumnValueEmpty(column.type, value)) {
      if (question.required) {
        return { ok: false, columnId: question.columnId, message: 'This question is required.' };
      }
      continue;
    }
    values[question.columnId] = value;
  }
  return { ok: true, name, values };
}

/** UTF-8 byte length without a Node or DOM dependency. */
function utf8Bytes(text: string | undefined): number {
  let bytes = 0;
  for (const ch of text ?? '') {
    const code = ch.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
