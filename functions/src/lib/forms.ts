import {
  FORM_LIMITS,
  askableQuestions,
  formSettingsSchema,
  getFormResultSchema,
  publicFormQuestions,
  validateFormAnswers,
  applyDefaultColumnValues,
  type ColumnDef,
  type FormColumn,
  type FormSettings,
  type GetFormRequest,
  type GetFormResult,
  type SubmitFormRequest,
  type SubmitFormResult,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

/** The board and view fields the form callables read. */
export interface FormBoardData {
  state: string;
  columns: Array<FormColumn & Pick<ColumnDef, 'defaultValue'>>;
  groups: Array<{ id: string; position: string }>;
}

export interface FormViewData {
  type: string;
  ownerId: string | null;
  settings: { form?: unknown } | null;
}

/** The form a visitor may use, or `null` for everything else (off, wrong type, gone, deleted board). */
export interface LoadedForm {
  settings: FormSettings;
  board: FormBoardData;
}

export interface FormReads {
  getView(boardId: string, viewId: string): Promise<FormViewData | null>;
  getBoard(boardId: string): Promise<FormBoardData | null>;
}

/** One hour of submissions, as counted in `boards/{boardId}/counters/form_*`. */
export interface FormCounts {
  person: number;
  form: number;
}

/** Everything `submitForm` does inside its transaction (all reads come before the first write). */
export interface FormsTx extends FormReads {
  /** The largest item position on the board (any group); `null` on an empty board. */
  getLastItemPosition(boardId: string): Promise<string | null>;
  getCounts(boardId: string, viewId: string, uid: string, hour: number): Promise<FormCounts>;
  /** Writes both counters (new totals) with a TTL expiry. */
  setCounts(
    boardId: string,
    viewId: string,
    uid: string,
    hour: number,
    counts: FormCounts,
    expiresAtMs: number,
  ): void;
  newItemId(boardId: string): string;
  createItem(boardId: string, itemId: string, item: NewFormItem): void;
  nowMs(): number;
}

export interface NewFormItem {
  name: string;
  groupId: string;
  position: string;
  values: Record<string, unknown>;
  createdBy: string;
}

/** The one error a visitor sees for "no such form", "form is off" and "not a form". */
export const formNotAvailable = (): HttpsError =>
  new HttpsError('not-found', 'This form is not available.');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Counters expire a day after their hour ends (Firestore TTL on `expiresAt`). */
export const FORM_COUNTER_TTL_MS = DAY_MS;
export const hourOf = (nowMs: number): number => Math.floor(nowMs / HOUR_MS);

async function loadForm(
  store: FormReads,
  boardId: string,
  viewId: string,
): Promise<LoadedForm | null> {
  const view = await store.getView(boardId, viewId);
  if (!view || view.type !== 'form' || view.ownerId !== null) return null;
  const parsed = formSettingsSchema.safeParse(view.settings?.form);
  if (!parsed.success || !parsed.data.acceptingResponses) return null;
  const board = await store.getBoard(boardId);
  if (!board || board.state !== 'active') return null;
  return { settings: parsed.data, board };
}

/** `getForm`: the safe shape for a visitor, or `not-found`. */
export async function getFormForVisitor(
  store: FormReads,
  request: GetFormRequest,
): Promise<GetFormResult> {
  const form = await loadForm(store, request.boardId, request.viewId);
  if (!form) throw formNotAvailable();
  return getFormResultSchema.parse({
    title: form.settings.title,
    description: form.settings.description,
    thankYou: form.settings.thankYou,
    questions: publicFormQuestions(form.settings, form.board.columns),
  });
}

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A fractional-index key that sorts after `last` (`a0` when there is none), in the format the web
 * app's `fractional-indexing` produces: an integer part whose first letter gives its length, then an
 * optional fraction. Incrementing the integer part is enough to sort after any key.
 */
export function positionAfter(last: string | null): string {
  if (!last) return 'a0';
  const head = last[0]!;
  const length =
    head >= 'a' && head <= 'z'
      ? head.charCodeAt(0) - 96 + 1
      : head >= 'A' && head <= 'Z'
        ? 90 - head.charCodeAt(0) + 2
        : 0;
  if (length < 2 || length > last.length) return `${last}V`;
  const integer = last.slice(0, length);
  const digits = integer.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; i >= 0 && carry; i -= 1) {
    const next = DIGITS.indexOf(digits[i]!) + 1;
    if (next === DIGITS.length) digits[i] = '0';
    else {
      digits[i] = DIGITS[next]!;
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a0';
  if (head === 'z') return `${last}V`; // the largest integer: extend with a fraction instead
  const bigger = String.fromCharCode(head.charCodeAt(0) + 1);
  if (bigger > 'a') digits.push('0');
  else digits.pop();
  return bigger + digits.join('');
}

/**
 * `submitForm`. Reads first (view, board, counters, last position), then checks the rate limits,
 * validates the answers, and only then writes the two counters and the item. Item numbers come from
 * the `onItemCreated` trigger and the `item_created` activity entry (with `data.source: 'form'`,
 * recognised by the item's `updatedVia: 'form'`) from `onItemWrittenActivity`, as for every item.
 */
export async function submitFormInTransaction(
  tx: FormsTx,
  uid: string,
  request: SubmitFormRequest,
): Promise<SubmitFormResult> {
  const { boardId, viewId } = request;
  const form = await loadForm(tx, boardId, viewId);
  if (!form) throw formNotAvailable();

  const now = tx.nowMs();
  const hour = hourOf(now);
  const counts = await tx.getCounts(boardId, viewId, uid, hour);
  if (counts.person >= FORM_LIMITS.perPersonPerHour) {
    throw new HttpsError(
      'resource-exhausted',
      'You have sent too many responses to this form. Try again in an hour.',
    );
  }
  if (counts.form >= FORM_LIMITS.perFormPerHour) {
    throw new HttpsError(
      'resource-exhausted',
      'This form is getting a lot of responses right now. Try again in an hour.',
    );
  }

  const checked = validateFormAnswers(form.settings, form.board.columns, request.answers);
  if (!checked.ok) {
    throw new HttpsError(
      'invalid-argument',
      checked.message,
      checked.columnId ? { columnId: checked.columnId } : undefined,
    );
  }

  const groups = [...form.board.groups].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
  );
  const groupId = groups.some((g) => g.id === form.settings.targetGroupId)
    ? form.settings.targetGroupId
    : groups[0]?.id;
  if (!groupId) {
    throw new HttpsError('failed-precondition', 'This form is not available.');
  }

  // Columns the form doesn't ask about still get their configured default, like any new item.
  const askedIds = new Set(
    askableQuestions(form.settings, form.board.columns).map((a) => a.question.columnId),
  );
  const defaults = applyDefaultColumnValues(
    form.board.columns.filter((c) => !askedIds.has(c.id)) as ColumnDef[],
  );
  const lastPosition = await tx.getLastItemPosition(boardId);

  tx.setCounts(
    boardId,
    viewId,
    uid,
    hour,
    { person: counts.person + 1, form: counts.form + 1 },
    (hour + 1) * HOUR_MS + FORM_COUNTER_TTL_MS,
  );
  tx.createItem(boardId, tx.newItemId(boardId), {
    name: checked.name,
    groupId,
    position: positionAfter(lastPosition),
    values: { ...defaults, ...checked.values },
    createdBy: uid,
  });
  return { ok: true, thankYou: form.settings.thankYou };
}
