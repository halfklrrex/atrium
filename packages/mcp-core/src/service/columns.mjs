// Service methods: creating every column type, and editing labels. Receives the shared helpers of
// `createService` (see ../service.mjs). The web's equivalents are `table-actions.ts` `addColumn`,
// the column settings editors in `ColumnSettings.tsx` and `apps/web/src/columns/LabelEditors.tsx`.
import {
  boardRelationSettingsSchema,
  columnRegistry,
  findStatusLabel,
  statusValueSchema,
  validateFormulaSettings,
} from '@atrium/shared';
import { buildColumn, resolveColor } from '../builders.mjs';
import { McpUserError } from '../errors.mjs';
import { findColumn } from '../refs.mjs';
import { labelSummary } from './shared.mjs';

const norm = (text) => String(text).trim().toLowerCase();

/** Column types a Mirror cannot show (as `isMirrorTarget` in the web's column settings). */
const isMirrorTarget = (column) =>
  !['mirror', 'board_relation', 'button'].includes(column.type) &&
  columnRegistry.has(column.type) &&
  !columnRegistry.isDerived(column.type);

const NUMERIC_TARGETS = new Set(['numbers', 'progress']);
const DATE_TARGETS = new Set(['date', 'timeline', 'week']);

/** The aggregations the web offers for the chosen target column types (`aggregationsFor`). */
function aggregationsFor(targetTypes) {
  const offered = ['none', 'count', 'count_filled', 'count_empty', 'percent_filled'];
  if (targetTypes.some((t) => NUMERIC_TARGETS.has(t))) offered.push('sum', 'average', 'min', 'max');
  if (targetTypes.some((t) => DATE_TARGETS.has(t))) offered.push('earliest', 'latest');
  return offered;
}

/** The label entries of a status, dropdown or tags column in one shape. */
function labelKind(column) {
  const settings = column.settings ?? {};
  if (column.type === 'status') {
    return { key: 'labels', text: 'label', list: settings.labels ?? [], colored: true };
  }
  if (column.type === 'dropdown') {
    return { key: 'labels', text: 'label', list: settings.labels ?? [], colored: false };
  }
  if (column.type === 'tags') {
    return { key: 'tags', text: 'name', list: settings.tags ?? [], colored: true };
  }
  throw new McpUserError(
    `Only status, dropdown and tags columns have labels (column "${column.title}" is ${column.type}).`,
  );
}

export function columnsService(h) {
  const { client, uid, now, roleOn, loadBoard, mutateBoard, itemsOf } = h;

  /** The active boards of the workspace the actor can read, by id and by name. */
  async function readableBoards(workspaceId) {
    const rows = await client.runQuery('boards', { workspaceId });
    const out = [];
    for (const row of rows) {
      if (row.data.state !== 'active') continue;
      if (!(await roleOn(row.data))) continue;
      out.push({ id: row.id, ...row.data });
    }
    return out;
  }

  function pickBoard(boards, ref) {
    const byId = boards.find((b) => b.id === ref);
    if (byId) return byId;
    const named = boards.filter((b) => norm(b.name) === norm(ref));
    if (named.length === 1) return named[0];
    if (named.length > 1) {
      throw new McpUserError(
        `More than one board is called "${ref}" (ids: ${named.map((b) => b.id).join(', ')}). Use the id.`,
      );
    }
    throw new McpUserError(
      `Board "${ref}" was not found among the boards you can read in this workspace.`,
      'not_found',
    );
  }

  async function relationSettings(loaded, input) {
    const { boards, boardIds, twoWay, ...rest } = input;
    if (twoWay === true) {
      throw new McpUserError(
        'Two-way connections are not available through the connector (the web does not offer them either).',
      );
    }
    const refs = [...(boards ?? []), ...(boardIds ?? [])];
    if (refs.some((r) => typeof r !== 'string')) {
      throw new McpUserError('Give the connected boards as ids or names in settings.boards.');
    }
    const readable = await readableBoards(loaded.workspaceId);
    const ids = [...new Set(refs.map((ref) => pickBoard(readable, ref).id))];
    return { ...rest, boardIds: ids };
  }

  async function mirrorSettings(loaded, input) {
    const { board } = loaded;
    const {
      relationColumn,
      relationColumnId,
      targetColumns,
      targetColumnIds,
      aggregation,
      ...rest
    } = input;
    if (Object.keys(rest).length > 0) {
      throw new McpUserError(
        `Unknown mirror settings: ${Object.keys(rest).join(', ')}. Use relationColumn, targetColumns and aggregation.`,
      );
    }
    const relationRef = relationColumn ?? relationColumnId;
    const relations = board.columns.filter((c) => c.type === 'board_relation');
    if (relations.length === 0) {
      throw new McpUserError(
        'A mirror column needs a Connect boards column on this board first. Add one with type board_relation.',
      );
    }
    if (relationRef === undefined) {
      throw new McpUserError(
        `Say which Connect boards column to mirror in settings.relationColumn: ${relations
          .map((c) => `"${c.title}"`)
          .join(', ')}.`,
      );
    }
    const relation = findColumn({ columns: relations }, relationRef);
    const connected = boardRelationSettingsSchema.parse(relation.settings ?? {}).boardIds;
    if (connected.length === 0) {
      throw new McpUserError(
        `Connect boards column "${relation.title}" is not connected to any board yet.`,
      );
    }
    // Only linked boards the actor can read have values to show (as in the web).
    const linked = [];
    for (const boardId of connected) {
      const meta = await client.getDocMeta(`boards/${boardId}`);
      if (!meta || meta.data.state !== 'active' || !(await roleOn(meta.data))) continue;
      linked.push({ id: boardId, ...meta.data });
    }
    const picks = {};
    for (const [boardRef, columnRef] of Object.entries(targetColumns ?? targetColumnIds ?? {})) {
      const target = pickBoard(linked, boardRef);
      const column = findColumn({ columns: target.columns }, columnRef);
      if (!isMirrorTarget(column)) {
        throw new McpUserError(
          `Column "${column.title}" (${column.type}) on "${target.name}" cannot be mirrored: calculated, mirror, connect-boards and button columns are not shown.`,
        );
      }
      picks[target.id] = column;
    }
    if (Object.keys(picks).length === 0) {
      throw new McpUserError(
        `Say which column to show from each connected board in settings.targetColumns, for example { "${linked[0]?.name ?? 'Board'}": "<column title>" }.`,
      );
    }
    const chosen = aggregation ?? 'none';
    const offered = aggregationsFor(Object.values(picks).map((c) => c.type));
    if (!offered.includes(chosen)) {
      throw new McpUserError(
        `Aggregation "${chosen}" does not fit the chosen columns. Use one of: ${offered.join(', ')}.`,
      );
    }
    return {
      relationColumnId: relation.id,
      targetColumnIds: Object.fromEntries(Object.entries(picks).map(([b, c]) => [b, c.id])),
      aggregation: chosen,
    };
  }

  function progressSettings(board, input) {
    const { statusColumns, ...rest } = input;
    if (statusColumns === undefined) return rest;
    if (!Array.isArray(statusColumns) || statusColumns.length === 0) {
      throw new McpUserError(
        'settings.statusColumns lists the status columns to count (titles or ids).',
      );
    }
    const ids = [
      ...new Set(
        statusColumns.map((ref) => {
          const column = findColumn(board, ref);
          if (column.type !== 'status') {
            throw new McpUserError(`Column "${column.title}" is not a status column.`);
          }
          return column.id;
        }),
      ),
    ];
    const percentage = Math.round(100 / ids.length);
    return {
      ...rest,
      related_columns: {
        isNormalized: true,
        columns: Object.fromEntries(ids.map((id) => [id, { isSelected: true, percentage }])),
      },
    };
  }

  function dependencySettings(board, input) {
    const { timeColumn, ...rest } = input;
    if (timeColumn === undefined) return rest;
    const column = findColumn(board, timeColumn);
    if (!['date', 'timeline'].includes(column.type)) {
      throw new McpUserError(`Column "${column.title}" is not a date or timeline column.`);
    }
    return { ...rest, timeColumnId: column.id };
  }

  /**
   * The column definition for `atrium_add_column`: settings are resolved from titles and names to ids
   * where the type needs them, then built with the type's defaults and validated like the web's
   * column settings (`validateColumnDef`, the formula parser, the relation and mirror choices).
   */
  async function prepareColumn({ loaded, title, type, settings }) {
    const { board } = loaded;
    let input = settings ?? {};
    if (type === 'board_relation') input = await relationSettings(loaded, input);
    else if (type === 'mirror') input = await mirrorSettings(loaded, input);
    else if (type === 'progress') input = progressSettings(board, input);
    else if (type === 'dependency') input = dependencySettings(board, input);
    const column = buildColumn({ title, type, settings: input, existingColumns: board.columns });
    if (type === 'formula') {
      const checked = validateFormulaSettings(
        column.settings.expression ?? '',
        [...board.columns, column],
        column.id,
      );
      if (!checked.valid) throw new McpUserError(`Invalid formula: ${checked.error}`);
    }
    return column;
  }

  // ---- labels --------------------------------------------------------------------------------

  /** Finds a label by id or (case-insensitive) text; the empty status label is never addressed. */
  function pickLabel(kind, ref) {
    if (ref === undefined || ref === null || String(ref).trim() === '') {
      throw new McpUserError('Name each label by its text or id.');
    }
    const text = (entry) => entry[kind.text];
    const named = kind.list.filter((e) => text(e).trim() !== '');
    const byId = named.find((e) => String(e.id) === String(ref));
    if (byId) return byId;
    const found = named.filter((e) => norm(text(e)) === norm(ref));
    if (found.length === 1) return found[0];
    if (found.length > 1) {
      throw new McpUserError(
        `More than one label is called "${ref}" (ids: ${found.map((e) => e.id).join(', ')}). Use the id.`,
      );
    }
    const known = named.map((e) => `"${text(e)}"`).join(', ') || 'none';
    throw new McpUserError(`No label "${ref}" on this column. Labels: ${known}.`);
  }

  /** How many stored cells of `docs` hold each label of the column (any item state, subitems included). */
  function usage(column, kind, docs) {
    const counts = new Map(kind.list.map((e) => [e.id, 0]));
    const holders = new Map(kind.list.map((e) => [e.id, []]));
    for (const doc of docs) {
      const value = doc.data.values?.[column.id];
      if (value === undefined || value === null) continue;
      const hit = [];
      if (column.type === 'status') {
        const parsed = statusValueSchema.safeParse(value);
        const label = parsed.success ? findStatusLabel(parsed.data, { labels: kind.list }) : null;
        if (label) hit.push(label.id);
      } else if (column.type === 'dropdown') {
        for (const id of Array.isArray(value.ids) ? value.ids : []) hit.push(id);
      } else {
        for (const id of Array.isArray(value.tag_ids) ? value.tag_ids : []) hit.push(id);
      }
      for (const id of hit) {
        if (!counts.has(id)) continue;
        counts.set(id, counts.get(id) + 1);
        holders.get(id).push(doc);
      }
    }
    return { counts, holders };
  }

  /** The new label list and what the call would change. Pure apart from reading the items. */
  async function planLabels(board, args) {
    const target = findColumn(board, args.column);
    if (target.migrating) throw new McpUserError(`Column "${target.title}" is changing type.`);
    const kind = labelKind(target);
    const { rename = [], recolor = [], order, remove = [] } = args;
    if (rename.length + recolor.length + remove.length === 0 && order === undefined) {
      throw new McpUserError('Give something to change: rename, recolor, order or remove.');
    }
    if (recolor.length > 0 && !kind.colored) {
      throw new McpUserError('Dropdown options have no colors; recolor works on status and tags.');
    }
    let list = kind.list.map((e) => ({ ...e }));
    const entry = (original) => list.find((e) => e.id === original.id);

    const renamed = [];
    for (const { from, to } of rename) {
      const label = pickLabel({ ...kind, list }, from);
      const next = String(to).trim();
      if (next === '' || next.length > maxLabelLength(target)) {
        throw new McpUserError(`A label name has 1 to ${maxLabelLength(target)} characters.`);
      }
      renamed.push({ from: label[kind.text], to: next });
      entry(label)[kind.text] = next;
    }
    const names = list.filter((e) => e[kind.text].trim() !== '').map((e) => norm(e[kind.text]));
    if (new Set(names).size !== names.length) {
      throw new McpUserError('Two labels would share a name; label names must be different.');
    }

    const recolored = [];
    for (const { label: ref, color } of recolor) {
      const label = pickLabel({ ...kind, list }, ref);
      const hex = resolveColor(color).toLowerCase();
      entry(label).color = hex;
      recolored.push({ label: label[kind.text], color: hex });
    }

    if (order !== undefined) {
      const picked = order.map((ref) => pickLabel({ ...kind, list }, ref));
      const ids = picked.map((e) => e.id);
      if (new Set(ids).size !== ids.length) {
        throw new McpUserError('A label is listed twice; list every label exactly once.');
      }
      const named = list.filter((e) => e[kind.text].trim() !== '');
      if (ids.length !== named.length) {
        const missing = named.filter((e) => !ids.includes(e.id)).map((e) => `"${e[kind.text]}"`);
        throw new McpUserError(`List every label of the column; missing: ${missing.join(', ')}.`);
      }
      // As the web saves it: the listed order, then the empty "no status" label (never reordered).
      const fixed = list.filter((e) => e[kind.text].trim() === '');
      list = [...picked.map((p) => list.find((e) => e.id === p.id)), ...fixed];
    }

    const removeIds = new Set();
    for (const ref of remove) removeIds.add(pickLabel({ ...kind, list }, ref).id);
    const used = usage(target, kind, args.docs ?? []);
    const removed = [...removeIds].map((id) => {
      const label = list.find((e) => e.id === id);
      return { label: label[kind.text], items: used.counts.get(id) ?? 0 };
    });
    list = list.filter((e) => !removeIds.has(e.id));
    const remaining = list.filter((e) => e[kind.text].trim() !== '');
    if (target.type === 'status' && remaining.length === 0) {
      throw new McpUserError('A status column keeps at least one label with a name.');
    }

    const settings = { ...target.settings, [kind.key]: list };
    const parsed = columnRegistry.parseSettings(target.type, settings);
    if (!parsed.success) {
      throw new McpUserError(`Invalid labels for a ${target.type} column: ${parsed.error}`);
    }
    return { target, kind, settings: parsed.data, renamed, recolored, removed, removeIds, used };
  }

  /** The item writes that clear removed labels from cells (the web leaves them dangling, which would show a new label that reuses an index). */
  function cellClears(plan) {
    const { target, removeIds, used } = plan;
    const writes = new Map();
    for (const id of removeIds) {
      for (const doc of used.holders.get(id) ?? []) {
        const value = doc.data.values?.[target.id];
        let next = null;
        if (target.type === 'dropdown') {
          const ids = (value.ids ?? []).filter((x) => !removeIds.has(x));
          if (ids.length > 0) next = { ...value, ids };
        } else if (target.type === 'tags') {
          const ids = (value.tag_ids ?? []).filter((x) => !removeIds.has(x));
          if (ids.length > 0) next = { ...value, tag_ids: ids };
        }
        writes.set(doc.id, next);
      }
    }
    return writes;
  }

  const summary = (plan, settings) => ({
    id: plan.target.id,
    title: plan.target.title,
    type: plan.target.type,
    ...labelSummary({ ...plan.target, settings }),
    renamed: plan.renamed,
    recolored: plan.recolored,
    removed: plan.removed,
  });

  return {
    prepareColumn,
    async editLabels(args) {
      const { boardId, dryRun = false, allowDataLoss = false } = args;
      // The role check comes first: the items of a board are only read for its owner.
      const first = await loadBoard(boardId, 'owner');
      const docs = await itemsOf(boardId);
      const guard = (plan) => {
        const lost = plan.removed.filter((r) => r.items > 0);
        if (lost.length === 0 || allowDataLoss || dryRun) return;
        const list = lost.map((r) => `"${r.label}" on ${r.items} item${r.items === 1 ? '' : 's'}`);
        throw new McpUserError(
          `Removing ${list.join(', ')} would clear those cells. Run it again with allowDataLoss: true, or use dryRun to preview.`,
        );
      };
      if (dryRun) {
        const plan = await planLabels(first.board, { ...args, docs });
        const affected = new Set([...cellClears(plan).keys()]);
        return {
          dryRun: true,
          ...summary(plan, plan.settings),
          itemsAffected: affected.size,
          needsAllowDataLoss: affected.size > 0,
        };
      }
      const outcome = await mutateBoard(boardId, async (board) => {
        const plan = await planLabels(board, { ...args, docs });
        guard(plan);
        if (
          plan.target.required === true ||
          (board.requiredColumnIds ?? []).includes(plan.target.id)
        ) {
          if (cellClears(plan).size > 0) {
            throw new McpUserError(
              `Column "${plan.target.title}" is required, so cells holding a removed label cannot be emptied. Move those items to another label first.`,
            );
          }
        }
        const columns = board.columns.map((c) =>
          c.id === plan.target.id ? { ...c, settings: plan.settings } : c,
        );
        return {
          patch: { columns },
          result: { plan, result: summary(plan, plan.settings), clears: cellClears(plan) },
        };
      });
      const { plan, result, clears } = outcome;
      let cleared = 0;
      let warning;
      const entries = [...clears];
      try {
        for (let at = 0; at < entries.length; at += 200) {
          const chunk = entries.slice(at, at + 200);
          await client.commit(
            chunk.map(([itemId, next]) => ({
              op: 'update',
              path: `boards/${boardId}/items/${itemId}`,
              set: {
                updatedAt: now(),
                updatedBy: uid,
                ...(next === null ? {} : { [`values.${plan.target.id}`]: next }),
              },
              remove: next === null ? [`values.${plan.target.id}`] : [],
            })),
          );
          cleared += chunk.length;
        }
      } catch {
        warning = `The labels were changed, but clearing the removed labels from cells stopped after ${cleared} of ${entries.length} item(s); the rest keep dangling values.`;
      }
      return { ...result, itemsCleared: cleared, ...(warning ? { warning } : {}) };
    },
  };
}

/** Label text limit: status labels and dropdown options 60, tags 100 (the schemas'). */
function maxLabelLength(column) {
  return column.type === 'tags' ? 100 : 60;
}
