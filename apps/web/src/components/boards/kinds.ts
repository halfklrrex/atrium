import type { BoardKind } from '@atrium/shared';

/** Board privacy choices, worded like monday's "Board permissions". */
export const BOARD_KIND_OPTIONS: readonly { value: BoardKind; label: string; hint: string }[] = [
  {
    value: 'main',
    label: 'Main',
    hint: 'Visible to everyone in the workspace. Members can edit it.',
  },
  {
    value: 'private',
    label: 'Private',
    hint: 'Only the people you add can find and open this board.',
  },
  {
    value: 'shareable',
    label: 'Shareable',
    hint: 'Only board members can see it; it can also be shared with guests.',
  },
];
