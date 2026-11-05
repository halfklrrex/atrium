import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import type { EmojiSuggestController } from '../item-view/emoji-data';
import { createEmojiExtension } from '../item-view/emoji-extension';
import { ScrollingTableView } from '../item-view/editor-extensions';
import { KeyedHighlight, TextStyleKeys } from '../item-view/editor-marks';
import type { MentionController } from '../item-view/mention/mention-controller';
import { createMentionExtension } from '../item-view/mention/mention-extension';
import { SuggestController } from '../item-view/slash-menu/slash-controller';
import { BlockLayoutKeys, ComposerTextStyle, FontSizeKeys } from './composer-marks';

export interface ComposerExtensionOptions {
  /** Feeds the `:` emoji list; a private one when omitted (tests). */
  emojiController?: EmojiSuggestController;
  /** Feeds the `@` member list. */
  mentionController: MentionController;
  placeholder: string;
}

/**
 * The subset of the description editor an update or reply supports: bold, italic, underline,
 * strikethrough, inline code, links, bullet / numbered lists, checklists, quotes, a level 2 heading,
 * code blocks, dividers, undo and redo (StarterKit, with their markdown input rules), tables,
 * keyed text colour, highlight and size, paragraph alignment and direction (all keys, never CSS),
 * emoji and `@` mentions. Left out on purpose: images and uploads, the "/" menu and fonts.
 */
export function createComposerExtensions(options: ComposerExtensionOptions) {
  return [
    StarterKit.configure({
      heading: { levels: [2] },
      link: { openOnClick: false },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false, View: ScrollingTableView } }),
    ComposerTextStyle,
    TextStyleKeys,
    FontSizeKeys,
    BlockLayoutKeys,
    KeyedHighlight,
    createEmojiExtension(options.emojiController ?? new SuggestController()),
    createMentionExtension(options.mentionController),
    Placeholder.configure({ placeholder: options.placeholder }),
  ];
}
