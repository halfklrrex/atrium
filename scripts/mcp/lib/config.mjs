// Reads the stdio connector's configuration from the environment. Nothing here is committed: the
// user id (and the optional workspace filter) are per machine (see docs/mcp-connector.md).
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { ID_PATTERN, McpUserError } from '@atrium/mcp-core';

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,29}$/;
const DATABASE_PATTERN = /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/;

/**
 * @param {Record<string, string|undefined>} env
 * @returns {{ uid: string, workspaceFilter: string|null, project: string, database: string, emulator: string|null }}
 */
export function readConfig(env = process.env) {
  const uid = env.ATRIUM_USER_UID?.trim();
  const workspaceFilter = env.ATRIUM_WORKSPACE_ID?.trim() || null;
  if (!uid) {
    throw new McpUserError(
      'ATRIUM_USER_UID is not set. The connector acts as that Atrium user (their workspace ' +
        'memberships decide which boards it may touch); see docs/mcp-connector.md. Nothing was written.',
    );
  }
  if (!ID_PATTERN.test(uid)) throw new McpUserError('ATRIUM_USER_UID is not a plain id.');
  if (workspaceFilter && !ID_PATTERN.test(workspaceFilter)) {
    throw new McpUserError('ATRIUM_WORKSPACE_ID is not a plain id.');
  }
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
  return { uid, workspaceFilter, project, database, emulator };
}
