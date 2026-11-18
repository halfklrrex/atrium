// Service methods: updates. Receives the shared helpers of `createService` (see ../service.mjs).
import { buildReplyDoc, buildUpdateDoc, ts, newDocId } from '../builders.mjs';
import { McpUserError, assertId } from '../errors.mjs';
import { buildRichBody, memberResolver } from '../updates.mjs';
import { docToMarkdown } from '../description.mjs';

export function updatesService(h) {
  const { client, uid, now, loadBoard, loadItem, boardMembers, iso, safeName } = h;
  let profileCache;
  async function authorProfile() {
    // The actor's own profile (users/{uid} is readable by its owner only).
    profileCache ??= (await client.getDoc(`users/${uid}`)) ?? {};
    return profileCache;
  }

  /** `{ uid, name, ... }` of the members a post may mention, as the web's @ list would offer. */
  async function mentionResolver(loaded) {
    return memberResolver(await boardMembers(loaded.board), uid);
  }

  async function loadUpdate(boardId, itemId, updateId, replyId) {
    assertId(updateId, 'updateId');
    const update = await client.getDoc(`boards/${boardId}/items/${itemId}/updates/${updateId}`);
    if (!update) throw new McpUserError(`Update "${updateId}" was not found on this item.`);
    if (replyId === undefined)
      return {
        update,
        target: update,
        path: `boards/${boardId}/items/${itemId}/updates/${updateId}`,
      };
    assertId(replyId, 'replyId');
    const path = `boards/${boardId}/items/${itemId}/updates/${updateId}/replies/${replyId}`;
    const reply = await client.getDoc(path);
    if (!reply) throw new McpUserError(`Reply "${replyId}" was not found on this update.`);
    return { update, target: reply, path };
  }

  const shapePost = (id, post) => ({
    id,
    author: { uid: post.authorId, name: safeName(post.authorName ?? null) },
    mine: post.authorId === uid,
    text: post.content,
    markdown: post.contentDoc ? docToMarkdown(post.contentDoc) : post.content,
    createdAt: iso(post.createdAt),
    edited: Boolean(post.updatedAt && post.createdAt && +post.updatedAt !== +post.createdAt),
    likes: (post.likes ?? []).length,
    mentions: post.mentions ?? [],
    attachments: (post.attachments ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
    })),
  });
  return {
    async listUpdates({ boardId, itemId, limit = 20, includeReplies = true }) {
      await loadBoard(boardId, 'view');
      await loadItem(boardId, itemId);
      const base = `boards/${boardId}/items/${itemId}/updates`;
      const posts = (await client.listAllDocs(base))
        .sort((a, b) => +b.data.createdAt - +a.data.createdAt)
        .slice(0, limit);
      const updates = [];
      for (const post of posts) {
        const shaped = shapePost(post.id, post.data);
        shaped.repliesCount = post.data.repliesCount ?? 0;
        if (includeReplies && shaped.repliesCount > 0) {
          const replies = await client.listAllDocs(`${base}/${post.id}/replies`);
          shaped.replies = replies
            .sort((a, b) => +a.data.createdAt - +b.data.createdAt)
            .map((r) => shapePost(r.id, r.data));
        }
        updates.push(shaped);
      }
      return { itemId, updates, shown: updates.length };
    },
    async addUpdate({ boardId, itemId, text }) {
      const loaded = await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      const body = buildRichBody(text, await mentionResolver(loaded));
      const profile = await authorProfile();
      const id = newDocId();
      const doc = buildUpdateDoc({
        uid,
        itemId,
        id,
        ...body,
        authorName: profile.displayName,
        authorPhotoUrl: profile.photoURL,
        now: now(),
      });
      // The post and the item's counter (the row bubble) land together, like the web does.
      await client.commit([
        {
          op: 'set',
          path: `boards/${boardId}/items/${itemId}/updates/${id}`,
          data: doc,
          precondition: { exists: false },
        },
        {
          op: 'update',
          path: `boards/${boardId}/items/${itemId}`,
          set: {},
          increment: { updatesCount: 1 },
        },
      ]);
      return { id, itemId, mentioned: body.mentions };
    },
    async addReply({ boardId, itemId, updateId, text }) {
      const loaded = await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      await loadUpdate(boardId, itemId, updateId);
      const body = buildRichBody(text, await mentionResolver(loaded));
      const profile = await authorProfile();
      const id = newDocId();
      const doc = buildReplyDoc({
        uid,
        updateId,
        id,
        ...body,
        authorName: profile.displayName,
        authorPhotoUrl: profile.photoURL,
        now: now(),
      });
      const parent = `boards/${boardId}/items/${itemId}/updates/${updateId}`;
      await client.commit([
        { op: 'set', path: `${parent}/replies/${id}`, data: doc, precondition: { exists: false } },
        { op: 'update', path: parent, set: {}, increment: { repliesCount: 1 } },
      ]);
      return { id, updateId, mentioned: body.mentions };
    },
    async editUpdate({ boardId, itemId, updateId, replyId, text }) {
      await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      const { target, path } = await loadUpdate(boardId, itemId, updateId, replyId);
      if (target.authorId !== uid) {
        throw new McpUserError('You can only edit your own updates and replies.');
      }
      if (target.attachments?.length) {
        throw new McpUserError('This post has attachments; edit it in Atrium.');
      }
      const body = buildRichBody(text); // no mention chips: the app never notifies on edit
      await client.commit([
        {
          op: 'update',
          path,
          set: { content: body.content, contentDoc: body.contentDoc, updatedAt: ts(now()) },
          remove: [],
        },
      ]);
      return { id: replyId ?? updateId, edited: true };
    },
    async deleteUpdate({ boardId, itemId, updateId, replyId }) {
      await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const { update, target, path } = await loadUpdate(boardId, itemId, updateId, replyId);
      if (target.authorId !== uid) {
        throw new McpUserError('You can only delete your own updates and replies.');
      }
      const writes = [{ op: 'delete', path }];
      // Counters only move down while positive (the rules refuse a decrement from 0).
      if (replyId !== undefined) {
        if ((update.repliesCount ?? 0) > 0) {
          writes.push({
            op: 'update',
            path: `boards/${boardId}/items/${itemId}/updates/${updateId}`,
            set: {},
            increment: { repliesCount: -1 },
          });
        }
      } else if ((item.updatesCount ?? 0) > 0) {
        writes.push({
          op: 'update',
          path: `boards/${boardId}/items/${itemId}`,
          set: {},
          increment: { updatesCount: -1 },
        });
      }
      await client.commit(writes);
      return { deleted: replyId ?? updateId };
    },
    async setUpdateLike({ boardId, itemId, updateId, replyId, liked }) {
      await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      assertId(updateId, 'updateId');
      if (replyId !== undefined) assertId(replyId, 'replyId');
      const base = `boards/${boardId}/items/${itemId}/updates/${updateId}`;
      const path = replyId === undefined ? base : `${base}/replies/${replyId}`;
      for (let attempt = 0; ; attempt += 1) {
        const meta = await client.getDocMeta(path);
        if (!meta) {
          throw new McpUserError(
            replyId === undefined
              ? `Update "${updateId}" was not found on this item.`
              : `Reply "${replyId}" was not found on this update.`,
          );
        }
        const current = Array.isArray(meta.data.likes) ? meta.data.likes : [];
        const has = current.includes(uid);
        if (has === liked) {
          return { id: replyId ?? updateId, liked, likes: current.length, changed: false };
        }
        const next = liked ? [...current, uid] : current.filter((u) => u !== uid);
        try {
          await client.commit([
            {
              op: 'update',
              path,
              set: { likes: next },
              remove: [],
              precondition: { updateTime: meta.updateTime },
            },
          ]);
          return { id: replyId ?? updateId, liked, likes: next.length, changed: true };
        } catch (error) {
          const raced = error?.status === 409 || error?.status === 400;
          if (!raced || attempt >= 1) throw error;
        }
      }
    },
  };
}
