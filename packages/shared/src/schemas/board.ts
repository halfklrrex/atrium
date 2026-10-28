import { z } from 'zod';
import { boardKindSchema, boardRoleSchema, entityStateSchema } from '../roles';
import {
  auditFields,
  hexColorSchema,
  iconSchema,
  idSchema,
  positionSchema,
  timestampSchema,
  uidSchema,
  type WriteDoc,
} from './common';

/** Short random slug, stable for the life of the column/group (architecture §5.4). */
export const slugIdSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/i, 'Expected a short slug id');

/** `ColumnDef` embedded in `boards/{id}.columns` / `subitemColumns`. `settings` is validated per type. */
export const columnDefSchema = z.object({
  id: slugIdSchema,
  type: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  width: z.number().int().min(40).max(1200).optional(),
  position: positionSchema,
  settings: z.record(z.string(), z.unknown()),
  /** Optional default value populated when creating new items (UI-level validation). */
  defaultValue: z.unknown().optional(),
  /** Whether filling this column is required when creating / editing items (UI-level validation). */
  required: z.boolean().optional(),
  /** Whether this column is collapsed in the table header. */
  collapsed: z.boolean().optional(),
  /** Cosmetic flag indicating whether this column is hidden from table views. */
  hidden: z.boolean().optional(),
});
export type ColumnDef = z.infer<typeof columnDefSchema>;
export type ColumnDefInput = z.input<typeof columnDefSchema>;

/** `GroupDef` embedded in `boards/{id}.groups`. */
export const groupDefSchema = z.object({
  id: slugIdSchema,
  title: z.string().min(1).max(120),
  color: hexColorSchema,
  position: positionSchema,
  collapsed: z.boolean().optional(),
});
export type GroupDef = z.infer<typeof groupDefSchema>;

/** `boards/{boardId}` (architecture §5.4). */
export const boardSchema = z.object({
  workspaceId: idSchema,
  folderId: idSchema.nullable(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  kind: boardKindSchema,
  access: z.record(uidSchema, boardRoleSchema),
  /** Always equals `Object.keys(access)`; rule-enforced so private boards can be listed (§5.4). */
  accessUids: z.array(uidSchema).min(1),
  /** Fractional index ordering the board within its folder (or the workspace root). */
  position: positionSchema,
  /** Reserved for a board icon; always `null` for now. */
  icon: iconSchema.nullable(),
  columns: z.array(columnDefSchema),
  subitemColumns: z.array(columnDefSchema),
  groups: z.array(groupDefSchema),
  /**
   * Ids of the columns whose type is derived (computed, never stored). Maintained only by the
   * `onBoardColumnsWritten` Cloud Function; clients create boards with `[]` and can never change it.
   * Rules use it to refuse client writes to `values.<id>`. Older boards may lack it (reads as `[]`).
   */
  derivedColumnIds: z.array(slugIdSchema).default([]),
  /**
   * Ids of the columns whose type is server-managed (FW2: time tracking, files, buttons), which
   * only Cloud Functions write. Same rules as `derivedColumnIds`: maintained only by the
   * `onBoardColumnsWritten` Cloud Function, created as `[]`, never changed by clients, and absent
   * on older boards (reads as `[]`).
   */
  serverManagedColumnIds: z.array(slugIdSchema).default([]),
  /**
   * Ids of columns (and subitemColumns) locked so only board owners can edit their values.
   * Older boards may lack this field (reads as `[]`).
   */
  columnLocks: z
    .array(slugIdSchema)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Column lock IDs must be unique')
    .default([]),
  itemTerminology: z.string().min(1).max(40),
  state: entityStateSchema,
  deletedAt: timestampSchema.nullable(),
  ...auditFields,
});
/** What the "New board" dialog collects. */
export const createBoardInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  kind: boardKindSchema.default('main'),
  folderId: idSchema.nullable().default(null),
});
export type CreateBoardInput = z.input<typeof createBoardInputSchema>;

export type Board = z.infer<typeof boardSchema>;
export type BoardWrite = WriteDoc<Board>;

/** The value `accessUids` must hold for a given `access` map: its keys. */
export function accessUidsOf(access: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(access);
}
