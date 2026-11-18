// Service methods: Docs (P7). Receives the shared helpers of `createService` (see ../service.mjs).
// A doc is `docs/{id}` (metadata) plus `docs/{id}/content/body` (`{ doc, text, rev, updatedAt,
// updatedBy }`). Both clients bypass the security rules, so every write mirrors them: the role comes
// from the same `roleOn` as boards (a doc has `workspaceId`, `kind` and `access` like a board), the
// body's `rev` is the stored one plus one under an `updateTime` precondition, and the writes are the
// ones `apps/web/src/data/docs.ts` makes.
import { DOC_LIMITS, docBodyBytes, docToText } from '@atrium/shared';
import { newDocId, positionAfter } from '../builders.mjs';
import {
  MAX_MARKDOWN_CHARS,
  appendDoc,
  docToMarkdown,
  markdownToDoc,
  richNodeTypes,
} from '../description.mjs';
import { McpUserError, assertId } from '../errors.mjs';
import { memberResolver, resolveMentions } from '../updates.mjs';
import { CREATE_BOARD_ROLES, EDIT_ROLES } from './constants.mjs';

/** A replace without `baseRev` is refused when someone else saved this recently (they may be typing). */
const RECENT_EDIT_MS = 2 * 60 * 1000;
const DOC_KINDS = ['main', 'private', 'shareable'];

const millis = (value) => (value instanceof Date ? value.getTime() : null);

export function docsService(h) {
  const {
    client,
    uid,
    now,
    resolveWorkspace,
    roleOn,
    memberProfiles,
    memberName,
    boardMembers,
    iso,
  } = h;

  /**
   * Loads a doc and applies the safety checks. `need` is 'read', 'edit' or 'owner'. A doc outside the
   * actor's workspaces, or one they have no role on, reads as "not found". Trashed docs are refused
   * unless `states` allows them.
   */
  async function loadDoc(docId, need = 'edit', { states = ['active'] } = {}) {
    assertId(docId, 'docId');
    const meta = await client.getDocMeta(`docs/${docId}`);
    const notFound = new McpUserError(
      `Doc "${docId}" was not found in your workspaces.`,
      'not_found',
    );
    if (!meta) throw notFound;
    const role = await roleOn(meta.data);
    if (!role) throw notFound;
    if (!states.includes(meta.data.state)) {
      throw new McpUserError(
        meta.data.state === 'deleted'
          ? `Doc "${docId}" is in the trash.`
          : `Doc "${docId}" is ${meta.data.state}, not active.`,
        'not_found',
      );
    }
    if (need === 'owner' && role !== 'owner') {
      throw new McpUserError('Only the doc owner can do this.');
    }
    if (need === 'edit' && !EDIT_ROLES.includes(role)) {
      throw new McpUserError('You can only view this doc.', 'forbidden');
    }
    return { id: docId, doc: meta.data, updateTime: meta.updateTime, role };
  }

  /** Read-modify-write of the doc's metadata with an `updateTime` precondition; retried once. */
  async function patchDoc(docId, need, states, build) {
    for (let attempt = 0; ; attempt += 1) {
      const loaded = await loadDoc(docId, need, { states });
      const { patch, result } = build(loaded);
      try {
        await client.commit([
          {
            op: 'patch',
            path: `docs/${docId}`,
            data: { ...patch, updatedAt: now(), updatedBy: uid },
            precondition: { updateTime: loaded.updateTime },
          },
        ]);
        return result;
      } catch (error) {
        const raced = error?.status === 409 || error?.status === 400;
        if (!raced || attempt >= 1) throw error;
      }
    }
  }

  /** The body to write for `markdown`, mentions resolved against the people who can read `docMeta`. */
  async function buildBody(markdown, docMeta) {
    if (markdown.length > MAX_MARKDOWN_CHARS) {
      throw new McpUserError(`The markdown is over ${MAX_MARKDOWN_CHARS} characters.`);
    }
    let added = markdownToDoc(markdown);
    let mentions = [];
    if (markdown.includes('@[')) {
      const resolver = memberResolver(await boardMembers(docMeta), uid, 'doc');
      ({ doc: added, mentions } = resolveMentions(added, resolver));
    }
    return { added, mentions };
  }

  /** `{ doc, text }` to store, or an error when the body is over the size limit. */
  function storedBody(doc) {
    if (docBodyBytes(doc) > DOC_LIMITS.bodyBytes) {
      throw new McpUserError('This doc is too long to save. Split it into two docs.');
    }
    return { doc, text: docToText(doc).slice(0, DOC_LIMITS.text) };
  }

  const shapeRow = (id, data, role) => ({
    id,
    name: data.name,
    kind: data.kind,
    role,
    state: data.state,
    updatedAt: iso(data.updatedAt),
  });

  return {
    async listDocs({ workspaceId, state = 'active' } = {}) {
      const ws = await resolveWorkspace(workspaceId);
      const rows = await client.runQuery('docs', { workspaceId: ws.id, state });
      const docs = [];
      for (const row of rows) {
        // As the rules' list: main docs, or docs that list the actor in `accessUids`.
        if (row.data.kind !== 'main' && !(row.data.accessUids ?? []).includes(uid)) continue;
        const role = await roleOn(row.data);
        if (!role) continue;
        docs.push({ position: row.data.position ?? '', ...shapeRow(row.id, row.data, role) });
      }
      docs.sort((a, b) =>
        a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1,
      );
      return { workspaceId: ws.id, docs: docs.map(({ position: _position, ...doc }) => doc) };
    },

    async getDoc({ docId }) {
      const loaded = await loadDoc(docId, 'read');
      const body = await client.getDoc(`docs/${docId}/content/body`);
      const profiles = body?.updatedBy ? await memberProfiles(loaded.doc.workspaceId) : new Map();
      const doc = body?.doc ?? null;
      return {
        id: docId,
        workspaceId: loaded.doc.workspaceId,
        name: loaded.doc.name,
        kind: loaded.doc.kind,
        role: loaded.role,
        access: await h.accessEntries(loaded.doc),
        rev: body?.rev ?? 0,
        updatedAt: iso(body?.updatedAt ?? loaded.doc.updatedAt),
        updatedBy: body?.updatedBy
          ? memberName(profiles.get(body.updatedBy), body.updatedBy)
          : null,
        markdown: doc ? docToMarkdown(doc) : '',
        text: body?.text ?? '',
        richNodes: doc ? richNodeTypes(doc) : [],
      };
    },

    async createDoc({ name, workspaceId, kind = 'main', markdown }) {
      const trimmed = String(name).trim();
      if (trimmed.length < 1 || trimmed.length > DOC_LIMITS.name) {
        throw new McpUserError(`Name must be 1 to ${DOC_LIMITS.name} characters.`);
      }
      if (!DOC_KINDS.includes(kind))
        throw new McpUserError(`kind must be ${DOC_KINDS.join(', ')}.`);
      const ws = await resolveWorkspace(workspaceId);
      if (!CREATE_BOARD_ROLES.includes(ws.role)) {
        throw new McpUserError(
          `Creating a doc needs the member role or higher in workspace "${ws.name}" (you are a ${ws.role}).`,
          'forbidden',
        );
      }
      // The end of the workspace root: after the last root position among boards, dashboards and docs.
      const [boards, dashboards, docs] = await Promise.all(
        ['boards', 'dashboards', 'docs'].map((collection) =>
          client.runQuery(collection, { workspaceId: ws.id }),
        ),
      );
      const positions = [...boards, ...dashboards, ...docs]
        .filter(
          (row) => (row.data.folderId ?? null) === null && typeof row.data.position === 'string',
        )
        .map((row) => row.data.position);
      const at = now();
      const meta = {
        workspaceId: ws.id,
        folderId: null,
        name: trimmed,
        kind,
        access: { [uid]: 'owner' },
        accessUids: [uid],
        position: positionAfter(positions),
        icon: null,
        state: 'active',
        deletedAt: null,
        createdAt: at,
        createdBy: uid,
        updatedAt: at,
      };
      const id = newDocId();
      const writes = [
        { op: 'set', path: `docs/${id}`, data: meta, precondition: { exists: false } },
      ];
      let mentions = [];
      let rev = 0;
      if (markdown !== undefined && markdown.trim() !== '') {
        const built = await buildBody(markdown, meta);
        mentions = built.mentions;
        const body = storedBody(built.added);
        rev = 1;
        writes.push({
          op: 'set',
          path: `docs/${id}/content/body`,
          data: { ...body, rev, updatedAt: at, updatedBy: uid },
          precondition: { exists: false },
        });
      }
      await client.commit(writes);
      return { id, workspaceId: ws.id, name: trimmed, kind, rev, mentioned: mentions.length };
    },

    async writeDoc({ docId, markdown, mode = 'replace', baseRev, allowOverwriteRich }) {
      if (mode === 'append' && markdown.trim() === '')
        throw new McpUserError('The markdown is empty.');
      for (let attempt = 0; ; attempt += 1) {
        const loaded = await loadDoc(docId, 'edit');
        const stored = await client.getDocMeta(`docs/${docId}/content/body`);
        const storedRev = stored?.data.rev ?? 0;
        if (baseRev !== undefined && baseRev !== storedRev) {
          throw new McpUserError(
            `The doc changed since you read it (rev ${storedRev}). Read it again.`,
          );
        }
        const existing = stored?.data.doc ?? null;
        if (mode === 'replace' && existing) {
          const savedAt = millis(stored.data.updatedAt);
          if (
            baseRev === undefined &&
            !allowOverwriteRich &&
            stored.data.updatedBy !== uid &&
            savedAt !== null &&
            now().getTime() - savedAt < RECENT_EDIT_MS
          ) {
            throw new McpUserError(
              'Someone else saved this doc in the last 2 minutes and may still be typing. ' +
                'Read it again, pass baseRev, or pass allowOverwriteRich: true to replace it anyway.',
            );
          }
          const rich = richNodeTypes(existing);
          if (rich.length > 0 && !allowOverwriteRich) {
            throw new McpUserError(
              `The doc contains ${rich.join(', ')}, which this tool cannot write back. ` +
                'Use mode "append" to keep it, or pass allowOverwriteRich: true to replace it anyway.',
            );
          }
        }
        const { added, mentions } = await buildBody(markdown, loaded.doc);
        const next = storedBody(mode === 'append' ? appendDoc(existing, added) : added);
        const rev = storedRev + 1;
        const data = { ...next, rev, updatedAt: now(), updatedBy: uid };
        try {
          await client.commit([
            stored
              ? {
                  op: 'patch',
                  path: `docs/${docId}/content/body`,
                  data,
                  precondition: { updateTime: stored.updateTime },
                }
              : {
                  op: 'set',
                  path: `docs/${docId}/content/body`,
                  data,
                  precondition: { exists: false },
                },
          ]);
        } catch (error) {
          const raced = error?.status === 409 || error?.status === 400;
          // Somebody saved in between: start again, so the guards see what they wrote.
          if (!raced || attempt >= 1) throw error;
          continue;
        }
        return { id: docId, mode, rev, chars: next.text.length, mentioned: mentions.length };
      }
    },

    async renameDoc({ docId, name }) {
      const trimmed = String(name).trim();
      if (trimmed.length < 1 || trimmed.length > DOC_LIMITS.name) {
        throw new McpUserError(`Name must be 1 to ${DOC_LIMITS.name} characters.`);
      }
      return patchDoc(docId, 'edit', ['active'], () => ({
        patch: { name: trimmed },
        result: { id: docId, name: trimmed },
      }));
    },

    async deleteDoc({ docId }) {
      return patchDoc(docId, 'owner', ['active'], (loaded) => ({
        patch: { state: 'deleted', deletedAt: now() },
        result: { id: docId, name: loaded.doc.name, state: 'deleted' },
      }));
    },

    async restoreDoc({ docId }) {
      const current = await loadDoc(docId, 'owner', { states: ['active', 'deleted'] });
      // Restoring a doc that is not in the trash changes nothing.
      if (current.doc.state === 'active')
        return { id: docId, name: current.doc.name, state: 'active' };
      return patchDoc(docId, 'owner', ['deleted'], (loaded) => ({
        patch: { state: 'active', deletedAt: null },
        result: { id: docId, name: loaded.doc.name, state: 'active' },
      }));
    },
  };
}
