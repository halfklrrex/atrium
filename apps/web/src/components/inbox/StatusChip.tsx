import type { InboxStatus } from '@atrium/shared';
import { Label } from '@vibe/core';

/** The status of an Inbox thread. The admin and the sender word the statuses differently. */
export function StatusChip({
  status,
  labels,
}: {
  status: InboxStatus;
  labels: Record<InboxStatus, string>;
}) {
  return (
    <Label
      text={labels[status]}
      color={status === 'answered' ? 'positive' : 'primary'}
      kind={status === 'closed' ? 'line' : 'fill'}
    />
  );
}
