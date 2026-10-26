import type { BoardPresence } from '../../data/presence';

/**
 * Formats a list of active viewers into a human-readable string for tooltips.
 */
export function formatViewingNow(viewers: BoardPresence[], currentUid?: string): string {
  if (viewers.length === 0) return 'No active viewers';
  const names = viewers.map((v) => {
    const isMe = v.uid === currentUid;
    const name = v.displayName || 'Anonymous';
    return isMe ? `${name} (You)` : name;
  });
  return `Viewing now: ${names.join(', ')}`;
}
