import { McpUserError, defineTools, type McpService, type ToolDefinition } from '@atrium/mcp-core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from 'firebase-functions/v2';
import { auditToolCall, type ToolCallErrorCode } from './audit-tools';
import { type MinuteLimiter, usageDay, type UsageStore } from './limits';
import type { McpStore } from './oauth/store';

/**
 * The per-request MCP server of the hosted connector (OPS4 section 6, "PR E wiring"). Every tool of
 * `@atrium/mcp-core` is registered with the same description, schema and annotations as the stdio
 * server, wrapped with: the scope check, the usage limits, control-character stripping, error
 * mapping and one audit entry. The wrapper never logs arguments, results or tokens.
 */

export const WRITE_SCOPE = 'atrium:write';
export const READ_ONLY_MESSAGE =
  'This connection is read-only. Reconnect in Atrium and allow Write.';
export const RATE_LIMIT_MESSAGE = 'Too many requests. Wait a minute and try again.';
export const DAILY_LIMIT_MESSAGE = 'Daily limit reached. Try again tomorrow.';
export const UNEXPECTED_MESSAGE = 'Unexpected error';

export interface ServerDeps {
  /** The tool logic for one signed-in user, over all their memberships. */
  createService(uid: string): McpService;
  usage: UsageStore;
  limiter: MinuteLimiter;
  audit: Pick<McpStore, 'appendAudit'>;
  now: () => number;
}

// C0 control characters except tab and line feed (OPS4 section 5, untrusted content).
// eslint-disable-next-line no-control-regex -- the point is to remove control characters
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F]/g;

/** Returns `value` with control characters removed from every string in it (keys included). */
export function stripControlChars<T>(value: T): T {
  if (typeof value === 'string') return value.replace(CONTROL_CHARS, '') as T;
  if (Array.isArray(value)) return value.map(stripControlChars) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key.replace(CONTROL_CHARS, '')] = stripControlChars(entry);
    }
    return out as T;
  }
  return value;
}

const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: stripControlChars(text) }],
});

export function buildServerFor(authInfo: AuthInfo, deps: ServerDeps): McpServer {
  const uid = String(authInfo.extra?.uid ?? '');
  const service = deps.createService(uid);
  const server = new McpServer({ name: 'atrium', version: '1.0.0' });

  const runTool = async (tool: ToolDefinition, args: unknown): Promise<CallToolResult> => {
    const started = deps.now();
    const finish = async (result: CallToolResult, error?: ToolCallErrorCode) => {
      await auditToolCall(deps.audit, deps.now(), authInfo, {
        tool: tool.name,
        args,
        ms: deps.now() - started,
        ...(error ? { error } : {}),
      });
      return result;
    };
    try {
      const write = tool.scope === 'write';
      if (write && !authInfo.scopes.includes(WRITE_SCOPE)) {
        return await finish(errorResult(READ_ONLY_MESSAGE), 'read_only');
      }
      if (!deps.limiter.take(uid)) {
        return await finish(errorResult(RATE_LIMIT_MESSAGE), 'rate_limited');
      }
      const verdict = await deps.usage.consume(uid, usageDay(deps.now()), write);
      if (verdict !== 'ok') return await finish(errorResult(DAILY_LIMIT_MESSAGE), 'daily_limit');
      try {
        const result = await tool.run((args ?? {}) as Record<string, unknown>);
        const text = JSON.stringify(stripControlChars(result)) ?? 'null';
        return await finish({ content: [{ type: 'text', text }] });
      } catch (error) {
        if (error instanceof McpUserError) {
          return await finish(errorResult(error.message), 'user_error');
        }
        throw error;
      }
    } catch (error) {
      // Log the error object only: no arguments, no headers, no token.
      logger.error('MCP tool failed', { tool: tool.name, error });
      return await finish(errorResult(UNEXPECTED_MESSAGE), 'unexpected');
    }
  };

  for (const tool of defineTools(service)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (args: unknown) => runTool(tool, args),
    );
  }
  return server;
}
