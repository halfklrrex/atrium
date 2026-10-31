/** True for fields and editors, where Ctrl/Cmd+B and Ctrl/Cmd+K belong to the field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.closest('[contenteditable=""], [contenteditable="true"]')
  ) {
    return true;
  }
  return target.matches('input, textarea, select');
}
