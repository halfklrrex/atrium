import { mcpAuthRequestInfoRequestSchema, mcpAuthRequestInfoResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminMcpStore } from '../mcp/oauth/admin-store';
import { authRequestInfo } from '../mcp/oauth/consent';

/** What the `/connect` consent page shows for a pending MCP authorization request (OPS4). */
export const mcpAuthRequestInfo = onCall(async (request) => {
  actorFromRequest(request);
  const input = parseInput(mcpAuthRequestInfoRequestSchema, request.data, 'mcpAuthRequestInfo');
  const result = await authRequestInfo(adminMcpStore(db()), Date.now(), input);
  return mcpAuthRequestInfoResultSchema.parse(result);
});
