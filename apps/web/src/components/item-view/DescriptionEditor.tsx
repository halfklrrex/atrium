import { useMemo } from 'react';
import { RichDocEditor } from '../rich-doc/RichDocEditor';
import type { DescriptionValue } from './description';
import { boardMentionSource } from './mention/board-mention-source';

export interface DescriptionEditorProps {
  /** The item this description belongs to (image uploads and downloads are scoped to it). */
  boardId: string;
  itemId: string;
  /** The stored doc (ProseMirror JSON), or null when empty. */
  initial: Record<string, unknown> | null;
  readOnly: boolean;
  /** Persist the description (`null` clears it). Resolves when written. */
  onSave: (value: DescriptionValue | null) => Promise<void>;
  /**
   * `'focus'` shows the formatting toolbar only while the editor has focus (or one of its popups is
   * open); `'always'`, the usual setting, keeps it on screen.
   */
  toolbar?: 'always' | 'focus';
  /**
   * Side panel: the text box stops growing at a fixed height and scrolls inside instead of
   * pushing the rest of the panel down.
   */
  scrollable?: boolean;
}

/**
 * The item's rich-text description: the shared `RichDocEditor` wired to the item's image
 * uploads and the board's "@" list. Loaded lazily by the item view.
 */
export default function DescriptionEditor({
  boardId,
  itemId,
  initial,
  readOnly,
  onSave,
  toolbar,
  scrollable,
}: DescriptionEditorProps) {
  const images = useMemo(() => ({ boardId, itemId }), [boardId, itemId]);
  const mentions = useMemo(() => boardMentionSource(boardId), [boardId]);
  return (
    <RichDocEditor
      initial={initial}
      readOnly={readOnly}
      onSave={onSave}
      toolbar={toolbar}
      scrollable={scrollable}
      images={images}
      mentions={mentions}
    />
  );
}
