import { z } from 'zod';
import { slugIdSchema } from './board';

/**
 * Column types a form may ask about (P7). People, files, button, mirror, derived, server-managed and
 * time-tracking columns are never questions in v1: file questions need staged uploads (a later slice).
 */
export const FORM_QUESTION_TYPES = [
  'text',
  'long_text',
  'numbers',
  'status',
  'dropdown',
  'date',
  'checkbox',
  'email',
  'phone',
  'link',
  'rating',
] as const;
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number];

/** The question that fills the item name: always first, always required. */
export const FORM_NAME_COLUMN_ID = 'name';
/** The `type` `getForm` reports for the name question. */
export const FORM_NAME_QUESTION_TYPE = 'name';

/** Caps shared by the schema, the callables and the web. */
export const FORM_LIMITS = {
  questions: 30,
  titleMax: 120,
  descriptionMax: 1000,
  thankYouMax: 500,
  labelMax: 120,
  helpMax: 300,
  /** Item name length (a form submitter gets a tighter cap than the 500 of a board editor). */
  nameMax: 200,
  /** Largest `answers` object a submission may carry, as JSON. */
  answersMaxBytes: 50_000,
  /** Submissions per person per form per hour. */
  perPersonPerHour: 10,
  /** Submissions per form per hour, all people together. */
  perFormPerHour: 200,
} as const;

export const formQuestionSchema = z
  .object({
    columnId: slugIdSchema,
    label: z.string().min(1).max(FORM_LIMITS.labelMax),
    help: z.string().max(FORM_LIMITS.helpMax).optional(),
    required: z.boolean(),
  })
  .strict();
export type FormQuestion = z.infer<typeof formQuestionSchema>;

/** Settings of a Form view (`views/{id}.settings.form`). */
export const formSettingsSchema = z
  .object({
    title: z.string().max(FORM_LIMITS.titleMax),
    description: z.string().max(FORM_LIMITS.descriptionMax),
    thankYou: z.string().max(FORM_LIMITS.thankYouMax),
    /** Must exist on the board when the form is published and when it is submitted. */
    targetGroupId: slugIdSchema,
    /** The item name (`columnId: 'name'`) is always the first question. */
    questions: z.array(formQuestionSchema).min(1).max(FORM_LIMITS.questions),
    acceptingResponses: z.boolean(),
  })
  .strict()
  .superRefine((settings, ctx) => {
    const first = settings.questions[0];
    if (first && (first.columnId !== FORM_NAME_COLUMN_ID || !first.required)) {
      ctx.addIssue({
        code: 'custom',
        path: ['questions', 0],
        message: 'The first question must be the required item name',
      });
    }
    const seen = new Set<string>();
    settings.questions.forEach((q, i) => {
      if (seen.has(q.columnId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', i, 'columnId'],
          message: 'A column can be asked only once',
        });
      }
      seen.add(q.columnId);
    });
  });
export type FormSettings = z.infer<typeof formSettingsSchema>;

export function defaultFormSettings(targetGroupId: string): FormSettings {
  return {
    title: '',
    description: '',
    thankYou: 'Thanks, your response was recorded.',
    targetGroupId,
    questions: [{ columnId: FORM_NAME_COLUMN_ID, label: 'Name', required: true }],
    acceptingResponses: false,
  };
}

/** A board or view id as it appears in a document path (no slash can sneak in). */
const pathIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Expected an id');

/** Name of the callables, shared so client and server cannot drift. */
export const GET_FORM_CALLABLE = 'getForm';
export const SUBMIT_FORM_CALLABLE = 'submitForm';

export const getFormRequestSchema = z
  .object({ boardId: pathIdSchema, viewId: pathIdSchema })
  .strict();
export type GetFormRequest = z.infer<typeof getFormRequestSchema>;

/** One question as a visitor sees it: how to draw the input, nothing about the board. */
export const publicFormQuestionSchema = z.object({
  columnId: slugIdSchema,
  label: z.string(),
  help: z.string().optional(),
  required: z.boolean(),
  /** A column type from {@link FORM_QUESTION_TYPES}, or `name` for the item name. */
  type: z.string(),
  /** Only what the input needs (status labels, dropdown options, number format, rating scale). */
  settings: z.record(z.string(), z.unknown()),
});
export type PublicFormQuestion = z.infer<typeof publicFormQuestionSchema>;

export const getFormResultSchema = z.object({
  title: z.string(),
  description: z.string(),
  thankYou: z.string(),
  questions: z.array(publicFormQuestionSchema),
});
export type GetFormResult = z.infer<typeof getFormResultSchema>;

export const submitFormRequestSchema = z
  .object({
    boardId: pathIdSchema,
    viewId: pathIdSchema,
    /** Cell values keyed by column id; `name` is the item name. */
    answers: z.record(z.string().min(1).max(128), z.unknown()),
  })
  .strict();
export type SubmitFormRequest = z.infer<typeof submitFormRequestSchema>;

/** Never carries the item id: the submitter may not be allowed to read the board. */
export const submitFormResultSchema = z.object({ ok: z.literal(true), thankYou: z.string() });
export type SubmitFormResult = z.infer<typeof submitFormResultSchema>;
