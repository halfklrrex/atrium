// Tool catalogue: label editing for status, dropdown and tags columns (column creation is
// `atrium_add_column` in boards.mjs).
import { z } from 'zod';
import { UNTRUSTED, change, id, ref } from './helpers.mjs';

const labelRef = z.string().min(1).max(100).describe('A label by its text or id.');

/** @param {ReturnType<typeof import('../service.mjs').createService>} service */
export const columnTools = (service) => [
  change({
    name: 'atrium_edit_labels',
    description:
      'Edits the labels of a status, dropdown or tags column in one call (board owner): rename = [{from, to}], ' +
      'recolor = [{label, color}] (status and tags; a palette name or #RRGGBB), order = every label once in the wanted order, ' +
      'remove = [labels]. Status keeps its empty "no status" label as it is, and at least one named label; label names must stay different. ' +
      'Item cells keep pointing at renamed and recolored labels. Removing a label that items use clears it from those items, ' +
      'so the call refuses until allowDataLoss is true and says how many items per label (a required column refuses outright); ' +
      'dryRun reports the same numbers and changes nothing. Add labels with atrium_update_column_settings.' +
      UNTRUSTED,
    inputSchema: {
      boardId: id,
      column: ref,
      rename: z
        .array(z.object({ from: labelRef, to: z.string().trim().min(1).max(100) }))
        .max(100)
        .optional(),
      recolor: z
        .array(z.object({ label: labelRef, color: z.string().min(1).max(20) }))
        .max(100)
        .optional(),
      order: z.array(labelRef).max(200).optional(),
      remove: z.array(labelRef).max(200).optional(),
      dryRun: z.boolean().optional().describe('Default false. Report only; nothing is written.'),
      allowDataLoss: z
        .boolean()
        .optional()
        .describe('Default false. Needed when a removed label is used by any item.'),
    },
    run: (args) => service.editLabels(args),
  }),
];
