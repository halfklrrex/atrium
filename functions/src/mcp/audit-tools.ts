import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { writeMcpAudit } from './oauth/audit';
import type { McpStore } from './oauth/store';

/**
 * One `tool_call` audit entry per tool call (OPS4 section 5): which tool, on which board, whether
 * it worked and how long it took. Never the arguments, the result, a token or any text of the
 * person's. `error` is a short code, not a message.
 */
export type ToolCallErrorCode =
  'user_error' | 'read_only' | 'rate_limited' | 'daily_limit' | 'unexpected';

/** The id fields a tool call may name, in the order the first one found becomes the audit target (a file tool's target is the file; its board is recorded as `boardId`). */
const TARGET_KEYS = ['fileId', 'boardId', 'docId', 'dashboardId', 'teamId', 'viewId'] as const;

/**
 * The first of `fileId`, `boardId`, `docId`, `dashboardId`, `teamId`, `viewId` in a call's arguments, as the
 * entry's `targetKind` (`board`, `doc`, ...) and `targetId` (cut to 64 characters). Only an id is ever
 * recorded, never any other argument.
 */
export function auditTarget(args: unknown): { targetKind: string; targetId: string } | undefined {
  if (!args || typeof args !== 'object') return undefined;
  for (const key of TARGET_KEYS) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === 'string' && value !== '') {
      return { targetKind: key.slice(0, -'Id'.length), targetId: value.slice(0, 64) };
    }
  }
  return undefined;
}

export async function auditToolCall(
  store: Pick<McpStore, 'appendAudit'>,
  now: number,
  auth: AuthInfo,
  call: { tool: string; args: unknown; ms: number; error?: ToolCallErrorCode },
): Promise<void> {
  const target = auditTarget(call.args);
  const boardId =
    call.args && typeof call.args === 'object' && 'boardId' in call.args
      ? (call.args as { boardId?: unknown }).boardId
      : undefined;
  const grantId = auth.extra?.grantId;
  await writeMcpAudit(store, now, {
    kind: 'tool_call',
    uid: String(auth.extra?.uid ?? ''),
    clientId: auth.clientId,
    ...(typeof grantId === 'string' ? { grantId } : {}),
    tool: call.tool,
    ...(typeof boardId === 'string' ? { boardId: boardId.slice(0, 64) } : {}),
    ...(target ?? {}),
    ok: call.error === undefined,
    ...(call.error ? { error: call.error } : {}),
    ms: call.ms,
  });
}
