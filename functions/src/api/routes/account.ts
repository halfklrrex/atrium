import type { RouteDef } from './types';

/** `GET /me` and `GET /workspaces`. */
export const accountRoutes: RouteDef[] = [
  {
    method: 'get',
    path: '/me',
    scope: 'read',
    async handler({ auth, service }) {
      const { workspaces } = await service.listWorkspaces();
      return {
        uid: auth.uid,
        auth: {
          kind: auth.kind,
          scopes: auth.scopes,
          // `null`: the token may use every workspace its user is a member of.
          workspaceIds: auth.workspaceIds,
          ...(auth.tokenId ? { tokenId: auth.tokenId } : {}),
        },
        workspaces,
      };
    },
  },
  {
    method: 'get',
    path: '/workspaces',
    scope: 'read',
    handler: ({ service }) => service.listWorkspaces(),
  },
];
