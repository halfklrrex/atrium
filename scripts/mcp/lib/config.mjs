// Reads the connector's configuration from the environment. Nothing here is committed: the
// workspace and user ids are per machine (see docs/mcp-connector.md).
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { ID_PATTERN, McpUserError } from './errors.mjs';

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,29}$/;
const DATABASE_PATTERN = /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/;

/**
 * @param {Record<string, string|undefined>} env
 * @returns {{ workspaceId: string, uid: string, project: string, database: string, emulator: string|null }}
 */
export function readConfig(env = process.env) {
  const workspaceId = env.ATRIUM_WORKSPACE_ID?.trim();
  const uid = env.ATRIUM_USER_UID?.trim();
  if (!workspaceId) {
    throw new McpUserError(
      'ATRIUM_WORKSPACE_ID is not set. The Atrium connector only works inside one workspace; ' +
        'see docs/mcp-connector.md. Nothing was written.',
    );
  }
  if (!uid) {
    throw new McpUserError(
      'ATRIUM_USER_UID is not set. Writes are attributed to that Atrium user; see ' +
        'docs/mcp-connector.md. Nothing was written.',
    );
  }
  if (!ID_PATTERN.test(workspaceId))
    throw new McpUserError('ATRIUM_WORKSPACE_ID is not a plain id.');
  if (!ID_PATTERN.test(uid)) throw new McpUserError('ATRIUM_USER_UID is not a plain id.');
  const project = env.ATRIUM_PROJECT?.trim() || 'atrium-board';
  if (!PROJECT_PATTERN.test(project) && !project.startsWith('demo-')) {
    throw new McpUserError(`"${project}" is not a valid Firebase project id.`);
  }
  const database = env.ATRIUM_DATABASE?.trim() || FIRESTORE_DATABASE_ID;
  if (!DATABASE_PATTERN.test(database)) {
    throw new McpUserError(`"${database}" is not a valid Firestore database id.`);
  }
  const emulator = env.ATRIUM_EMULATOR?.trim() || null;
  if (emulator) {
    const host = emulator.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new McpUserError(`ATRIUM_EMULATOR is "${emulator}", which is not a local address.`);
    }
  }
  return { workspaceId, uid, project, database, emulator };
}
