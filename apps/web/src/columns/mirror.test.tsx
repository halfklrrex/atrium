import type { ColumnDef, MirrorSettings, MirrorValue } from '@atrium/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import type * as firestore from 'firebase/firestore';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocsMock, getDocMock } = vi.hoisted(() => ({
  getDocsMock: vi.fn(),
  getDocMock: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return {
    ...actual,
    getDocs: getDocsMock,
    getDoc: getDocMock,
    where: (field: unknown, op: string, value: unknown) => ({ field, op, value }),
    query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
    documentId: () => '__name__',
  };
});

vi.mock('../data/firestore', () => ({
  refs: {
    items: (boardId: string) => ({ type: 'items-ref', boardId }),
    board: (boardId: string) => ({ type: 'board-ref', boardId }),
  },
  queries: {},
}));

import { isOrderable } from '../components/board-filters/filter-store';
import { clearBoardRelationCacheForTests } from './board-relation';
import { mirrorUi } from './mirror';
import type { CellContext, CellProps } from './types';

const Cell = mirrorUi.Cell as ComponentType<CellProps<MirrorValue, MirrorSettings>>;

const STATUS_LABELS = [
  { id: 'working', index: 0, label: 'Working on it', color: '#fdab3d' },
  { id: 'done', index: 1, label: 'Done', color: '#00c875' },
  { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
];

const TARGET_COLUMNS: ColumnDef[] = [
  {
    id: 'status',
    type: 'status',
    title: 'Status',
    position: 'a0',
    settings: { labels: STATUS_LABELS },
  },
  {
    id: 'budget',
    type: 'numbers',
    title: 'Budget',
    position: 'a1',
    settings: { unit: { symbol: '$', direction: 'left' }, decimals: 0 },
  },
  { id: 'due', type: 'date', title: 'Due', position: 'a2', settings: {} },
  { id: 'note', type: 'text', title: 'Note', position: 'a3', settings: {} },
  {
    id: 'area',
    type: 'dropdown',
    title: 'Area',
    position: 'a4',
    settings: {
      labels: [
        { id: 1, label: 'Design' },
        { id: 2, label: 'Legal' },
      ],
    },
  },
];

interface LinkedDoc {
  name: string;
  state?: string;
  values: Record<string, unknown>;
}

/** What the "linked board" holds; ids that are absent here do not exist (or are unreadable). */
const LINKED: Record<string, LinkedDoc> = {
  'item-1': {
    name: 'Alpha',
    values: {
      status: { index: 1 },
      budget: 100,
      due: { date: '2026-03-10' },
      note: 'first',
      area: { ids: [1] },
    },
  },
  'item-2': {
    name: 'Beta',
    values: {
      status: { index: 0 },
      budget: '250',
      due: { date: '2026-03-02' },
      note: 'second',
      area: { ids: [2, 1] },
    },
  },
  'item-3': { name: 'Gamma', values: {} },
  'item-4': { name: 'Gone', state: 'deleted', values: { status: { index: 2 }, budget: 999 } },
};

const refsOf = (...ids: string[]) => ({
  linkedItems: ids.map((itemId) => ({ boardId: 'board-a', itemId })),
});

const column: ColumnDef = {
  id: 'mirror',
  type: 'mirror',
  title: 'Mirror',
  position: 'a9',
  settings: {},
};

function settingsOf(target: string, aggregation: MirrorSettings['aggregation']): MirrorSettings {
  return { relationColumnId: 'rel', targetColumnIds: { 'board-a': target }, aggregation };
}

function ctxFor(rowId: string, relation: unknown): CellContext {
  return {
    highlight: '',
    rowDone: false,
    canEdit: false,
    itemId: rowId,
    getItems: () => [{ id: rowId, name: 'Row', values: { rel: relation } }],
  };
}

function renderCell(
  target: string,
  aggregation: MirrorSettings['aggregation'],
  relation: unknown,
  rowId = 'row-1',
) {
  return render(
    <Cell
      value={null}
      settings={settingsOf(target, aggregation)}
      column={column}
      ctx={ctxFor(rowId, relation)}
      onChange={vi.fn()}
    />,
  );
}

describe('mirror column UI', () => {
  beforeEach(() => {
    clearBoardRelationCacheForTests();
    getDocsMock.mockReset();
    getDocMock.mockReset();
    getDocsMock.mockImplementation(async (q: { constraints: { value: string[] }[] }) => ({
      docs: q.constraints[0]!.value.flatMap((id) => {
        const doc = LINKED[id];
        return doc ? [{ id, data: () => ({ state: 'active', ...doc }) }] : [];
      }),
    }));
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ columns: TARGET_COLUMNS }) });
  });

  it('is read-only, derived and registered as a Mirror', () => {
    expect(mirrorUi.type).toBe('mirror');
    expect(mirrorUi.editor).toBe('none');
    expect(isOrderable(column)).toBe(false);
    expect(isOrderable({ ...column, type: 'text' })).toBe(true);
  });

  it('shows a muted "..." while loading, then the mirrored values, never an id', async () => {
    renderCell('note', 'none', refsOf('item-1', 'item-2'));
    expect(screen.getByText('...')).toBeInTheDocument();
    expect(await screen.findByText('first, second')).toBeInTheDocument();
    expect(screen.queryByText('...')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/item-\d|board-a/);
  });

  it('renders status targets as coloured chips and collapses extras into +N', async () => {
    getDocsMock.mockImplementation(async (q: { constraints: { value: string[] }[] }) => ({
      docs: q.constraints[0]!.value.map((id, i) => ({
        id,
        data: () => ({ state: 'active', name: id, values: { status: { index: i % 3 } } }),
      })),
    }));
    renderCell('status', 'none', refsOf('a', 'b', 'c', 'd'));
    const chip = await screen.findByText('Working on it');
    expect(chip).toHaveStyle({ backgroundColor: '#fdab3d' });
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Stuck')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('renders dropdown targets as plain pills', async () => {
    renderCell('area', 'none', refsOf('item-1', 'item-2'));
    expect(await screen.findAllByText('Design')).toHaveLength(2);
    expect(screen.getByText('Legal')).toBeInTheDocument();
  });

  it('skips deleted and unreadable linked items and shows an empty cell when all are skipped', async () => {
    const { container } = renderCell('note', 'none', refsOf('item-4', 'missing'));
    await waitFor(() => expect(screen.queryByText('...')).not.toBeInTheDocument());
    expect(container.textContent).toBe('');

    const second = renderCell('note', 'none', refsOf('item-4', 'missing', 'item-1'), 'row-2');
    expect(await second.findByText('first')).toBeInTheDocument();
    expect(second.container.textContent).toBe('first');
  });

  it('shows an empty cell without a relation value or relation column', () => {
    const { container } = renderCell('note', 'none', undefined);
    expect(container.textContent).toBe('');
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['budget', 'sum', '$350'],
    ['budget', 'average', '$175'],
    ['budget', 'min', '$100'],
    ['budget', 'max', '$250'],
    ['budget', 'count', '3'],
    ['budget', 'count_filled', '2'],
    ['budget', 'count_empty', '1'],
    ['budget', 'percent_filled', '67%'],
  ] as const)('renders %s with the %s aggregation as %s', async (target, aggregation, expected) => {
    renderCell(target, aggregation, refsOf('item-1', 'item-2', 'item-3'));
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('renders earliest and latest for a date target', async () => {
    const earliest = renderCell('due', 'earliest', refsOf('item-1', 'item-2'), 'row-a');
    const earliestText = (await within(earliest.container).findByTitle(/.+/)).textContent;
    const latest = renderCell('due', 'latest', refsOf('item-1', 'item-2'), 'row-b');
    const latestText = (await within(latest.container).findByTitle(/.+/)).textContent;
    expect(earliestText).toBeTruthy();
    expect(latestText).toBeTruthy();
    expect(earliestText).not.toBe(latestText);
  });

  it('two cells linking the same item cause one read', async () => {
    render(
      <>
        <Cell
          value={null}
          settings={settingsOf('note', 'none')}
          column={column}
          ctx={ctxFor('row-1', refsOf('item-1', 'item-2'))}
          onChange={vi.fn()}
        />
        <Cell
          value={null}
          settings={settingsOf('budget', 'sum')}
          column={column}
          ctx={ctxFor('row-2', refsOf('item-2', 'item-1'))}
          onChange={vi.fn()}
        />
      </>,
    );
    expect(await screen.findByText('first, second')).toBeInTheDocument();
    expect(await screen.findByText('$350')).toBeInTheDocument();
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(getDocMock).toHaveBeenCalledTimes(1);
  });
});
