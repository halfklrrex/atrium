import {
  FORM_LIMITS,
  FORM_NAME_COLUMN_ID,
  isFormQuestionType,
  type ColumnDef,
  type FormQuestion,
} from '@atrium/shared';

/** The link to share: `<origin>/forms/<boardId>/<viewId>`. */
export const formUrl = (origin: string, boardId: string, viewId: string): string =>
  `${origin}/forms/${boardId}/${viewId}`;

/** Board columns that can still become a question: allowed type, not converting, not asked yet. */
export function addableColumns(
  columns: readonly ColumnDef[],
  questions: readonly FormQuestion[],
): ColumnDef[] {
  const asked = new Set(questions.map((q) => q.columnId));
  return columns
    .filter((c) => isFormQuestionType(c.type) && !c.migrating && !asked.has(c.id))
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

export const canAddQuestion = (questions: readonly FormQuestion[]): boolean =>
  questions.length < FORM_LIMITS.questions;

export function appendQuestion(
  questions: readonly FormQuestion[],
  column: Pick<ColumnDef, 'id' | 'title'>,
): FormQuestion[] {
  return [
    ...questions,
    { columnId: column.id, label: column.title.slice(0, FORM_LIMITS.labelMax), required: false },
  ];
}

/** The name question is first, required and permanent: it can't be removed. */
export function removeQuestion(
  questions: readonly FormQuestion[],
  columnId: string,
): FormQuestion[] {
  if (columnId === FORM_NAME_COLUMN_ID) return [...questions];
  return questions.filter((q) => q.columnId !== columnId);
}

/** Change one question. `help: ''` removes the help text; the name question stays required. */
export function patchQuestion(
  questions: readonly FormQuestion[],
  columnId: string,
  patch: { label?: string; help?: string; required?: boolean },
): FormQuestion[] {
  return questions.map((q) => {
    if (q.columnId !== columnId) return q;
    const { help, ...rest } = { ...q, ...patch };
    const next: FormQuestion = { ...rest };
    if (help) next.help = help;
    if (columnId === FORM_NAME_COLUMN_ID) next.required = true;
    return next;
  });
}

/** Move the question with id `activeId` to where `overId` is. Nothing moves above the name. */
export function reorderQuestions(
  questions: readonly FormQuestion[],
  activeId: string,
  overId: string,
): FormQuestion[] {
  const from = questions.findIndex((q) => q.columnId === activeId);
  const to = questions.findIndex((q) => q.columnId === overId);
  if (from < 1 || to < 1 || from === to) return [...questions];
  const next = [...questions];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
