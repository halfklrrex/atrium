import Placeholder from '@tiptap/extension-placeholder';
import { TableKit, TableView } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import styles from './DescriptionEditor.module.css';
import { createSlashCommand } from './slash-menu/slash-command';
import type { SlashController } from './slash-menu/slash-controller';

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

/**
 * Everything the description supports. StarterKit brings headings, bold, italic, underline,
 * strikethrough, code, code blocks, quotes, dividers, lists, links, undo and their markdown input
 * rules (`#`, `-`, `1.`, `>`, three backticks, `---`, `**bold**`, ...); the task item adds `[ ]`.
 */
export function createEditorExtensions(controller: SlashController) {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, View: ScrollingTableView } }),
    Placeholder.configure({ placeholder: 'Add a description...' }),
    createSlashCommand(controller),
  ];
}
