import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import type { EmojiSuggestController } from '../item-view/emoji-data';
import { createEmojiExtension } from '../item-view/emoji-extension';
import { KeyedHighlight, KeyedTextStyle, TextStyleKeys } from '../item-view/editor-marks';
import type { MentionController } from '../item-view/mention/mention-controller';
import { createMentionExtension } from '../item-view/mention/mention-extension';
import { SuggestController } from '../item-view/slash-menu/slash-controller';

export interface ComposerExtensionOptions {
  /** Feeds the `:` emoji list; a private one when omitted (tests). */
  emojiController?: EmojiSuggestController;
  /** Feeds the `@` member list. */
  mentionController: MentionController;
  placeholder: string;
}

/**
 * The subset of the description editor an update or reply supports: bold, italic, underline,
 * strikethrough, inline code, links, bullet / numbered lists, checklists, quotes, undo and redo
 * (StarterKit, with their markdown input rules), keyed text colour and highlight, emoji and
 * `@` mentions. Left out on purpose: images and uploads, tables, headings, code blocks, dividers,
 * the "/" menu and fonts.
 */
export function createComposerExtensions(options: ComposerExtensionOptions) {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      horizontalRule: false,
      link: { openOnClick: false },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    KeyedTextStyle,
    TextStyleKeys,
    KeyedHighlight,
    createEmojiExtension(options.emojiController ?? new SuggestController()),
    createMentionExtension(options.mentionController),
    Placeholder.configure({ placeholder: options.placeholder }),
  ];
}
