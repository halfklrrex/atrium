/** Actor id prefix the server uses for automation-authored updates, e.g. `automation:abc`. */
export const AUTOMATION_ACTOR_PREFIX = 'automation:';

/** Display name for anything an automation wrote. */
export const AUTOMATION_ACTOR_NAME = 'Automations';

export function isAutomationActor(id: string | null | undefined): boolean {
  return !!id && id.startsWith(AUTOMATION_ACTOR_PREFIX);
}

/** Author label for an update or reply: automations are always "Automations", even with no stored name. */
export function authorLabel(
  authorId: string,
  authorName: string | undefined | null,
  currentUid: string,
): string {
  if (isAutomationActor(authorId)) return AUTOMATION_ACTOR_NAME;
  return authorName ?? (authorId === currentUid ? 'You' : 'Member');
}
