import { z } from 'zod';
import { columnRegistry } from '../columns';
import { auditFields, type WriteDoc } from './common';
import { columnDefSchema, groupDefSchema, slugIdSchema, type ColumnDef } from './board';

/** Limits shared by the saved-template rules, the schema and the UI (P7 templates spec). */
export const TEMPLATE_LIMITS = {
  name: 80,
  description: 300,
  sampleItems: 50,
  columns: 60,
  groups: 100,
} as const;

/** What a board is built from: the part of a board a template carries. */
export const templateStructureSchema = z.object({
  columns: z.array(columnDefSchema).max(TEMPLATE_LIMITS.columns),
  subitemColumns: z.array(columnDefSchema).max(TEMPLATE_LIMITS.columns),
  groups: z.array(groupDefSchema).min(1).max(TEMPLATE_LIMITS.groups),
  itemTerminology: z.string().min(1).max(40),
});
export type TemplateStructure = z.infer<typeof templateStructureSchema>;

/** A sample item. Position is not stored: it is derived from the list order when a board is built. */
export const templateSampleItemSchema = z.object({
  name: z.string().min(1).max(500),
  groupId: slugIdSchema,
  values: z.record(z.string(), z.unknown()),
});
export type TemplateSampleItem = z.infer<typeof templateSampleItemSchema>;

/** `workspaces/{workspaceId}/templates/{templateId}`. */
export const boardTemplateSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
  description: z.string().max(TEMPLATE_LIMITS.description),
  structure: templateStructureSchema,
  sampleItems: z.array(templateSampleItemSchema).max(TEMPLATE_LIMITS.sampleItems),
  /** Always `sampleItems.length`; kept so the gallery can show it without reading the items. */
  itemCount: z.number().int().min(0).max(TEMPLATE_LIMITS.sampleItems),
  ...auditFields,
});
export type BoardTemplate = z.infer<typeof boardTemplateSchema>;
export type BoardTemplateWrite = WriteDoc<BoardTemplate>;

/** What the "Save as template" dialog collects. */
export const saveTemplateInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(TEMPLATE_LIMITS.name),
  description: z.string().trim().max(TEMPLATE_LIMITS.description).default(''),
  includeItems: z.boolean().default(false),
});
export type SaveTemplateInput = z.input<typeof saveTemplateInputSchema>;

/** Rename / re-describe a saved template. */
export const templateDetailsSchema = saveTemplateInputSchema.pick({
  name: true,
  description: true,
});
export type TemplateDetailsInput = z.input<typeof templateDetailsSchema>;

/**
 * `migrating` and `lastTypeChange` on a column def are written only by the changeColumnType and
 * revertColumnType Cloud Functions, so a copy of a board (duplicate or template) never carries them.
 */
export function withoutServerColumnFields(columns: readonly ColumnDef[]): ColumnDef[] {
  return columns.map((column) => {
    const { migrating: _m, lastTypeChange: _l, ...rest } = column;
    void _m;
    void _l;
    return rest;
  });
}

/**
 * Column types whose cell values name people or other boards' items. They make no sense in a
 * template (and would leak uids), so their values are dropped from sample items.
 */
const IDENTITY_VALUE_TYPES: ReadonlySet<string> = new Set(['people', 'vote', 'dependency']);
/** Column types that point at other boards: left out of a template altogether. */
const CROSS_BOARD_TYPES: ReadonlySet<string> = new Set(['board_relation', 'mirror']);

/** The part of a board `templateFromBoard` reads. */
export interface TemplateSourceBoard {
  columns: readonly ColumnDef[];
  subitemColumns: readonly ColumnDef[];
  groups: readonly {
    id: string;
    title: string;
    color: string;
    position: string;
    collapsed?: boolean;
  }[];
  itemTerminology: string;
}

export interface TemplateSourceItem {
  name: string;
  groupId: string;
  position: string;
  parentItemId: string | null;
  state: string;
  values: Readonly<Record<string, unknown>>;
}

export interface TemplateContent {
  structure: TemplateStructure;
  sampleItems: TemplateSampleItem[];
}

function cleanColumns(columns: readonly ColumnDef[]): ColumnDef[] {
  return withoutServerColumnFields(columns.filter((c) => !CROSS_BOARD_TYPES.has(c.type)));
}

/**
 * Build the template content for a board: its structure (without server-only column marks and
 * cross-board columns) and, when `includeItems` is set, up to `TEMPLATE_LIMITS.sampleItems` active
 * top-level items in group then position order. Values of derived, server-managed, people, vote and
 * dependency columns are dropped, as are values that no longer validate.
 */
export function templateFromBoard(
  board: TemplateSourceBoard,
  items: readonly TemplateSourceItem[],
  options: { includeItems: boolean },
): TemplateContent {
  const columns = cleanColumns(board.columns);
  const structure: TemplateStructure = {
    columns,
    subitemColumns: cleanColumns(board.subitemColumns),
    groups: board.groups.map((g) => ({ ...g })),
    itemTerminology: board.itemTerminology,
  };
  if (!options.includeItems) return { structure, sampleItems: [] };

  const columnsById = new Map(columns.map((c) => [c.id, c]));
  const groupOrder = new Map(
    [...structure.groups]
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
      .map((g, i) => [g.id, i]),
  );
  const sampleItems = items
    .filter((i) => i.state === 'active' && i.parentItemId === null && groupOrder.has(i.groupId))
    .sort(
      (a, b) =>
        (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) ||
        (a.position < b.position ? -1 : a.position > b.position ? 1 : 0),
    )
    .slice(0, TEMPLATE_LIMITS.sampleItems)
    .map((item): TemplateSampleItem => {
      const values: Record<string, unknown> = {};
      for (const [columnId, value] of Object.entries(item.values)) {
        const column = columnsById.get(columnId);
        if (!column || value === null || value === undefined) continue;
        if (IDENTITY_VALUE_TYPES.has(column.type)) continue;
        if (!columnRegistry.has(column.type)) continue;
        if (columnRegistry.isDerived(column.type) || columnRegistry.isServerManaged(column.type)) {
          continue;
        }
        if (!columnRegistry.validateCell(column, value).ok) continue;
        values[columnId] = value;
      }
      return { name: item.name, groupId: item.groupId, values };
    });
  return { structure, sampleItems };
}

/** True when every sample item sits in a group the structure defines. */
export function templateGroupsResolve(content: TemplateContent): boolean {
  const ids = new Set(content.structure.groups.map((g) => g.id));
  return content.sampleItems.every((item) => ids.has(item.groupId));
}
