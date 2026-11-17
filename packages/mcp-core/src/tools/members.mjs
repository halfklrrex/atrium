// Tool catalogue: workspace members.
import { z } from 'zod';
import { id, read, workspaceId } from './helpers.mjs';

/** @param {ReturnType<typeof import('../service.mjs').createService>} service */
export const memberTools = (service) => [
  read({
    name: 'atrium_find_member',
    description:
      'Read-only. Finds a member of a workspace by email address (exact match, case-insensitive): uid, name, email and role, ' +
      'or found: false. Only workspace members are searched; a person outside the workspace and an unknown address look the same. ' +
      'workspaceId may be left out when you are a member of exactly one workspace.',
    inputSchema: { email: z.string().trim().min(3).max(320), workspaceId },
    run: (args) => service.findMember(args),
  }),
  read({
    name: 'atrium_list_members',
    description:
      'Read-only. Lists the members of a workspace (uid, name, email, role); with boardId only those who can see that board. ' +
      'Use the uids in People cells and the names in @[Name] mentions.',
    inputSchema: { boardId: id.optional(), workspaceId },
    run: (args) => service.listMembers(args),
  }),
  read({
    name: 'atrium_list_teams',
    description:
      'Read-only. Lists the teams of a workspace (id, name, color, members with uid and name), by name. ' +
      'Assign a team in a People cell with "team:<name or id>". Any workspace member may list teams. ' +
      'workspaceId may be left out when you are a member of exactly one workspace.',
    inputSchema: { workspaceId },
    run: (args) => service.listTeams(args),
  }),
];
