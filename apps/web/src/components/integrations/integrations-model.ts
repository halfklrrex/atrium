import {
  ACTIVITY_KINDS,
  WEBHOOK_EVENT_ALL,
  WEBHOOK_NAME_MAX,
  WEBHOOK_URL_MAX,
  type ActivityKind,
  type CreateWebhookRequest,
  type WebhookDeliveryStatus,
} from '@atrium/shared';
import type { WebhookDoc } from '../../data';

const LOCALE = 'en-US';

/** What the Functions answer (failed-precondition) while `WEBHOOKS_ENABLED` is off. */
export const WEBHOOKS_OFF_MESSAGE = 'Webhooks are not switched on for this site yet.';
/** What the dialog shows in its place. */
export const WEBHOOKS_OFF_NOTICE = "Webhooks aren't switched on yet.";

/** True when a callable error is the "feature is off" refusal rather than another precondition. */
export function isWebhooksOff(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = (error as { message?: string } | null)?.message ?? '';
  return code.endsWith('failed-precondition') && message.includes('not switched on');
}

/** Human labels for the activity kinds a webhook can subscribe to. */
export const EVENT_LABELS: Record<ActivityKind, string> = {
  item_created: 'Item created',
  item_renamed: 'Item renamed',
  item_moved: 'Item moved to another group',
  item_archived: 'Item archived',
  item_deleted: 'Item deleted',
  item_restored: 'Item restored',
  value_changed: 'Value changed',
  column_added: 'Column added',
  column_renamed: 'Column renamed',
  column_deleted: 'Column deleted',
  column_type_changed: 'Column type changed',
  column_type_reverted: 'Column type reverted',
  group_added: 'Group added',
  group_renamed: 'Group renamed',
  group_deleted: 'Group deleted',
  board_renamed: 'Board renamed',
  board_kind_changed: 'Board type changed',
  board_access_changed: 'Board access changed',
  board_left: 'Someone left the board',
  update_posted: 'Update posted',
  button_clicked: 'Button clicked',
  automation_ran: 'Automation ran',
  required_reverted: 'Required values restored',
};

export const ALL_EVENT_KINDS: readonly ActivityKind[] = ACTIVITY_KINDS;

export function eventLabel(kind: string): string {
  if (kind === 'ping') return 'Test ping';
  return EVENT_LABELS[kind as ActivityKind] ?? kind;
}

/** "All events", "Item created", or "Item created and 2 more". */
export function summarizeEvents(events: readonly string[]): string {
  if (events.length === 0) return 'No events';
  if (events.includes(WEBHOOK_EVENT_ALL)) return 'All events';
  const first = eventLabel(events[0]!);
  return events.length === 1 ? first : `${first} and ${events.length - 1} more`;
}

/** Only the host of the receiver is shown in the list: the path and query can carry a secret. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'Invalid address';
  }
}

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Client-side check; the Functions run the real SSRF guard on save and at delivery. */
export function validateWebhookUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Enter the address that should receive events.';
  if (value.length > WEBHOOK_URL_MAX) return `Use ${WEBHOOK_URL_MAX} characters or fewer.`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Use a full https:// address.';
  }
  if (parsed.protocol !== 'https:') return 'Use a full https:// address.';
  if (IPV4_HOST.test(parsed.hostname) || parsed.hostname.startsWith('[')) {
    return 'Use a host name, not an IP address.';
  }
  if (parsed.username || parsed.password)
    return 'Leave the user name and password out of the address.';
  return null;
}

export type WebhookForm = {
  name: string;
  url: string;
  allEvents: boolean;
  events: ActivityKind[];
};

export const EMPTY_WEBHOOK_FORM: WebhookForm = { name: '', url: '', allEvents: true, events: [] };

export function formFromWebhook(hook: WebhookDoc): WebhookForm {
  const all = hook.events.includes(WEBHOOK_EVENT_ALL);
  return {
    name: hook.name,
    url: hook.url,
    allEvents: all,
    events: all
      ? []
      : (hook.events.filter((e) => ALL_EVENT_KINDS.includes(e as ActivityKind)) as ActivityKind[]),
  };
}

export type ParsedWebhookForm =
  { ok: true; value: Omit<CreateWebhookRequest, 'boardId'> } | { ok: false; message: string };

export function parseWebhookForm(form: WebhookForm): ParsedWebhookForm {
  const name = form.name.trim();
  if (!name) return { ok: false, message: 'Give the webhook a name.' };
  if (name.length > WEBHOOK_NAME_MAX) {
    return { ok: false, message: `Use ${WEBHOOK_NAME_MAX} characters or fewer.` };
  }
  const urlProblem = validateWebhookUrl(form.url);
  if (urlProblem) return { ok: false, message: urlProblem };
  if (!form.allEvents && form.events.length === 0) {
    return { ok: false, message: 'Pick at least one event, or choose all events.' };
  }
  return {
    ok: true,
    value: {
      name,
      url: form.url.trim(),
      events: form.allEvents ? [WEBHOOK_EVENT_ALL] : form.events,
    },
  };
}

function shortDateTime(ms: number): string {
  return new Date(ms).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function describeTime(ms: number | null | undefined, empty = 'never'): string {
  return ms == null ? empty : shortDateTime(ms);
}

/** "Active", or "Disabled: <reason>" (a hook switched off by hand has no reason). */
export function describeWebhookStatus(
  hook: Pick<WebhookDoc, 'enabled' | 'disabledReason'>,
): string {
  if (hook.enabled) return 'Active';
  return hook.disabledReason ? `Disabled: ${hook.disabledReason}` : 'Disabled';
}

export const DELIVERY_STATUS_LABEL: Record<WebhookDeliveryStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Retrying',
  dead: 'Failed',
};

/** The last four characters of an id, enough to tell hooks apart without showing a whole id. */
export function shortId(id: string): string {
  return id.slice(-4);
}
