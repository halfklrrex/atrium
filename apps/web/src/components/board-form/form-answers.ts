import { FORM_LIMITS, FORM_NAME_COLUMN_ID, type PublicFormQuestion } from '@atrium/shared';

/** What the inputs hold while the visitor types: strings, a label index, option ids, a boolean, a rating. */
export type Drafts = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The cell value the server expects for a draft, or `undefined` when the question is unanswered. */
export function toAnswer(question: PublicFormQuestion, draft: unknown): unknown {
  switch (question.type) {
    case 'long_text':
      return text(draft) ? { text: text(draft) } : undefined;
    case 'numbers': {
      const raw = text(draft);
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case 'status':
      return typeof draft === 'number' ? { index: draft } : undefined;
    case 'dropdown':
      return Array.isArray(draft) && draft.length > 0 ? { ids: draft } : undefined;
    case 'date':
      return text(draft) ? { date: text(draft) } : undefined;
    case 'checkbox':
      return draft === true ? { checked: true } : undefined;
    case 'email':
      return text(draft) ? { email: text(draft) } : undefined;
    case 'phone':
      return text(draft) ? { phone: text(draft) } : undefined;
    case 'link':
      return text(draft) ? { url: text(draft) } : undefined;
    case 'rating':
      return typeof draft === 'number' && draft > 0 ? { rating: draft } : undefined;
    default: // text and the item name
      return text(draft) || undefined;
  }
}

/** All answers worth sending, keyed by column id (`name` is the item name). */
export function collectAnswers(
  questions: readonly PublicFormQuestion[],
  drafts: Drafts,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    const value = toAnswer(q, drafts[q.columnId]);
    if (value !== undefined) answers[q.columnId] = value;
  }
  return answers;
}

/** Convenience checks before sending; the server stays the authority. Keyed by column id. */
export function checkAnswers(
  questions: readonly PublicFormQuestion[],
  drafts: Drafts,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const answer = toAnswer(q, drafts[q.columnId]);
    if (answer === undefined) {
      if (q.required) errors[q.columnId] = 'This question is required.';
      continue;
    }
    if (q.columnId === FORM_NAME_COLUMN_ID && String(answer).length > FORM_LIMITS.nameMax) {
      errors[q.columnId] = `Use ${FORM_LIMITS.nameMax} characters or fewer.`;
    } else if (q.type === 'numbers' && typeof answer !== 'number') {
      errors[q.columnId] = 'Enter a number.';
    } else if (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(drafts[q.columnId]))) {
      errors[q.columnId] = 'Enter a valid email address.';
    } else if (
      q.type === 'link' &&
      !/^(https?:\/\/|mailto:|tel:)/i.test(text(drafts[q.columnId]))
    ) {
      errors[q.columnId] = 'Enter a link starting with https://';
    }
  }
  return errors;
}
