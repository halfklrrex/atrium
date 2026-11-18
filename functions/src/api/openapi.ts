import { z } from 'zod';
import {
  API_CALLS_PER_MINUTE,
  API_DAILY_CALLS,
  API_DAILY_WRITES,
  API_MINUTE_RETRY_SECONDS,
} from './limits';
import { IDEMPOTENCY_TTL_MS } from './idempotency';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './routes/paging';
import { createBody, patchBody, subitemsBody, updateBody } from './routes/writes';

/**
 * The OpenAPI 3.1 description of the public API (P8 section 4), built in code. Request bodies come from
 * the same zod schemas the write routes validate with, so they cannot drift. Each operation is keyed
 * `'METHOD /path'` with `{id}` path parameters; `scripts/api-parity.test.mjs` fails when a route has no
 * entry here or an entry has no route.
 */

type Json = Record<string, unknown>;

const bodySchema = (schema: z.ZodType): Json => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Json;
  return rest;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorRef = (name: string) => ({ $ref: `#/components/responses/${name}` });
const param = (name: string) => ({ $ref: `#/components/parameters/${name}` });

const jsonResponse = (description: string, schema: Json) => ({
  description,
  content: { 'application/json': { schema } },
});

const anyObject = (description: string): Json => ({
  type: 'object',
  additionalProperties: true,
  description,
});

const ERROR_CODES = [
  'not_found',
  'forbidden',
  'invalid',
  'conflict',
  'rate_limited',
  'read_only',
  'unauthorized',
  'api_disabled',
  'internal',
] as const;

const readErrors = {
  '400': errorRef('Invalid'),
  '401': errorRef('Unauthorized'),
  '403': errorRef('Forbidden'),
  '404': errorRef('NotFound'),
  '429': errorRef('RateLimited'),
  '503': errorRef('Disabled'),
};
const writeErrors = {
  ...readErrors,
  '409': errorRef('Conflict'),
  '422': errorRef('IdempotencyMismatch'),
};

interface Operation {
  summary: string;
  description?: string;
  scope: 'read' | 'write';
  parameters?: Json[];
  requestBody?: Json;
  success: { status: '200' | '201'; description: string; schema: Json };
  tag: string;
}

const itemHint = param('BoardHint');
const idempotency = param('IdempotencyKey');

const itemSchema = anyObject(
  'An item: id, name, group, state, and its values keyed by column title.',
);
const itemsListSchema: Json = {
  type: 'object',
  properties: {
    boardId: { type: 'string' },
    items: { type: 'array', items: itemSchema },
  },
  required: ['boardId', 'items'],
};

/** Every operation. Keep one entry per route: the parity test enforces it. */
const OPERATIONS: Record<string, Operation> = {
  'GET /me': {
    summary: 'The caller and the token',
    description: 'Who the token acts as, its scopes and workspaces, and the workspaces it can use.',
    scope: 'read',
    tag: 'Account',
    success: { status: '200', description: 'The caller.', schema: ref('Me') },
  },
  'GET /workspaces': {
    summary: 'List workspaces',
    scope: 'read',
    tag: 'Account',
    success: {
      status: '200',
      description: 'The workspaces the token may use.',
      schema: anyObject('A `workspaces` array.'),
    },
  },
  'GET /workspaces/{id}/boards': {
    summary: 'List the boards of a workspace',
    scope: 'read',
    tag: 'Boards',
    parameters: [
      param('Id'),
      {
        name: 'state',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['active', 'archived'] },
      },
    ],
    success: {
      status: '200',
      description: 'The boards.',
      schema: anyObject('A `boards` array.'),
    },
  },
  'GET /boards/{id}': {
    summary: 'Get a board',
    description: 'Columns, groups and labels. Items come from `/boards/{id}/items`.',
    scope: 'read',
    tag: 'Boards',
    parameters: [param('Id')],
    success: { status: '200', description: 'The board.', schema: anyObject('The board.') },
  },
  'GET /boards/{id}/items': {
    summary: 'List the items of a board',
    description: `Paged: \`limit\` defaults to ${DEFAULT_PAGE_SIZE} and is cut to ${MAX_PAGE_SIZE}. Pass \`nextCursor\` back as \`cursor\` for the next page.`,
    scope: 'read',
    tag: 'Boards',
    parameters: [
      param('Id'),
      { name: 'group', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
      },
    ],
    success: { status: '200', description: 'One page of items.', schema: ref('ItemPage') },
  },
  'GET /boards/{id}/members': {
    summary: 'List the members of a board',
    description: 'Display names and ids only; email addresses are never returned.',
    scope: 'read',
    tag: 'Boards',
    parameters: [param('Id')],
    success: {
      status: '200',
      description: 'The members.',
      schema: anyObject('A `members` array.'),
    },
  },
  'GET /items/{id}': {
    summary: 'Get an item',
    scope: 'read',
    tag: 'Items',
    parameters: [param('Id'), itemHint],
    success: { status: '200', description: 'The item.', schema: itemSchema },
  },
  'GET /items/{id}/updates': {
    summary: 'List the updates (comments) on an item',
    scope: 'read',
    tag: 'Items',
    parameters: [
      param('Id'),
      itemHint,
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      {
        name: 'replies',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['true', 'false'], default: 'true' },
      },
    ],
    success: {
      status: '200',
      description: 'The updates.',
      schema: anyObject('An `updates` array.'),
    },
  },
  'POST /boards/{id}/items': {
    summary: 'Create items',
    description:
      'Send one item (`name`, `group`, `values`) or `{ "items": [...] }` with up to 50. Answers 201 with the item, or with `{ boardId, items }` for a batch.',
    scope: 'write',
    tag: 'Items',
    parameters: [param('Id'), idempotency],
    requestBody: { required: true, schema: bodySchema(createBody) },
    success: {
      status: '201',
      description: 'The created item(s).',
      schema: anyObject('An item, or `{ boardId, items }`.'),
    },
  },
  'PATCH /items/{id}': {
    summary: 'Update an item',
    description: 'Changes only the fields and column values sent.',
    scope: 'write',
    tag: 'Items',
    parameters: [param('Id'), itemHint],
    requestBody: { required: true, schema: bodySchema(patchBody) },
    success: { status: '200', description: 'The item after the change.', schema: itemSchema },
  },
  'POST /items/{id}/subitems': {
    summary: 'Create subitems',
    scope: 'write',
    tag: 'Items',
    parameters: [param('Id'), itemHint, idempotency],
    requestBody: { required: true, schema: bodySchema(subitemsBody) },
    success: { status: '201', description: 'The created subitems.', schema: itemsListSchema },
  },
  'POST /items/{id}/duplicate': {
    summary: 'Duplicate an item',
    scope: 'write',
    tag: 'Items',
    parameters: [param('Id'), itemHint, idempotency],
    requestBody: { required: false, schema: { type: 'object', additionalProperties: false } },
    success: { status: '201', description: 'The copy.', schema: itemSchema },
  },
  'POST /items/{id}/archive': {
    summary: 'Archive an item',
    description: 'Archiving is reversible in the app. There is no hard delete in the API.',
    scope: 'write',
    tag: 'Items',
    parameters: [param('Id'), itemHint, idempotency],
    requestBody: { required: false, schema: { type: 'object', additionalProperties: false } },
    success: {
      status: '200',
      description: 'The result.',
      schema: anyObject('The archived item and its board.'),
    },
  },
  'POST /items/{id}/updates': {
    summary: 'Post an update (comment) on an item',
    scope: 'write',
    tag: 'Items',
    parameters: [param('Id'), itemHint, idempotency],
    requestBody: { required: true, schema: bodySchema(updateBody) },
    success: { status: '201', description: 'The new update.', schema: anyObject('The update.') },
  },
};

const retryAfter = {
  'Retry-After': {
    description: 'Seconds to wait before trying again.',
    schema: { type: 'integer' },
  },
};

const errorResponse = (description: string, extra: Json = {}) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
  ...extra,
});

export function buildOpenApiDocument(): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const [key, op] of Object.entries(OPERATIONS)) {
    const [method, path] = key.split(' ') as [string, string];
    const write = method !== 'GET';
    const operation: Json = {
      operationId: `${method.toLowerCase()}${path
        .split('/')
        .filter(Boolean)
        .map((part) => part.replace(/[{}]/g, ''))
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')}`,
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      tags: [op.tag],
      security: [{ bearerAuth: [op.scope] }],
      ...(op.parameters ? { parameters: op.parameters } : {}),
      ...(op.requestBody
        ? {
            requestBody: {
              required: op.requestBody.required,
              content: { 'application/json': { schema: op.requestBody.schema } },
            },
          }
        : {}),
      responses: {
        [op.success.status]: jsonResponse(op.success.description, op.success.schema),
        ...(write ? writeErrors : readErrors),
      },
    };
    (paths[path] ??= {})[method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Atrium API',
      version: '1',
      description: `Personal-token API for Atrium. Each token allows ${API_CALLS_PER_MINUTE} calls a minute, ${API_DAILY_CALLS} calls a day and ${API_DAILY_WRITES} writes a day. Send \`Idempotency-Key\` on POST to make a retry safe (kept ${IDEMPOTENCY_TTL_MS / 3600000} hours).`,
    },
    servers: [{ url: 'https://atrium-workboards.web.app/api/v1' }],
    tags: [{ name: 'Account' }, { name: 'Boards' }, { name: 'Items' }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A personal token from Settings > Account > API tokens, sent as `Authorization: Bearer <token>`. Scope `read` allows GET; `write` allows POST and PATCH.',
        },
      },
      parameters: {
        Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        BoardHint: {
          name: 'board',
          in: 'query',
          required: false,
          description: "The item's board id. Optional; it skips the search for the item.",
          schema: { type: 'string', minLength: 1, maxLength: 128 },
        },
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description:
            '1 to 64 characters: letters, digits, "-" or "_". The same key with the same request replays the first answer (`Idempotency-Replayed: true`); a different request with it is refused with 422.',
          schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: [...ERROR_CODES] },
                message: { type: 'string' },
              },
            },
          },
        },
        Me: anyObject('`uid`, `auth` (kind, scopes, workspaceIds, tokenId) and `workspaces`.'),
        ItemPage: {
          type: 'object',
          properties: {
            boardId: { type: 'string' },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            items: { type: 'array', items: itemSchema },
            nextCursor: { type: ['string', 'null'] },
          },
          required: ['boardId', 'total', 'limit', 'items', 'nextCursor'],
        },
      },
      responses: {
        Invalid: errorResponse('The request is invalid (`invalid`).'),
        Unauthorized: errorResponse('Missing, wrong, expired or revoked token (`unauthorized`).', {
          headers: {
            'WWW-Authenticate': {
              schema: { type: 'string' },
              description: 'Bearer realm="atrium"',
            },
          },
        }),
        Forbidden: errorResponse(
          'The token lacks the scope (`forbidden`, or `read_only` for a write), or the caller lacks the role (`forbidden`).',
        ),
        NotFound: errorResponse(
          'No such board, item or route, or outside the token (`not_found`).',
        ),
        Conflict: errorResponse(
          'The data changed, or the Idempotency-Key is still running (`conflict`).',
        ),
        IdempotencyMismatch: errorResponse(
          'The Idempotency-Key was used with a different request (`invalid`).',
        ),
        RateLimited: errorResponse(
          `Over ${API_CALLS_PER_MINUTE} calls a minute (wait ${API_MINUTE_RETRY_SECONDS} seconds), or over the daily cap (wait until 00:00 UTC) (\`rate_limited\`).`,
          { headers: retryAfter },
        ),
        Disabled: errorResponse('The API is switched off (`api_disabled`).'),
      },
    },
  };
}
