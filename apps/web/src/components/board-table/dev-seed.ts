/**
 * Developer-only sample data for the board table (reached from the toolbar's developer menu, which
 * only shows on the dev server with `?dev` in the address). Used for the 1,000 item performance
 * check and for the visual QA board shaped like the owner's Roadmap.
 */
import type { ColumnDef, GroupDef } from '@atrium/shared';
import { columnRegistry } from '@atrium/shared';
import { itemWrites, updateBoardStructure, type BoardDoc, type NewItemInput } from '../../data';
import { positionBetween } from '../../lib/positions';
import { GROUP_COLORS } from '../../theme/palette';
import { appendPositions } from './move-math';
import type { TableCtx } from './table-actions';

const WORDS = [
  'Firebase',
  'roadmap',
  'design',
  'tokens',
  'sign-in',
  'pipeline',
  'review',
  'table',
  'groups',
  'summary',
  'deploy',
  'rules',
  'tests',
];

const pick = <T>(list: readonly T[], n: number): T => list[n % list.length]!;

function sentence(seed: number): string {
  return [0, 3, 7].map((k) => pick(WORDS, seed + k)).join(' ');
}

function sampleValues(columns: readonly ColumnDef[], seed: number): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    const settings = columnRegistry.parseSettings(column.type, column.settings);
    const s = settings.success ? settings.data : columnRegistry.defaultSettings(column.type);
    switch (column.type) {
      case 'status': {
        const labels = (s as { labels: { index: number; label: string }[] }).labels.filter(
          (l) => l.label !== '',
        );
        if (seed % 7 !== 0 && labels.length)
          values[column.id] = { index: pick(labels, seed).index };
        break;
      }
      case 'text':
        values[column.id] = sentence(seed);
        break;
      case 'long_text':
        values[column.id] = { text: `${sentence(seed)}. ${sentence(seed + 5)} and more detail.` };
        break;
      case 'numbers':
        values[column.id] = String(((seed * 37) % 90) * 100 + 200);
        break;
      case 'date': {
        const day = 1 + (seed % 28);
        values[column.id] = {
          date: `2026-${seed % 2 ? '10' : '11'}-${String(day).padStart(2, '0')}`,
        };
        break;
      }
      case 'dropdown': {
        const labels = (s as { labels: { id: number }[] }).labels;
        if (labels.length) {
          const ids = [pick(labels, seed).id, pick(labels, seed + 2).id];
          values[column.id] = { ids: [...new Set(ids)] };
        }
        break;
      }
      case 'checkbox':
        if (seed % 3 === 0) values[column.id] = { checked: 'true' };
        break;
      case 'link':
        if (seed % 2 === 0) {
          values[column.id] = { url: 'https://example.com', text: `ref-${seed.toString(16)}` };
        }
        break;
      default:
        break;
    }
  }
  return values;
}

/** Add `count` items spread over the board's groups, with a value in every column. */
export async function seedItems(ctx: TableCtx, board: BoardDoc, count: number): Promise<void> {
  const groups = [...board.groups].sort((a, b) => a.position.localeCompare(b.position));
  if (groups.length === 0) return;
  const perGroup = Math.ceil(count / groups.length);
  const inputs: NewItemInput[] = [];
  let n = 0;
  for (const group of groups) {
    const keys = appendPositions([], perGroup);
    for (let i = 0; i < perGroup && n < count; i++, n++) {
      inputs.push({
        name: `Sample item ${n + 1}: ${sentence(n)}`,
        groupId: group.id,
        position: keys[i]!,
        values: sampleValues(board.columns, n),
      });
    }
  }
  await itemWrites.createMany(ctx.uid, ctx.boardId, inputs);
}

/**
 * Replace the board's structure with one shaped like the owner's Roadmap board: three groups and
 * the columns Area (dropdown), Scope (text), Spec / PR (link), Status, Priority, Date, Person and
 * Budget (numbers), plus about six items per group.
 */
export async function seedRoadmap(ctx: TableCtx): Promise<void> {
  const status = {
    labels: [
      { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
      { id: 'building', index: 0, label: 'Building', color: '#fdab3d' },
      { id: 'review', index: 3, label: 'In review', color: '#579bfc' },
      { id: 'notstarted', index: 4, label: 'Not started', color: '#757575' },
      { id: 'default_grey', index: 5, label: '', color: '#c4c4c4' },
    ],
  };
  const priority = {
    labels: [
      { id: 'critical', index: 0, label: 'Critical', color: '#df2f4a' },
      { id: 'high', index: 1, label: 'High', color: '#fdab3d' },
      { id: 'medium', index: 2, label: 'Medium', color: '#579bfc' },
      { id: 'default_grey', index: 5, label: '', color: '#c4c4c4' },
    ],
  };
  const area = {
    limitSelect: false,
    labels: ['Infra / DevOps', 'Data model', 'Security', 'UX / Design', 'Frontend', 'Backend'].map(
      (label, id) => ({ id, label }),
    ),
  };
  const specs: [string, string, string, Record<string, unknown>][] = [
    ['area', 'dropdown', 'Area', area],
    ['scope', 'long_text', 'Scope', {}],
    ['spec', 'link', 'Spec / PR', {}],
    ['status', 'status', 'Status', status],
    ['priority', 'status', 'Priority', priority],
    ['date', 'date', 'Date', { hideWeekdays: false }],
    ['person', 'people', 'Person', { singlePerson: false }],
    ['budget', 'numbers', 'Budget', { unit: { symbol: '$', direction: 'left' }, decimals: null }],
  ];
  let key: string | null = null;
  const columns: ColumnDef[] = specs.map(([id, type, title, settings]) => {
    key = positionBetween(key, null);
    return { id, type, title, position: key, settings };
  });
  const groupSpecs = [
    ['p0', 'P0 · Foundations', '#757575'],
    ['vf', 'VF · Visual fidelity to monday (continuous)', GROUP_COLORS[12]!.hex],
    ['p1', 'P1 · Core boards & table view', GROUP_COLORS[17]!.hex],
  ] as const;
  let gkey: string | null = null;
  const groups: GroupDef[] = groupSpecs.map(([id, title, color]) => {
    gkey = positionBetween(gkey, null);
    return { id, title, color, position: gkey };
  });
  await updateBoardStructure(ctx.boardId, () => ({ columns, groups }));

  const names = [
    'Firebase project, environments & emulators',
    'Architecture & data model spec',
    'Google sign-in & user profiles',
    'Repo scaffold & tooling',
    'Vibe design system & app shell',
    'CI/CD pipeline',
  ];
  const inputs: NewItemInput[] = [];
  for (const group of groups) {
    const keys = appendPositions([], 6);
    names.forEach((name, i) => {
      const seed = inputs.length + 1;
      const values = sampleValues(columns, seed);
      values.status = { index: [1, 1, 1, 0, 3, 4][(i + seed) % 6]! };
      values.priority = { index: i % 3 };
      inputs.push({
        name: `${name}${group.id === 'p0' ? '' : ` ${i + 1}`}`,
        groupId: group.id,
        position: keys[i]!,
        values,
      });
    });
  }
  await itemWrites.createMany(ctx.uid, ctx.boardId, inputs);
}
