import { z } from 'zod';
import { boardKindSchema, boardRoleSchema } from '../roles';

/** Callable names, shared so client and server cannot drift. */
export const SET_BOARD_ACCESS_CALLABLE = 'setBoardAccess';
export const SET_BOARD_KIND_CALLABLE = 'setBoardKind';
export const LEAVE_BOARD_CALLABLE = 'leaveBoard';

const boardIdSchema = z.string().min(1).max(64);

/** `role: null` removes the person from the board. */
export const setBoardAccessRequestSchema = z
  .object({
    boardId: boardIdSchema,
    uid: z.string().min(1).max(128),
    role: boardRoleSchema.nullable(),
  })
  .strict();
export type SetBoardAccessRequest = z.infer<typeof setBoardAccessRequestSchema>;

export const setBoardKindRequestSchema = z
  .object({ boardId: boardIdSchema, kind: boardKindSchema })
  .strict();
export type SetBoardKindRequest = z.infer<typeof setBoardKindRequestSchema>;

export const leaveBoardRequestSchema = z.object({ boardId: boardIdSchema }).strict();
export type LeaveBoardRequest = z.infer<typeof leaveBoardRequestSchema>;

/** Every board sharing callable returns the board's resulting kind and explicit access map. */
export const boardSharingResultSchema = z.object({
  kind: boardKindSchema,
  access: z.record(z.string(), boardRoleSchema),
});
export type BoardSharingResult = z.infer<typeof boardSharingResultSchema>;
