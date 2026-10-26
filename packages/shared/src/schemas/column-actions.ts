import { z } from 'zod';

export const startTimeTrackingRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    itemId: z.string().min(1).max(64),
    columnId: z.string().min(1).max(64),
    note: z.string().max(500).optional(),
  })
  .strict();
export type StartTimeTrackingRequest = z.infer<typeof startTimeTrackingRequestSchema>;

export const startTimeTrackingResultSchema = z
  .object({
    success: z.literal(true),
    sessionId: z.string().min(1),
    startedAt: z.number().int().positive(),
  })
  .strict();
export type StartTimeTrackingResult = z.infer<typeof startTimeTrackingResultSchema>;

export const stopTimeTrackingRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    itemId: z.string().min(1).max(64),
    columnId: z.string().min(1).max(64),
    /** Optional sessionId of the active session being stopped (allows idempotent retries). */
    sessionId: z.string().min(1).max(64).optional(),
  })
  .strict();
export type StopTimeTrackingRequest = z.infer<typeof stopTimeTrackingRequestSchema>;

export const stopTimeTrackingResultSchema = z
  .object({
    success: z.literal(true),
    duration: z.number().int().min(0),
    stoppedAt: z.number().int().positive(),
  })
  .strict();
export type StopTimeTrackingResult = z.infer<typeof stopTimeTrackingResultSchema>;

export const clickButtonRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    itemId: z.string().min(1).max(64),
    columnId: z.string().min(1).max(64),
  })
  .strict();
export type ClickButtonRequest = z.infer<typeof clickButtonRequestSchema>;

export const clickButtonResultSchema = z
  .object({
    success: z.literal(true),
    activityId: z.string().min(1),
    timestamp: z.number().int().positive(),
  })
  .strict();
export type ClickButtonResult = z.infer<typeof clickButtonResultSchema>;
