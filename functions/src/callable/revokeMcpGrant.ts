import { revokeMcpGrantRequestSchema, revokeMcpGrantResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminMcpStore } from '../mcp/oauth/admin-store';
import { revokeMcpGrant as run } from '../mcp/oauth/grants';

/** Settings -> Connected apps -> Disconnect: revokes one of the caller's own MCP grants (OPS4). */
export const revokeMcpGrant = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(revokeMcpGrantRequestSchema, request.data, 'revokeMcpGrant');
  const result = await run(adminMcpStore(db()), Date.now(), actor.uid, input);
  return revokeMcpGrantResultSchema.parse(result);
});
