import { mcpAuthorizeRequestSchema, mcpAuthorizeResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminMcpStore } from '../mcp/oauth/admin-store';
import { authorizeRequest } from '../mcp/oauth/consent';

/** Allow or deny an MCP authorization request from the `/connect` consent page (OPS4 step 4). */
export const mcpAuthorize = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(mcpAuthorizeRequestSchema, request.data, 'mcpAuthorize');
  const result = await authorizeRequest(adminMcpStore(db()), Date.now(), actor.uid, input);
  return mcpAuthorizeResultSchema.parse(result);
});
