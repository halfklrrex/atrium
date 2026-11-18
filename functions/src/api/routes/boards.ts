import { z } from 'zod';
import { noteBoard, type RouteDef } from './types';
import { decodeCursor, encodeCursor, pageQuery } from './paging';

const boardsQuery = z.object({ state: z.enum(['active', 'archived']).optional() });

/** `GET /workspaces/{id}/boards`, `GET /boards/{id}`, `GET /boards/{id}/items`, `GET /boards/{id}/members`. */
export const boardRoutes: RouteDef[] = [
  {
    method: 'get',
    path: '/workspaces/:id/boards',
    scope: 'read',
    async handler({ req, service }) {
      const { state } = boardsQuery.parse(req.query);
      return service.listBoards({
        workspaceId: String(req.params.id),
        ...(state ? { state } : {}),
      });
    },
  },
  {
    method: 'get',
    path: '/boards/:id',
    scope: 'read',
    async handler({ req, res, service }) {
      const boardId = String(req.params.id);
      noteBoard(res, boardId);
      // Columns, groups and labels; the items come from `/boards/{id}/items`.
      return service.getBoard({ boardId, includeItems: false });
    },
  },
  {
    method: 'get',
    path: '/boards/:id/items',
    scope: 'read',
    async handler({ req, res, service }) {
      const boardId = String(req.params.id);
      noteBoard(res, boardId);
      const query = pageQuery.parse(req.query);
      const offset = decodeCursor(query.cursor);
      const page = await service.findItems({
        boardId,
        ...(query.group !== undefined ? { group: query.group } : {}),
        limit: query.limit,
        offset,
        // Two columns may share a title; key rows as `Title (columnId)` for the later one.
        uniqueTitles: true,
      });
      return {
        boardId,
        total: page.total,
        limit: query.limit,
        items: page.items,
        nextCursor: page.nextOffset === undefined ? null : encodeCursor(page.nextOffset),
        ...(page.notes?.length ? { notes: page.notes } : {}),
      };
    },
  },
  {
    method: 'get',
    path: '/boards/:id/members',
    scope: 'read',
    async handler({ req, res, service }) {
      const boardId = String(req.params.id);
      noteBoard(res, boardId);
      const { workspaceId, members } = await service.listMembers({ boardId });
      // Display names and ids only: the API never hands out other people's email addresses.
      return {
        boardId,
        workspaceId,
        members: members.map(({ email: _email, ...rest }) => rest),
      };
    },
  },
];
