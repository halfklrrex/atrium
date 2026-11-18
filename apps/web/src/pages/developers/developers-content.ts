import {
  INCOMING_HOOK_BASE_URL,
  INCOMING_HOOK_BODY_MAX_BYTES,
  INCOMING_HOOK_CALLS_PER_MINUTE,
  INCOMING_HOOK_DAILY_CALLS,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_PAYLOAD_MAX_BYTES,
  WEBHOOK_RETRY_DELAYS_MS,
  WEBHOOK_SIGNATURE_VERSION,
  WEBHOOK_USER_AGENT,
} from '@atrium/shared';

/**
 * The text of the public developer page (`/developers`), kept apart from the page so tests can pin its
 * facts. The routes are checked against `functions/src/api/routes/*` and the limits against
 * `functions/src/api/limits.ts` by `scripts/api-parity.test.mjs`; change this file in the same PR as
 * the behavior. No real person, token or secret belongs here (public repository).
 */

export const API_BASE_URL = 'https://atrium-workboards.web.app/api/v1';
export const OPENAPI_PATH = '/api/v1/openapi.json';

/** Mirrors `API_CALLS_PER_MINUTE`, `API_DAILY_CALLS`, `API_DAILY_WRITES` in functions/src/api/limits.ts. */
export const API_CALLS_PER_MINUTE = 120;
export const API_DAILY_CALLS = 5000;
export const API_DAILY_WRITES = 1000;
/** Mirrors `IDEMPOTENCY_TTL_MS` (24 hours). */
export const IDEMPOTENCY_HOURS = 24;
/** What receivers should accept: older timestamps are rejected (replay protection). */
export const WEBHOOK_TIMESTAMP_TOLERANCE_MINUTES = 5;

export const WEBHOOK_RETRY_LABELS = WEBHOOK_RETRY_DELAYS_MS.map((ms) =>
  ms >= 3_600_000 ? `${ms / 3_600_000} h` : `${ms / 60_000} min`,
);

export interface ApiRouteDoc {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  scope: 'read' | 'write';
  summary: string;
}

/** One row per route, in `{id}` form. Must match the routes folder exactly (the parity test). */
export const API_ROUTES: ApiRouteDoc[] = [
  {
    method: 'GET',
    path: '/me',
    scope: 'read',
    summary: 'The caller, the token and its workspaces',
  },
  { method: 'GET', path: '/workspaces', scope: 'read', summary: 'List workspaces' },
  {
    method: 'GET',
    path: '/workspaces/{id}/boards',
    scope: 'read',
    summary: 'List the boards of a workspace (?state=active|archived)',
  },
  {
    method: 'GET',
    path: '/boards/{id}',
    scope: 'read',
    summary: 'A board: columns, groups, labels',
  },
  {
    method: 'GET',
    path: '/boards/{id}/items',
    scope: 'read',
    summary: 'List items (?group=, ?limit=, ?cursor=)',
  },
  { method: 'GET', path: '/boards/{id}/members', scope: 'read', summary: 'List board members' },
  { method: 'GET', path: '/items/{id}', scope: 'read', summary: 'Get an item' },
  {
    method: 'GET',
    path: '/items/{id}/updates',
    scope: 'read',
    summary: 'List the updates on an item',
  },
  {
    method: 'POST',
    path: '/boards/{id}/items',
    scope: 'write',
    summary: 'Create items (up to 50)',
  },
  { method: 'PATCH', path: '/items/{id}', scope: 'write', summary: 'Change an item' },
  { method: 'POST', path: '/items/{id}/subitems', scope: 'write', summary: 'Create subitems' },
  { method: 'POST', path: '/items/{id}/duplicate', scope: 'write', summary: 'Duplicate an item' },
  { method: 'POST', path: '/items/{id}/archive', scope: 'write', summary: 'Archive an item' },
  { method: 'POST', path: '/items/{id}/updates', scope: 'write', summary: 'Post an update' },
];

export interface ErrorCodeDoc {
  code: string;
  status: string;
  meaning: string;
}

/** Mirrors `ApiErrorCode` in functions/src/api/errors.ts. */
export const API_ERROR_CODES: ErrorCodeDoc[] = [
  {
    code: 'invalid',
    status: '400, 413, 422',
    meaning: 'The request is wrong: a field, a cursor, the body, or a reused Idempotency-Key.',
  },
  {
    code: 'unauthorized',
    status: '401',
    meaning: 'The token is missing, wrong, expired or revoked.',
  },
  {
    code: 'forbidden',
    status: '403',
    meaning: 'The token lacks Read, or you lack the role for this.',
  },
  { code: 'read_only', status: '403', meaning: 'A write with a token that only allows Read.' },
  {
    code: 'not_found',
    status: '404',
    meaning: "No such board or item, or it is outside the token's workspaces.",
  },
  {
    code: 'conflict',
    status: '409',
    meaning:
      'The data changed while the request ran, or the same Idempotency-Key is still running. Try again.',
  },
  {
    code: 'rate_limited',
    status: '429',
    meaning: 'Over a limit. Wait for the Retry-After seconds.',
  },
  {
    code: 'internal',
    status: '500',
    meaning: 'Something broke on the server. The message never says what.',
  },
  { code: 'api_disabled', status: '503', meaning: 'The API is switched off.' },
];

export const ERROR_EXAMPLE = `{
  "error": {
    "code": "not_found",
    "message": "Board \\"b9\\" was not found."
  }
}`;

export const CURL_READ = `export ATRIUM_TOKEN="<your token>"

curl -H "Authorization: Bearer $ATRIUM_TOKEN" \\
  ${API_BASE_URL}/workspaces`;

export const CURL_WRITE = `curl -X POST ${API_BASE_URL}/boards/BOARD_ID/items \\
  -H "Authorization: Bearer $ATRIUM_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: weekly-report-2026-11-18" \\
  -d '{ "name": "Water the plants", "group": "GROUP_ID" }'`;

export const WEBHOOK_PAYLOAD_EXAMPLE = `{
  "id": "evt_01HZX3",
  "type": "value_changed",
  "createdAt": "2026-11-18T10:15:00.000Z",
  "boardId": "BOARD_ID",
  "itemId": "ITEM_ID",
  "itemName": "Water the plants",
  "columnId": "status",
  "actor": { "id": "USER_ID", "name": "Avery Quinn" },
  "data": { "from": "Working on it", "to": "Done" }
}`;

export const WEBHOOK_HEADERS: { name: string; value: string }[] = [
  { name: 'Content-Type', value: 'application/json' },
  { name: 'User-Agent', value: WEBHOOK_USER_AGENT },
  {
    name: 'Atrium-Event-Id',
    value: 'The event id; the same on every retry. Use it to ignore duplicates.',
  },
  { name: 'Atrium-Event-Type', value: 'The event kind, such as item_created or value_changed.' },
  { name: 'Atrium-Timestamp', value: 'Unix time in seconds when this attempt was signed.' },
  {
    name: 'Atrium-Signature',
    value: `${WEBHOOK_SIGNATURE_VERSION}=<hex>: HMAC-SHA256 of "<timestamp>.<body>"`,
  },
];

export const VERIFY_NODE = `import { createHmac, timingSafeEqual } from 'node:crypto';

// \`rawBody\` is the request body exactly as received (a string), not re-serialized JSON.
export function verify(secret, headers, rawBody) {
  const timestamp = headers['atrium-timestamp'];
  const signature = headers['atrium-signature'] ?? '';
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > ${WEBHOOK_TIMESTAMP_TOLERANCE_MINUTES} * 60) return false;
  const expected =
    '${WEBHOOK_SIGNATURE_VERSION}=' + createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}`;

export const VERIFY_PYTHON = `import hashlib, hmac, time

def verify(secret: str, headers: dict, raw_body: bytes) -> bool:
    timestamp = headers["Atrium-Timestamp"]
    signature = headers.get("Atrium-Signature", "")
    if abs(time.time() - int(timestamp)) > ${WEBHOOK_TIMESTAMP_TOLERANCE_MINUTES} * 60:
        return False
    signed = timestamp.encode() + b"." + raw_body
    expected = "${WEBHOOK_SIGNATURE_VERSION}=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)`;

export const VERIFY_SHELL = `# TS = Atrium-Timestamp header, BODY = the raw body, SECRET = the whsec_ secret
printf '%s.%s' "$TS" "$BODY" \\
  | openssl dgst -sha256 -hmac "$SECRET" -r \\
  | cut -d' ' -f1
# Compare "${WEBHOOK_SIGNATURE_VERSION}=" + that output with the Atrium-Signature header.`;

export const WEBHOOK_FACTS = {
  disableAfterFailures: WEBHOOK_DISABLE_AFTER_FAILURES,
  payloadMaxKb: WEBHOOK_PAYLOAD_MAX_BYTES / 1024,
  signatureVersion: WEBHOOK_SIGNATURE_VERSION,
};

/** The incoming-webhook route (`functions/src/api/hooks.ts`); it is outside `/api/v1`, so it is not in API_ROUTES. */
export const INCOMING_HOOK_PATH = '/api/hooks/{token}';

export const INCOMING_HOOK_FACTS = {
  callsPerMinute: INCOMING_HOOK_CALLS_PER_MINUTE,
  dailyCalls: INCOMING_HOOK_DAILY_CALLS,
  bodyMaxKb: INCOMING_HOOK_BODY_MAX_BYTES / 1024,
};

export const CURL_INCOMING_HOOK = `curl -X POST ${INCOMING_HOOK_BASE_URL}HOOK_ID.SECRET \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042" \\
  -d '{ "name": "Order 1042", "group": "New", "values": { "Status": "Working on it", "Notes": "Paid by card" } }'`;

export const INCOMING_HOOK_RESPONSE_EXAMPLE = `{ "id": "ITEM_ID", "boardId": "BOARD_ID" }`;

export const INCOMING_HOOK_FIELDS: { name: string; meaning: string }[] = [
  { name: 'name', meaning: 'Required. The new item name, 1 to 255 characters.' },
  {
    name: 'values',
    meaning:
      'Optional. An object of cell values keyed by column id or column title, in the same format as the API.',
  },
  {
    name: 'group',
    meaning:
      "Optional. A group id or title. Without it the item goes to the hook's default group, or the board's first group.",
  },
];

export const INCOMING_HOOK_RESPONSES: { status: string; meaning: string }[] = [
  { status: '201', meaning: 'The item was created. The body is the new item id and the board id.' },
  {
    status: '400',
    meaning:
      'The body or a value is wrong, or you named a locked, calculated or Atrium-managed column. Nothing is created.',
  },
  {
    status: '404',
    meaning:
      'Unknown, disabled or wrong URL. It is always the same answer, so a guess learns nothing.',
  },
  {
    status: '409',
    meaning:
      'The data changed while the call ran, or its Idempotency-Key is still running. Try again.',
  },
  { status: '413', meaning: `The body is over ${INCOMING_HOOK_BODY_MAX_BYTES / 1024} KB.` },
  { status: '422', meaning: 'The Idempotency-Key was used with a different body.' },
  {
    status: '429',
    meaning: 'Over the limit for this hook. Wait for the Retry-After seconds.',
  },
  { status: '503', meaning: 'Incoming webhooks are switched off.' },
];
