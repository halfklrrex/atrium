import { logger } from 'firebase-functions/v2';
import { MCP_AUDIT_TTL_MS } from './constants';
import type { McpAuditEntry, McpStore } from './store';

/**
 * One `system/mcpAudit/entries` row per grant event, auth failure and (PR E) tool call, kept 90
 * days by TTL (OPS4 section 5). Best effort: a failed audit write is logged and never fails the
 * request. Never pass a token, a code or an email in `entry`.
 */
export async function writeMcpAudit(
  store: Pick<McpStore, 'appendAudit'>,
  now: number,
  entry: Omit<McpAuditEntry, 'at' | 'expiresAt'>,
): Promise<void> {
  const full: McpAuditEntry = { ...entry, at: now, expiresAt: now + MCP_AUDIT_TTL_MS };
  try {
    await store.appendAudit(full);
  } catch (error) {
    logger.error('Could not write the MCP audit entry', {
      kind: entry.kind,
      uid: entry.uid,
      error,
    });
  }
}
