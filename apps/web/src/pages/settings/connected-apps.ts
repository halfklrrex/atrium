import type { McpScope } from '@atrium/shared';
import type { McpGrantDoc } from '../../data';

const SCOPE_LABELS: Record<McpScope, string> = { 'atrium:read': 'Read', 'atrium:write': 'Write' };
const LOCALE = 'en-GB';

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "today", "yesterday" or "3 Nov". */
export function describeLastUsed(ms: number, now: number = Date.now()): string {
  if (sameDay(ms, now)) return 'today';
  if (sameDay(ms, now - 86_400_000)) return 'yesterday';
  return shortDate(ms);
}

export function describeGrant(grant: McpGrantDoc, now: number = Date.now()): string {
  const scopes = grant.scopes.map((s) => SCOPE_LABELS[s]).join(', ');
  const connected = shortDate(grant.createdAt.toMillis());
  const lastUsed = describeLastUsed(grant.lastUsedAt.toMillis(), now);
  return `${scopes} · connected ${connected} · last used ${lastUsed}`;
}
