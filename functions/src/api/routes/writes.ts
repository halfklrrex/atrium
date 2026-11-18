import type { McpService } from '@atrium/mcp-core';
import { z } from 'zod';
import { noteBoard, type RouteDef } from './types';

/**
 * The write routes (P8 section 4, scope `write`). Every one calls the same service method as the matching
 * MCP tool, so membership, roles, locked and required columns, derived and server-managed columns and
 * the 50-item cap are the service's own checks; nothing here re-implements them. Bodies are validated
 * first with the same limits as the tools. No hard delete and no structure changes in v1.
 */

const MAX_ITEMS = 50;

const name = z.string().trim().min(1).max(500);
const group = z.string().min(1).max(200);
const values = z.record(z.string(), z.unknown());
const idParam = (raw: unknown) => String(raw);

const newItem = z.strictObject({ name, group: group.optional(), values: values.optional() });
const createBody = z.union([
  z.strictObject({ items: z.array(newItem).min(1).max(MAX_ITEMS) }),
  newItem,
]);
const patchBody = z.strictObject({
  name: name.optional(),
  group: group.optional(),
  values: values.optional(),
});
const subitemsBody = z.strictObject({
  items: z
    .array(z.strictObject({ name, values: values.optional() }))
    .min(1)
    .max(MAX_ITEMS),
});
const updateBody = z.strictObject({ text: z.string().trim().min(1).max(50000) });
const hint = z.object({ board: z.string().min(1).max(128).optional() });

const parseBody = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> =>
  schema.parse(body ?? {});

/** The same shape `GET /items/{id}` returns. */
async function readItem(service: McpService, boardId: string, itemId: string) {
  return service.getItem({ itemId, boardId });
}

async function readItems(service: McpService, boardId: string, ids: string[]) {
  const out: unknown[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    out.push(
      ...(await Promise.all(ids.slice(i, i + 10).map((id) => readItem(service, boardId, id)))),
    );
  }
  return out;
}

const locate = async (
  service: McpService,
  query: unknown,
  itemId: string,
): Promise<{ boardId: string }> => {
  const { board } = hint.parse(query);
  return service.locateItem({ itemId, ...(board ? { boardId: board } : {}) });
};

export const writeRoutes: RouteDef[] = [
  {
    method: 'post',
    path: '/boards/:id/items',
    scope: 'write',
    async handler({ req, res, service }) {
      const boardId = idParam(req.params.id);
      noteBoard(res, boardId);
      const body = parseBody(createBody, req.body);
      const batch = 'items' in body;
      const { created } = await service.createItems({
        boardId,
        items: batch ? body.items : [body],
      });
      const items = await readItems(
        service,
        boardId,
        created.map((c) => c.id),
      );
      res.status(201);
      return batch ? { boardId, items } : items[0];
    },
  },
  {
    method: 'patch',
    path: '/items/:id',
    scope: 'write',
    async handler({ req, res, service }) {
      const itemId = idParam(req.params.id);
      const body = parseBody(patchBody, req.body);
      const { boardId } = await locate(service, req.query, itemId);
      noteBoard(res, boardId);
      await service.updateItem({ boardId, itemId, ...body });
      return readItem(service, boardId, itemId);
    },
  },
  {
    method: 'post',
    path: '/items/:id/subitems',
    scope: 'write',
    async handler({ req, res, service }) {
      const itemId = idParam(req.params.id);
      const body = parseBody(subitemsBody, req.body);
      const { boardId } = await locate(service, req.query, itemId);
      noteBoard(res, boardId);
      const result = (await service.createSubitems({
        boardId,
        itemId,
        subitems: body.items,
      })) as { created: { id: string }[] };
      const items = await readItems(
        service,
        boardId,
        result.created.map((c) => c.id),
      );
      res.status(201);
      return { boardId, parentItemId: itemId, items };
    },
  },
  {
    method: 'post',
    path: '/items/:id/duplicate',
    scope: 'write',
    async handler({ req, res, service }) {
      const itemId = idParam(req.params.id);
      parseBody(z.strictObject({}), req.body);
      const { boardId } = await locate(service, req.query, itemId);
      noteBoard(res, boardId);
      const copy = (await service.duplicateItem({ boardId, itemId })) as { id: string };
      res.status(201);
      return readItem(service, boardId, copy.id);
    },
  },
  {
    method: 'post',
    path: '/items/:id/archive',
    scope: 'write',
    async handler({ req, res, service }) {
      const itemId = idParam(req.params.id);
      parseBody(z.strictObject({}), req.body);
      const { boardId } = await locate(service, req.query, itemId);
      noteBoard(res, boardId);
      // The item is gone from `GET /items/{id}` once archived, so the answer is the service's own.
      const done = (await service.setItemState({ boardId, itemId, state: 'archived' })) as Record<
        string,
        unknown
      >;
      return { ...done, boardId };
    },
  },
  {
    method: 'post',
    path: '/items/:id/updates',
    scope: 'write',
    async handler({ req, res, service }) {
      const itemId = idParam(req.params.id);
      const body = parseBody(updateBody, req.body);
      const { boardId } = await locate(service, req.query, itemId);
      noteBoard(res, boardId);
      const posted = (await service.addUpdate({ boardId, itemId, text: body.text })) as {
        id: string;
      };
      // The same shape `GET /items/{id}/updates` lists; the newest post is the one just made.
      const listed = (await service.listUpdates({
        boardId,
        itemId,
        limit: 10,
        includeReplies: false,
      })) as { updates: { id: string }[] };
      res.status(201);
      return listed.updates.find((u) => u.id === posted.id) ?? posted;
    },
  },
];
