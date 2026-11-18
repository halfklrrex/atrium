// Service methods: boards. Receives the shared helpers of `createService` (see ../service.mjs).
import {
  boardRoleFromWorkspaceRole,
  BUILT_IN_TEMPLATES,
  columnRegistry,
  VOTE_COLUMN_CAP_MESSAGE,
  voteCapExceeded,
  builtInTemplate,
  templateSampleItemSchema,
  templateStructureSchema,
} from '@atrium/shared';
import {
  addLabelsToSettings,
  buildBoardDoc,
  buildGroup,
  buildItemDoc,
  evenPositions,
  newDocId,
  positionAfter,
  validSettings,
} from '../builders.mjs';
import { McpUserError, assertId } from '../errors.mjs';
import { findColumn, findGroup, sortedByPosition } from '../refs.mjs';
import { toValidCell } from '../values.mjs';
import { CREATE_BOARD_ROLES } from './constants.mjs';
import { labelSummary } from './shared.mjs';

export function boardsService(h) {
  const {
    client,
    uid,
    now,
    listWorkspaces,
    resolveWorkspace,
    loadBoard,
    mutateBoard,
    itemsOf,
    subitemColumnsOf,
    readContext,
    readValues,
    prepareMirrors,
    prepareColumn,
  } = h;
  /** Item writes for a template's sample items: skips values the column rules would refuse. */
  function sampleItemWrites(boardId, board, sampleItems) {
    const columns = new Map(board.columns.map((c) => [c.id, c]));
    const groupIds = new Set(board.groups.map((g) => g.id));
    const last = new Map();
    const writes = [];
    for (const sample of sampleItems) {
      if (!groupIds.has(sample.groupId)) continue;
      const values = {};
      for (const [columnId, value] of Object.entries(sample.values ?? {})) {
        const column = columns.get(columnId);
        if (!column || value === null || value === undefined) continue;
        // People and vote values name accounts; derived and server-managed ones are not stored by clients.
        if (['people', 'vote', 'dependency'].includes(column.type)) continue;
        if (!columnRegistry.has(column.type)) continue;
        if (columnRegistry.isDerived(column.type) || columnRegistry.isServerManaged(column.type)) {
          continue;
        }
        try {
          values[columnId] = toValidCell(column, structuredClone(value));
        } catch {
          // A value that does not validate is left out; the item itself still goes in.
        }
      }
      const position = positionAfter(last.has(sample.groupId) ? [last.get(sample.groupId)] : []);
      last.set(sample.groupId, position);
      writes.push({
        op: 'set',
        path: `boards/${boardId}/items/${newDocId()}`,
        data: buildItemDoc({
          uid,
          name: sample.name,
          groupId: sample.groupId,
          position,
          values,
          now: now(),
        }),
        precondition: { exists: false },
      });
    }
    return writes;
  }
  return {
    async listWorkspaces() {
      return { workspaces: await listWorkspaces() };
    },
    async listBoards({ workspaceId, state = 'active' } = {}) {
      const ws = await resolveWorkspace(workspaceId);
      const boards = await client.runQuery('boards', { workspaceId: ws.id });
      const visible = boards.filter((b) => {
        if (b.data.state !== state) return false;
        if (b.data.access?.[uid]) return true;
        return b.data.kind === 'main' && boardRoleFromWorkspaceRole(ws.role) !== null;
      });
      return {
        workspaceId: ws.id,
        boards: sortedByPosition(visible.map((b) => ({ ...b.data, id: b.id }))).map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          state: b.state,
        })),
      };
    },
    async getBoard({ boardId, includeItems = true, limit = 200 }) {
      const { board } = await loadBoard(boardId, 'read');
      const columnTitle = new Map();
      const titles = new Set();
      for (const column of board.columns) {
        const taken = titles.has(column.title.toLowerCase());
        titles.add(column.title.toLowerCase());
        columnTitle.set(column.id, taken ? `${column.title} (${column.id})` : column.title);
      }
      const result = {
        id: boardId,
        workspaceId: board.workspaceId,
        name: board.name,
        description: board.description,
        kind: board.kind,
        access: await h.accessEntries(board),
        columns: sortedByPosition(board.columns).map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          ...labelSummary(c),
        })),
        groups: sortedByPosition(board.groups).map((g) => ({
          id: g.id,
          title: g.title,
          color: g.color,
        })),
      };
      if (!includeItems) return result;

      const docs = (await itemsOf(boardId)).filter((d) => d.data.state === 'active');
      const groupTitle = new Map(board.groups.map((g) => [g.id, g.title]));
      const groupOrder = new Map(sortedByPosition(board.groups).map((g, i) => [g.id, i]));
      const context = await readContext(boardId, board.workspaceId, board.columns);
      await prepareMirrors(context, docs, board.columns);
      const shape = (doc, columns) => ({
        id: doc.id,
        seq: doc.data.seq ?? null,
        name: doc.data.name,
        values: readValues(context, doc, columns, (c) => columnTitle.get(c.id)),
      });
      const subitems = docs.filter((d) => d.data.parentItemId);
      const roots = docs
        .filter((d) => !d.data.parentItemId)
        .sort(
          (a, b) =>
            (groupOrder.get(a.data.groupId) ?? 0) - (groupOrder.get(b.data.groupId) ?? 0) ||
            (a.data.position < b.data.position ? -1 : 1),
        );
      if (context.notes?.length) result.notes = context.notes;
      result.itemCount = roots.length;
      result.items = roots.slice(0, limit).map((doc) => {
        const children = subitems
          .filter((s) => s.data.parentItemId === doc.id)
          .map((s) => shape(s, subitemColumnsOf(board)));
        return {
          ...shape(doc, board.columns),
          group: groupTitle.get(doc.data.groupId) ?? doc.data.groupId,
          ...(children.length > 0 ? { subitems: children } : {}),
        };
      });
      if (roots.length > limit) result.truncated = true;
      return result;
    },
    async listTemplates({ workspaceId } = {}) {
      const ws = await resolveWorkspace(workspaceId);
      const saved = await client.listAllDocs(`workspaces/${ws.id}/templates`);
      const summary = (id, source, name, description, structure, sampleItems) => ({
        id,
        source,
        name,
        description,
        columns: sortedByPosition(structure.columns ?? []).map((c) => ({
          title: c.title,
          type: c.type,
        })),
        groups: sortedByPosition(structure.groups ?? []).map((g) => g.title),
        sampleItems: sampleItems.length,
      });
      return {
        workspaceId: ws.id,
        templates: [
          ...BUILT_IN_TEMPLATES.map((t) =>
            summary(t.id, 'built-in', t.name, t.description, t.structure, t.sampleItems),
          ),
          ...saved
            .sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)))
            .flatMap((t) => {
              // One damaged saved template must not fail the whole listing.
              try {
                return [
                  summary(
                    t.id,
                    'workspace',
                    t.data.name,
                    t.data.description ?? '',
                    t.data.structure ?? {},
                    t.data.sampleItems ?? [],
                  ),
                ];
              } catch {
                return [];
              }
            }),
        ],
      };
    },
    async createBoard({ name, description, workspaceId, templateId, includeSampleItems }) {
      if (templateId === undefined && includeSampleItems !== undefined) {
        throw new McpUserError('includeSampleItems only applies together with templateId.');
      }
      const ws = await resolveWorkspace(workspaceId);
      if (!CREATE_BOARD_ROLES.includes(ws.role)) {
        throw new McpUserError(
          `Creating a board needs the member role or higher in workspace "${ws.name}" (you are a ${ws.role}).`,
        );
      }
      let template = null;
      if (templateId !== undefined) {
        assertId(templateId, 'templateId');
        const built = builtInTemplate(templateId);
        if (built) {
          template = { id: built.id, source: 'built-in', name: built.name, content: built };
        } else {
          const saved = await client.getDoc(`workspaces/${ws.id}/templates/${templateId}`);
          if (!saved) {
            throw new McpUserError(
              `Template "${templateId}" was not found. Call atrium_list_templates.`,
            );
          }
          const structure = templateStructureSchema.safeParse(saved.structure);
          if (!structure.success) {
            throw new McpUserError(`Template "${templateId}" is damaged and cannot be used.`);
          }
          template = {
            id: templateId,
            source: 'workspace',
            name: saved.name,
            content: {
              structure: structure.data,
              sampleItems: (Array.isArray(saved.sampleItems) ? saved.sampleItems : []).filter(
                (i) => templateSampleItemSchema.safeParse(i).success,
              ),
            },
          };
        }
      }
      const existing = await client.runQuery('boards', { workspaceId: ws.id });
      const roots = existing.filter((b) => b.data.folderId === null);
      const doc = buildBoardDoc({
        workspaceId: ws.id,
        uid,
        name,
        description,
        position: positionAfter(roots.map((b) => b.data.position)),
        now: now(),
        structure: template?.content.structure,
      });
      const id = newDocId();
      await client.commit([
        { op: 'set', path: `boards/${id}`, data: doc, precondition: { exists: false } },
      ]);
      const result = {
        id,
        workspaceId: ws.id,
        name: doc.name,
        columns: doc.columns.map((c) => ({ id: c.id, title: c.title, type: c.type })),
        groups: doc.groups.map((g) => ({ id: g.id, title: g.title })),
      };
      if (!template) return result;
      result.template = { id: template.id, source: template.source, name: template.name };
      result.sampleItems = 0;
      if (includeSampleItems === false) return result;
      // Sample items are a second commit, as in the web: the item rules read the board, so it must
      // exist first. A failure leaves a good (empty) board, so it is reported rather than thrown.
      const writes = sampleItemWrites(id, doc, template.content.sampleItems);
      if (writes.length === 0) return result;
      try {
        await client.commit(writes);
        result.sampleItems = writes.length;
      } catch (error) {
        // stderr only: the stdio transport owns stdout.
        console.error(`atrium: sample items for board ${id} were not written: ${error?.message}`);
        result.warning = 'The board was created, but its sample items could not be added.';
      }
      return result;
    },
    async addGroup({ boardId, title, color }) {
      return mutateBoard(boardId, (board) => {
        const group = buildGroup({ title, color, existingGroups: board.groups });
        return {
          patch: { groups: [...board.groups, group] },
          result: { id: group.id, title: group.title, color: group.color },
        };
      });
    },
    async renameGroup({ boardId, group, title }) {
      return mutateBoard(boardId, (board) => {
        const target = findGroup(board, group);
        const renamed = board.groups.map((g) =>
          g.id === target.id ? { ...g, title: title.trim() } : g,
        );
        return { patch: { groups: renamed }, result: { id: target.id, title: title.trim() } };
      });
    },
    async deleteGroup({ boardId, group }) {
      const loaded = await loadBoard(boardId, 'owner');
      const target = findGroup(loaded.board, group);
      if (loaded.board.groups.length <= 1) {
        throw new McpUserError(
          'A board needs at least one group; add another before deleting this one.',
        );
      }
      const docs = await itemsOf(boardId, ['groupId', 'state']);
      const live = docs.filter((d) => d.data.groupId === target.id && d.data.state === 'active');
      if (live.length > 0) {
        throw new McpUserError(
          `Group "${target.title}" still has ${live.length} item(s). Move or delete them first.`,
        );
      }
      return mutateBoard(boardId, (board) => ({
        patch: { groups: board.groups.filter((g) => g.id !== target.id) },
        result: { deleted: target.id, title: target.title },
      }));
    },
    async reorderGroups({ boardId, groups }) {
      return mutateBoard(boardId, (board) => {
        const ids = groups.map((ref) => findGroup(board, ref).id);
        if (new Set(ids).size !== ids.length) {
          throw new McpUserError('A group is listed twice; list every group exactly once.');
        }
        if (ids.length !== board.groups.length) {
          const missing = board.groups
            .filter((g) => !ids.includes(g.id))
            .map((g) => `"${g.title}"`);
          throw new McpUserError(`List every group of the board; missing: ${missing.join(', ')}.`);
        }
        const positions = evenPositions(ids.length);
        const byId = new Map(board.groups.map((g) => [g.id, g]));
        const reordered = ids.map((id, i) => ({ ...byId.get(id), position: positions[i] }));
        return {
          patch: { groups: reordered },
          result: { groups: reordered.map((g) => ({ id: g.id, title: g.title })) },
        };
      });
    },
    async addColumn({ boardId, title, type, settings }) {
      return mutateBoard(boardId, async (board) => {
        if (voteCapExceeded(type, board)) throw new McpUserError(VOTE_COLUMN_CAP_MESSAGE);
        const column = await prepareColumn({
          loaded: { workspaceId: board.workspaceId, board },
          title,
          type,
          settings,
        });
        return {
          patch: { columns: [...board.columns, column] },
          result: {
            id: column.id,
            title: column.title,
            type: column.type,
            ...labelSummary(column),
          },
        };
      });
    },
    async updateColumnSettings({ boardId, column, settings }) {
      return mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        if (target.migrating) throw new McpUserError(`Column "${target.title}" is changing type.`);
        if (!columnRegistry.has(target.type) || columnRegistry.isDerived(target.type)) {
          throw new McpUserError(`Column "${target.title}" cannot be changed here.`);
        }
        const { addLabels, ...rest } = settings;
        for (const key of ['labels', 'tags', 'type']) {
          if (key in rest) {
            throw new McpUserError(
              `"${key}" cannot be set directly. Add labels with "addLabels"; labels already in use are never removed.`,
            );
          }
        }
        let next = { ...target.settings, ...rest };
        if (addLabels !== undefined) next = addLabelsToSettings(target.type, next, addLabels);
        next = validSettings(target.type, next);
        const columns = board.columns.map((c) =>
          c.id === target.id ? { ...c, settings: next } : c,
        );
        return {
          patch: { columns },
          result: {
            id: target.id,
            title: target.title,
            type: target.type,
            ...labelSummary({ ...target, settings: next }),
          },
        };
      });
    },
    async renameColumn({ boardId, column, title }) {
      return mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        const next = title.trim();
        if (next === '') throw new McpUserError('The column title cannot be empty.');
        const clash = board.columns.find(
          (c) => c.id !== target.id && c.title.trim().toLowerCase() === next.toLowerCase(),
        );
        if (clash) throw new McpUserError(`A column called "${clash.title}" already exists.`);
        const columns = board.columns.map((c) => (c.id === target.id ? { ...c, title: next } : c));
        return { patch: { columns }, result: { id: target.id, title: next, was: target.title } };
      });
    },
    async deleteColumn({ boardId, column }) {
      const outcome = await mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        if (target.migrating) {
          throw new McpUserError(
            `Column "${target.title}" is changing type; try again in a minute.`,
          );
        }
        const patch = { columns: board.columns.filter((c) => c.id !== target.id) };
        // The lock goes with the column (as the web does), so no stale id stays in `columnLocks`.
        if ((board.columnLocks ?? []).includes(target.id)) {
          patch.columnLocks = board.columnLocks.filter((id) => id !== target.id);
        }
        const keepValues =
          columnRegistry.isDerived(target.type) ||
          columnRegistry.isServerManaged(target.type) ||
          target.required === true ||
          (board.requiredColumnIds ?? []).includes(target.id);
        return {
          patch,
          result: { id: target.id, title: target.title, type: target.type, keepValues },
        };
      });
      // Clear the stored cells, in chunks. Derived and server-managed columns store nothing the
      // client may write, and a required column's cells cannot be emptied until the server drops
      // its required flag (rules REQ-1); their leftovers are invisible without the column.
      let cleared = 0;
      let warning;
      if (!outcome.keepValues) {
        const withValue = (await itemsOf(boardId)).filter(
          (d) => d.data.values?.[outcome.id] !== undefined,
        );
        try {
          for (let at = 0; at < withValue.length; at += 200) {
            const chunk = withValue.slice(at, at + 200);
            await client.commit(
              chunk.map((d) => ({
                op: 'update',
                path: `boards/${boardId}/items/${d.id}`,
                set: { updatedAt: now(), updatedBy: uid },
                remove: [`values.${outcome.id}`],
              })),
            );
            cleared += chunk.length;
          }
        } catch {
          warning = `The column was deleted, but cleaning up its values stopped after ${cleared} of ${withValue.length} item(s); the rest keep invisible leftovers.`;
        }
      }
      return {
        deleted: outcome.id,
        title: outcome.title,
        valuesCleared: cleared,
        ...(warning ? { warning } : {}),
      };
    },
    async reorderColumns({ boardId, columns }) {
      return mutateBoard(boardId, (board) => {
        const ids = columns.map((ref) => findColumn(board, ref).id);
        if (new Set(ids).size !== ids.length) {
          throw new McpUserError('A column is listed twice; list every column exactly once.');
        }
        if (ids.length !== board.columns.length) {
          const missing = board.columns
            .filter((c) => !ids.includes(c.id))
            .map((c) => `"${c.title}"`);
          throw new McpUserError(`List every column of the board; missing: ${missing.join(', ')}.`);
        }
        const positions = evenPositions(ids.length);
        const byId = new Map(board.columns.map((c) => [c.id, c]));
        const reordered = ids.map((id, i) => ({ ...byId.get(id), position: positions[i] }));
        return {
          patch: { columns: reordered },
          result: { columns: reordered.map((c) => ({ id: c.id, title: c.title })) },
        };
      });
    },
    async setColumnLock({ boardId, column, locked }) {
      return mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        const current = board.columnLocks ?? [];
        const isLocked = current.includes(target.id);
        const next = locked
          ? isLocked
            ? current
            : [...current, target.id]
          : current.filter((id) => id !== target.id);
        if (next.length > 200) throw new McpUserError('A board can lock at most 200 columns.');
        return {
          patch: { columnLocks: next },
          result: { id: target.id, title: target.title, locked, changed: isLocked !== locked },
        };
      });
    },
    async renameBoard({ boardId, name, description }) {
      if (name === undefined && description === undefined) {
        throw new McpUserError('Give a name or a description to change.');
      }
      const patch = {};
      if (name !== undefined) {
        const trimmed = String(name).trim();
        if (trimmed.length < 1 || trimmed.length > 120) {
          throw new McpUserError('A board name has 1 to 120 characters.');
        }
        patch.name = trimmed;
      }
      if (description !== undefined) {
        if (String(description).length > 1000) {
          throw new McpUserError('A board description has at most 1000 characters.');
        }
        patch.description = String(description);
      }
      return mutateBoard(
        boardId,
        (board) => ({
          patch,
          result: {
            id: boardId,
            name: patch.name ?? board.name,
            description: patch.description ?? board.description ?? '',
            was: { name: board.name, description: board.description ?? '' },
          },
        }),
        { need: 'edit' },
      );
    },
    async setBoardState({ boardId, to }) {
      const from = {
        archived: ['active'],
        deleted: ['active', 'archived'],
        active: ['archived', 'deleted'],
      }[to];
      return mutateBoard(
        boardId,
        async (board) => {
          if (!from.includes(board.state)) {
            throw new McpUserError(
              board.state === to
                ? `Board "${boardId}" is already ${to}.`
                : `Board "${boardId}" is ${board.state}; only a board that is ${from.join(' or ')} can become ${to}.`,
            );
          }
          const patch = { state: to, deletedAt: to === 'deleted' ? now() : null };
          if (to === 'active' && board.folderId) {
            const folder = await client.getDoc(
              `workspaces/${board.workspaceId}/folders/${board.folderId}`,
            );
            if (!folder) patch.folderId = null;
          }
          return { patch, result: { id: boardId, name: board.name, state: to, was: board.state } };
        },
        {
          need: 'owner',
          states: ['active', 'archived', 'deleted'],
          ownerMessage: 'Archiving, trashing or restoring a board needs the board owner role.',
        },
      );
    },
  };
}
