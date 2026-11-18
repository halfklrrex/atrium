import {
  WEBHOOK_PAYLOAD_MAX_BYTES,
  WEBHOOK_TEXT_MAX,
  type WebhookEventPayload,
} from '@atrium/shared';

/** The slice of an activity entry the payload is built from. */
export interface ActivityInput {
  kind: string;
  actorId: string;
  actorName: string;
  itemId: string | null;
  itemName: string | null;
  columnId: string | null;
  /** The entry's `data` map. */
  data: Record<string, unknown>;
  /** Epoch milliseconds of `createdAt`; null when the entry has none yet (the producer then uses now). */
  createdAtMs: number | null;
}

const MAX_DEPTH = 6;

const clip = (text: string): string =>
  text.length > WEBHOOK_TEXT_MAX ? `${text.slice(0, WEBHOOK_TEXT_MAX - 1)}…` : text;

/** Strings clipped to the text limit at any depth; depth is capped so a hostile value can't recurse. */
export function clipValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return clip(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clipValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    out[clip(key)] = clipValue(v, depth + 1);
  }
  return out;
}

/** Extra `data` keys carried through as they are (clipped). Ids, names and enums only. */
const PASS_THROUGH = [
  'snippet',
  'more',
  'fromRole',
  'toRole',
  'targetUid',
  'targetName',
  'fromKind',
  'toKind',
  'fromGroupTitle',
  'automationId',
] as const;

const EMAIL = /\S+@\S+/;

/** Display names can fall back to an email address; a payload never carries one. */
const safeName = (name: string): string => (EMAIL.test(name) ? 'A member' : clip(name));

export function buildEventData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const from = data.fromValue !== undefined ? data.fromValue : data.fromText;
  const to = data.toValue !== undefined ? data.toValue : data.toText;
  if (from !== undefined) out.from = clipValue(from);
  if (to !== undefined) out.to = clipValue(to);
  for (const key of PASS_THROUGH) {
    if (data[key] !== undefined) out[key] = clipValue(data[key]);
  }
  return out;
}

export interface BuiltPayload {
  /** The JSON text that is signed and sent. */
  body: string;
  payload: WebhookEventPayload;
}

export function buildEventPayload(args: {
  eventId: string;
  boardId: string;
  activity: ActivityInput;
  nowMs: number;
}): BuiltPayload {
  const { activity } = args;
  const payload: WebhookEventPayload = {
    id: args.eventId,
    type: activity.kind,
    createdAt: new Date(activity.createdAtMs ?? args.nowMs).toISOString(),
    boardId: args.boardId,
    itemId: activity.itemId,
    itemName: activity.itemName === null ? null : clip(activity.itemName),
    columnId: activity.columnId,
    actor: { id: activity.actorId, name: safeName(activity.actorName) },
    data: buildEventData(activity.data),
  };
  return capPayload(payload);
}

/** Over 64 KB: the values go and `data.truncated` says so; the envelope always fits. */
export function capPayload(payload: WebhookEventPayload): BuiltPayload {
  let body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > WEBHOOK_PAYLOAD_MAX_BYTES) {
    const slim: WebhookEventPayload = { ...payload, data: { truncated: true } };
    body = JSON.stringify(slim);
    return { body, payload: slim };
  }
  return { body, payload };
}

/** The body of a `ping` (the Test button). */
export function buildPingPayload(args: {
  eventId: string;
  boardId: string;
  webhookId: string;
  actorId: string;
  actorName: string;
  nowMs: number;
}): BuiltPayload {
  return capPayload({
    id: args.eventId,
    type: 'ping',
    createdAt: new Date(args.nowMs).toISOString(),
    boardId: args.boardId,
    itemId: null,
    itemName: null,
    columnId: null,
    actor: { id: args.actorId, name: safeName(args.actorName) },
    data: { webhookId: args.webhookId },
  });
}
