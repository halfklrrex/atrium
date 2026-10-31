import { z } from 'zod';
import { slugIdSchema } from './board';

/** Callable names, shared so client and server cannot drift. */
export const CHANGE_COLUMN_TYPE_CALLABLE = 'changeColumnType';
export const REVERT_COLUMN_TYPE_CALLABLE = 'revertColumnType';

/** A column type change keeps its snapshot (and the "Undo type change" menu item) this long. */
export const COLUMN_SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A `migrating` mark older than this is treated as a run that died: a new call may take it over. */
export const COLUMN_MIGRATION_STALE_MS = 10 * 60 * 1000;
/** Most values per snapshot chunk document and most item writes per batch. */
export const COLUMN_MIGRATION_CHUNK_SIZE = 400;
/** A snapshot chunk also stays under this many serialised characters (a Firestore document is 1 MiB). */
export const COLUMN_SNAPSHOT_CHUNK_MAX_CHARS = 600_000;

export const columnScopeSchema = z.enum(['columns', 'subitemColumns']);
export type ColumnScope = z.infer<typeof columnScopeSchema>;

export const changeColumnTypeRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    columnId: slugIdSchema,
    scope: columnScopeSchema,
    toType: z.string().min(1).max(40),
    toSettings: z.record(z.string(), z.unknown()),
    /**
     * Optional client-chosen snapshot id. A retry with the same id resumes the same migration instead
     * of starting a second one, even when the response of the first call was lost.
     */
    snapshotId: slugIdSchema.optional(),
  })
  .strict();
export type ChangeColumnTypeRequest = z.infer<typeof changeColumnTypeRequestSchema>;

export const changeColumnTypeResultSchema = z
  .object({
    converted: z.number().int().min(0),
    cleared: z.number().int().min(0),
    snapshotId: slugIdSchema,
    /** The type the column has now (differs from the request only when a stuck run was resumed). */
    toType: z.string().min(1).max(40),
  })
  .strict();
export type ChangeColumnTypeResult = z.infer<typeof changeColumnTypeResultSchema>;

export const revertColumnTypeRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    snapshotId: slugIdSchema,
  })
  .strict();
export type RevertColumnTypeRequest = z.infer<typeof revertColumnTypeRequestSchema>;

export const revertColumnTypeResultSchema = z
  .object({
    /** Values put back from the snapshot. */
    restored: z.number().int().min(0),
    /** Values of the converted type that were removed because the item had none before. */
    removed: z.number().int().min(0),
    snapshotId: slugIdSchema,
    columnId: slugIdSchema,
  })
  .strict();
export type RevertColumnTypeResult = z.infer<typeof revertColumnTypeResultSchema>;

/** Lifecycle of `boards/{id}/columnSnapshots/{snapshotId}` (Functions-only). */
export const columnSnapshotStatusSchema = z.enum(['writing', 'ready', 'applied', 'reverted']);
export type ColumnSnapshotStatus = z.infer<typeof columnSnapshotStatusSchema>;
