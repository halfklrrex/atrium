import { z } from 'zod';
import { noteBoard, type RouteDef } from './types';

const itemQuery = z.object({ board: z.string().min(1).max(128).optional() });
const updatesQuery = itemQuery.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .transform((v) => Math.min(v ?? 20, 100)),
  replies: z.enum(['true', 'false']).optional(),
});

/** `GET /items/{id}` and `GET /items/{id}/updates`. `?board=` is an optional hint that skips the search. */
export const itemRoutes: RouteDef[] = [
  {
    method: 'get',
    path: '/items/:id',
    scope: 'read',
    async handler({ req, res, service }) {
      const { board } = itemQuery.parse(req.query);
      const item = await service.getItem({
        itemId: String(req.params.id),
        ...(board ? { boardId: board } : {}),
      });
      if (typeof item.boardId === 'string') noteBoard(res, item.boardId);
      return item;
    },
  },
  {
    method: 'get',
    path: '/items/:id/updates',
    scope: 'read',
    async handler({ req, res, service }) {
      const { board, limit, replies } = updatesQuery.parse(req.query);
      const itemId = String(req.params.id);
      const located = await service.locateItem({ itemId, ...(board ? { boardId: board } : {}) });
      noteBoard(res, located.boardId);
      return service.listUpdates({
        boardId: located.boardId,
        itemId,
        limit,
        includeReplies: replies !== 'false',
      });
    },
  },
];
