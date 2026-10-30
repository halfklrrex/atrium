import type { NotificationKind } from '@atrium/shared';
import type { NotificationDoc } from '../../data/model';

/** The bell panel's tabs, in display order. */
export const NOTIFICATION_TABS = ['all', 'unread', 'mentioned', 'assigned'] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

export const TAB_LABELS: Record<NotificationTab, string> = {
  all: 'All',
  unread: 'Unread',
  mentioned: 'I was mentioned',
  assigned: 'Assigned to me',
};

const TAB_KIND: Partial<Record<NotificationTab, NotificationKind>> = {
  mentioned: 'mention',
  assigned: 'assigned',
};

/** Does the text of a notification contain `term` (case-insensitive)? */
function matchesTerm(n: NotificationDoc, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [n.actorName, n.itemName, n.boardName, n.snippet].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

export interface NotificationFilter {
  tab: NotificationTab;
  term: string;
  /** Show only this actor's notifications. */
  actorId: string | null;
}

/** The loaded notifications that pass the tab, the search and the person filter. */
export function filterNotifications(
  list: readonly NotificationDoc[],
  { tab, term, actorId }: NotificationFilter,
): NotificationDoc[] {
  const kind = TAB_KIND[tab];
  return list.filter(
    (n) =>
      (tab !== 'unread' || n.readAt === null) &&
      (!kind || n.kind === kind) &&
      (!actorId || n.actorId === actorId) &&
      matchesTerm(n, term),
  );
}

/** People who appear in the list, once each, for the "Filter by person" menu. */
export function actorsOf(list: readonly NotificationDoc[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const n of list) if (!seen.has(n.actorId)) seen.set(n.actorId, n.actorName);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** "Assigned you to an item", "Replied to your update", "Mentioned you in a reply", "Mentioned you in a description". */
export function actionText(n: Pick<NotificationDoc, 'kind' | 'replyId' | 'updateId'>): string {
  switch (n.kind) {
    case 'assigned':
      return 'Assigned you to an item';
    case 'reply':
      return 'Replied to your update';
    case 'mention':
      if (n.replyId) return 'Mentioned you in a reply';
      return n.updateId ? 'Mentioned you in an update' : 'Mentioned you in a description';
  }
}
