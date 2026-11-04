import {
  BUILT_IN_TEMPLATES,
  columnRegistry,
  type TemplateSampleItem,
  type TemplateStructure,
} from '@atrium/shared';
import type { TemplateDoc } from '../../data';

/** One card in the gallery: a built-in or a saved template, flattened for display and for creation. */
export interface TemplateChoice {
  /** Unique across both sections, e.g. `builtin:project-tracker` or `saved:abc`. */
  key: string;
  source: 'builtin' | 'saved';
  id: string;
  name: string;
  description: string;
  /** Built-in icon key; saved templates have none. */
  icon?: string;
  structure: TemplateStructure;
  sampleItems: readonly TemplateSampleItem[];
  itemCount: number;
  /** For saved templates: who saved it (rename/delete rights). */
  createdBy?: string;
}

export function builtInChoices(): TemplateChoice[] {
  return BUILT_IN_TEMPLATES.map((t) => ({
    key: `builtin:${t.id}`,
    source: 'builtin',
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    structure: t.structure,
    sampleItems: t.sampleItems,
    itemCount: t.sampleItems.length,
  }));
}

export function savedChoices(saved: readonly TemplateDoc[]): TemplateChoice[] {
  return saved.map((t) => ({
    key: `saved:${t.id}`,
    source: 'saved',
    id: t.id,
    name: t.name,
    description: t.description,
    structure: t.structure,
    sampleItems: t.sampleItems,
    itemCount: t.itemCount,
    createdBy: t.createdBy,
  }));
}

/** Distinct column type labels of a template (the name column is implied and left out). */
export function columnTypeLabels(structure: TemplateStructure): string[] {
  const labels: string[] = [];
  for (const column of structure.columns) {
    if (column.type === 'name') continue;
    const label = columnRegistry.find(column.type)?.label ?? column.type;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}
