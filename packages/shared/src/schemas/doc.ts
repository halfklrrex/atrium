import { z } from 'zod';
import { boardKindSchema, boardRoleSchema } from '../roles';
import {
  auditFields,
  idSchema,
  positionSchema,
  timestampSchema,
  uidSchema,
  type WriteDoc,
} from './common';

/** Bytes of ProseMirror JSON a doc body may hold (client-enforced; rules cap `text` only). */
export const DOC_BODY_MAX_BYTES = 500_000;

/** Limits shared by the doc rules, the schemas and the UI (P7 docs spec). */
export const DOC_LIMITS = {
  name: 80,
  bodyBytes: DOC_BODY_MAX_BYTES,
  /** Characters in the plain-text mirror `text`. */
  text: 50_000,
  /** Most images a doc may hold (PR 5). */
  images: 100,
  /** Most entries in `access`. */
  accessEntries: 100,
} as const;

/** Docs are trashed and restored like dashboards, but never archived. */
export const docStateSchema = z.enum(['active', 'deleted']);
export type DocState = z.infer<typeof docStateSchema>;

/** `docs/{docId}`: the metadata listed in the sidebar. The text lives in `content/body`. */
export const docMetaSchema = z.object({
  workspaceId: idSchema,
  folderId: idSchema.nullable(),
  name: z.string().min(1).max(DOC_LIMITS.name),
  /** Same access model as boards and dashboards. */
  kind: boardKindSchema,
  access: z.record(uidSchema, boardRoleSchema),
  /** Always `Object.keys(access)`; rule-enforced so private docs can be listed. */
  accessUids: z.array(uidSchema).min(1),
  position: positionSchema,
  /** Reserved; always `null` in v1. */
  icon: z.null(),
  state: docStateSchema,
  deletedAt: timestampSchema.nullable(),
  ...auditFields,
  updatedBy: uidSchema.optional(),
});
export type DocMeta = z.infer<typeof docMetaSchema>;
export type DocMetaWrite = WriteDoc<DocMeta>;

/** ProseMirror JSON root: `{ type: 'doc', content: [...] }`. */
export const docBodyJsonSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough();
export type DocBodyJson = z.infer<typeof docBodyJsonSchema>;

/** Serialized size of a body in UTF-8 bytes. */
export function docBodyBytes(json: unknown): number {
  // No TextEncoder here (this package has no DOM or Node typings): count UTF-8 bytes by code point.
  const text = JSON.stringify(json) ?? '';
  let bytes = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** `docs/{docId}/content/body`: the text of a doc. `rev` is 1 on create and +1 on every save. */
export const docBodySchema = z.object({
  doc: docBodyJsonSchema.refine((d) => docBodyBytes(d) <= DOC_BODY_MAX_BYTES, {
    message: 'This doc is too long to save',
  }),
  text: z.string().max(DOC_LIMITS.text),
  rev: z.number().int().min(1),
  updatedAt: timestampSchema,
  updatedBy: uidSchema,
});
export type DocBody = z.infer<typeof docBodySchema>;
export type DocBodyWrite = WriteDoc<DocBody>;

/** What the "New doc" dialog collects. */
export const createDocInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(DOC_LIMITS.name),
  kind: boardKindSchema.default('main'),
  folderId: idSchema.nullable().default(null),
});
export type CreateDocInput = z.input<typeof createDocInputSchema>;
