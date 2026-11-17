// Tool catalogue: updates (comments), replies and likes.
import { UNTRUSTED, add, change, id, read } from './helpers.mjs';
import { z } from 'zod';

/** @param {ReturnType<typeof import('../service.mjs').createService>} service */
export const updateTools = (service) => [
  read({
    name: 'atrium_list_updates',
    description:
      "Read-only. Lists an item's updates (comments), newest first, with their replies: id, author, text, markdown, " +
      'time, whether it was edited, likes, mentioned uids and attachment metadata (name, size, type; files are not downloadable here). ' +
      '"mine" marks posts you can edit or delete.' +
      UNTRUSTED,
    inputSchema: {
      boardId: id,
      itemId: id,
      limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
      includeReplies: z.boolean().optional().describe('Default true.'),
    },
    run: (args) => service.listUpdates(args),
  }),
  add({
    name: 'atrium_add_update',
    description:
      "Posts an update (comment) in an item's or subitem's feed, as you. The text is markdown " +
      '(bold, italic, links, lists, quotes, code). Mention a workspace member with @[Name] (display name, email or uid; ' +
      '@[me] for yourself): it becomes an @ chip and notifies them. Additive.',
    inputSchema: { boardId: id, itemId: id, text: z.string().trim().min(1).max(50000) },
    run: (args) => service.addUpdate(args),
  }),
  add({
    name: 'atrium_add_reply',
    description:
      'Replies to an update in its thread, as you. Same markdown and @[Name] mentions as atrium_add_update. Additive.',
    inputSchema: {
      boardId: id,
      itemId: id,
      updateId: id,
      text: z.string().trim().min(1).max(50000),
    },
    run: (args) => service.addReply(args),
  }),
  change({
    name: 'atrium_edit_update',
    description:
      'Edits the text of one of your own updates, or of a reply when replyId is given. ' +
      'Mentions cannot change after posting: @[Name] is kept as plain @Name text and notifies nobody. Refuses posts with attachments.',
    inputSchema: {
      boardId: id,
      itemId: id,
      updateId: id,
      replyId: id.optional(),
      text: z.string().trim().min(1).max(50000),
    },
    run: (args) => service.editUpdate(args),
  }),
  change({
    name: 'atrium_delete_update',
    description:
      "Deletes one of your own updates, or a reply when replyId is given (a hard delete, like the app's). " +
      "Other people's posts are refused.",
    inputSchema: { boardId: id, itemId: id, updateId: id, replyId: id.optional() },
    run: (args) => service.deleteUpdate(args),
  }),
  add({
    name: 'atrium_like_update',
    description:
      'Likes an update (comment), or a reply when replyId is given, as you. Liking twice changes nothing. Needs the editor role.',
    inputSchema: { boardId: id, itemId: id, updateId: id, replyId: id.optional() },
    run: (args) => service.setUpdateLike({ ...args, liked: true }),
  }),
  change({
    name: 'atrium_unlike_update',
    description:
      'Removes your like from an update, or from a reply when replyId is given. Needs the editor role.',
    inputSchema: { boardId: id, itemId: id, updateId: id, replyId: id.optional() },
    run: (args) => service.setUpdateLike({ ...args, liked: false }),
  }),
];
