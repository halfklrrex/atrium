import type { ButtonAction } from '@atrium/shared';

/** A fresh action of `type`, with its blanks unfilled. */
export function newAction(type: ButtonAction['type']): ButtonAction {
  switch (type) {
    case 'set_value':
      return { type, columnId: '', value: undefined };
    case 'rename_item':
      return { type, template: '' };
    case 'move_to_group':
      return { type, groupId: '' };
    case 'archive_item':
      return { type };
    case 'notify':
      return { type, uids: [] };
    case 'create_item':
      return { type, name: '' };
    case 'post_update':
      return { type, text: '' };
  }
}
