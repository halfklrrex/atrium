import { useBoard } from '../../../data';
import type { MentionSource } from './MentionMenu';

/** The "@" list of an item description: the board's readers. */
export function boardMentionSource(boardId: string): MentionSource {
  return {
    useScope: () => {
      const { data: board } = useBoard(boardId);
      return { access: board, workspaceId: board?.workspaceId };
    },
  };
}
