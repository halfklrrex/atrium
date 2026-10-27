import Placeholder from '@tiptap/extension-placeholder';
import { TableKit, TableView } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createEmojiExtension } from './emoji-extension';
import type { EmojiSuggestController } from './emoji-data';
import { DescriptionImage, ImageFileHandlers, ImageUpload } from './editor-images';
import { KeyedHighlight, KeyedTextStyle, TextStyleKeys } from './editor-marks';
import styles from './DescriptionEditor.module.css';
import { createSlashCommand } from './slash-menu/slash-command';
import { SuggestController, type SlashController } from './slash-menu/slash-controller';

/** The table's scroll wrapper gets the thin app scrollbar, so a wide table scrolls inside the editor. */
class ScrollingTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    // `composes` makes the module class a space-separated list, which classList.add rejects.
    this.dom.classList.add(
      ...String(styles.tableScroll ?? '')
        .split(/\s+/)
        .filter(Boolean),
    );
  }
}

export interface EditorExtensionOptions {
  /** The item the description belongs to: image uploads and downloads are scoped to it. */
  boardId?: string;
  itemId?: string;
  /** Feeds the `:` emoji list; a private one when omitted (tests). */
  emojiController?: EmojiSuggestController;
}

/**
 * Everything the description supports. StarterKit brings headings, bold, italic, underline,
 * strikethrough, code, code blocks, quotes, dividers, lists, links, undo and their markdown input
 * rules (`#`, `-`, `1.`, `>`, three backticks, `---`, `**bold**`, ...); the task item adds `[ ]`.
 * Pass 2 adds keyed text colour, highlight and font, emoji, and description images.
 */
export function createEditorExtensions(
  controller: SlashController,
  options: EditorExtensionOptions = {},
) {
  const image = { boardId: options.boardId ?? '', itemId: options.itemId ?? '' };
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, View: ScrollingTableView } }),
    KeyedTextStyle,
    TextStyleKeys,
    KeyedHighlight,
    createEmojiExtension(options.emojiController ?? new SuggestController()),
    DescriptionImage.configure(image),
    ImageUpload,
    ImageFileHandlers.configure(image),
    Placeholder.configure({ placeholder: 'Add a description...' }),
    createSlashCommand(controller),
  ];
}
