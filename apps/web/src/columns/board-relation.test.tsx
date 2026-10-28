import type { BoardRelationSettings, BoardRelationValue, ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as firestore from 'firebase/firestore';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocsMock, whereMock, queryMock, documentIdMock } = vi.hoisted(() => ({
  getDocsMock: vi.fn(),
  whereMock: vi.fn((field: unknown, op: string, value: unknown) => ({ field, op, value })),
  queryMock: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
  documentIdMock: vi.fn(() => '__name__'),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return {
    ...actual,
    getDocs: getDocsMock,
    where: whereMock,
    query: queryMock,
    documentId: documentIdMock,
  };
});

vi.mock('../data/firestore', () => ({
  refs: {
    items: (boardId: string) => ({ type: 'items-ref', boardId }),
  },
  queries: {
    activeItems: (boardId: string) => ({ type: 'active-items-query', boardId }),
  },
}));

import {
  boardRelationUi,
  clearBoardRelationCacheForTests,
  primeBoardRelationCache,
} from './board-relation';
import type { CellContext, CellProps, EditorProps } from './types';

const Cell = boardRelationUi.Cell as ComponentType<
  CellProps<BoardRelationValue, BoardRelationSettings>
>;
const Editor = boardRelationUi.Editor as ComponentType<
  EditorProps<BoardRelationValue, BoardRelationSettings>
>;

const dummyColumn: ColumnDef = {
  id: 'c-rel',
  type: 'board_relation',
  title: 'Connected Tasks',
  position: 'a0',
  settings: {},
};

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

const defaultSettings: BoardRelationSettings = {
  boardIds: ['board-a'],
  allowMultipleItems: true,
  twoWay: false,
};

function makeDocsSnapshot(items: readonly { id: string; name: string; state?: string }[]) {
  return {
    docs: items.map((item) => ({
      id: item.id,
      data: () => ({ name: item.name, state: item.state ?? 'active' }),
    })),
  };
}

describe('board_relation column UI', () => {
  beforeEach(() => {
    clearBoardRelationCacheForTests();
    getDocsMock.mockReset();
    whereMock.mockClear();
    queryMock.mockClear();
  });

  describe('BoardRelationCell', () => {
    it('renders empty state when value is null or linkedItems is empty', () => {
      const { container } = render(
        <Cell
          value={null}
          settings={defaultSettings}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(container.textContent).toBe('');
      expect(getDocsMock).not.toHaveBeenCalled();
    });

    it('renders linked item chips from cache and collapses extra items into +N', () => {
      primeBoardRelationCache('board-a', {
        'item-1': 'Design Hero',
        'item-2': 'Build Pricing',
        'item-3': 'Launch QA',
      });

      render(
        <Cell
          value={{
            linkedItems: [
              { boardId: 'board-a', itemId: 'item-1' },
              { boardId: 'board-a', itemId: 'item-2' },
              { boardId: 'board-a', itemId: 'item-3' },
            ],
          }}
          settings={defaultSettings}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Design Hero')).toBeInTheDocument();
      expect(screen.getByText('Build Pricing')).toBeInTheDocument();
      expect(screen.queryByText('Launch QA')).not.toBeInTheDocument();
      expect(screen.getByText('+1')).toBeInTheDocument();
      expect(getDocsMock).not.toHaveBeenCalled();
    });

    it('batches reads across multiple cells in the same tick and caches for the session', async () => {
      getDocsMock.mockResolvedValueOnce(
        makeDocsSnapshot([
          { id: 'item-1', name: 'Alpha' },
          { id: 'item-2', name: 'Beta' },
          { id: 'item-3', name: 'Gamma' },
        ]),
      );

      const { rerender } = render(
        <>
          <Cell
            value={{
              linkedItems: [
                { boardId: 'board-a', itemId: 'item-1' },
                { boardId: 'board-a', itemId: 'item-2' },
              ],
            }}
            settings={defaultSettings}
            column={dummyColumn}
            ctx={dummyContext}
            onChange={vi.fn()}
          />
          <Cell
            value={{
              linkedItems: [
                { boardId: 'board-a', itemId: 'item-2' },
                { boardId: 'board-a', itemId: 'item-3' },
              ],
            }}
            settings={defaultSettings}
            column={dummyColumn}
            ctx={dummyContext}
            onChange={vi.fn()}
          />
        </>,
      );

      expect(await screen.findByText('Alpha')).toBeInTheDocument();
      expect(screen.getAllByText('Beta')).toHaveLength(2);
      expect(screen.getByText('Gamma')).toBeInTheDocument();

      // Both cells coalesced into a single getDocs call for board-a with deduplicated IDs
      expect(getDocsMock).toHaveBeenCalledTimes(1);
      expect(whereMock).toHaveBeenCalledWith('__name__', 'in', ['item-1', 'item-2', 'item-3']);

      // Re-rendering with already-cached IDs does not trigger another getDocs call
      rerender(
        <Cell
          value={{
            linkedItems: [
              { boardId: 'board-a', itemId: 'item-1' },
              { boardId: 'board-a', itemId: 'item-3' },
            ],
          }}
          settings={defaultSettings}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Gamma')).toBeInTheDocument();
      expect(getDocsMock).toHaveBeenCalledTimes(1);
    });

    it('chunks getDocs queries to at most 30 item IDs per call', async () => {
      const ids = Array.from({ length: 35 }, (_, idx) => `item-${idx + 1}`);
      getDocsMock.mockImplementation(async (q: { constraints: { value: string[] }[] }) => {
        const chunkIds = q.constraints[0]?.value ?? [];
        return makeDocsSnapshot(chunkIds.map((id) => ({ id, name: `Name of ${id}` })));
      });

      render(
        <Cell
          value={{
            linkedItems: ids.map((itemId) => ({ boardId: 'board-big', itemId })),
          }}
          settings={{ ...defaultSettings, boardIds: ['board-big'] }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      expect(await screen.findByText('Name of item-1')).toBeInTheDocument();
      expect(screen.getByText('Name of item-2')).toBeInTheDocument();
      expect(screen.getByText('+33')).toBeInTheDocument();

      expect(getDocsMock).toHaveBeenCalledTimes(2);
      expect(whereMock).toHaveBeenNthCalledWith(1, '__name__', 'in', ids.slice(0, 30));
      expect(whereMock).toHaveBeenNthCalledWith(2, '__name__', 'in', ids.slice(30, 35));
    });

    it('shows "Unavailable item" when an item is missing, deleted, or the board is unreadable', async () => {
      getDocsMock.mockImplementation(async (q: { ref: { boardId: string } }) => {
        if (q.ref.boardId === 'board-denied') {
          throw new Error('Missing or insufficient permissions');
        }
        return makeDocsSnapshot([{ id: 'item-trashed', name: 'Trashed Task', state: 'deleted' }]);
      });

      render(
        <Cell
          value={{
            linkedItems: [
              { boardId: 'board-a', itemId: 'item-missing' },
              { boardId: 'board-denied', itemId: 'item-secret' },
            ],
          }}
          settings={defaultSettings}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getAllByText('Unavailable item')).toHaveLength(2);
      });
    });
  });

  describe('BoardRelationEditor', () => {
    it('shows guidance when settings.boardIds is empty', () => {
      render(
        <Editor
          value={null}
          settings={{ boardIds: [], allowMultipleItems: true, twoWay: false }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
          onClose={vi.fn()}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      expect(screen.getByText('Select a board in column settings first')).toBeInTheDocument();
    });

    it('loads items from settings.boardIds, filters by search, and toggles multiple items', async () => {
      getDocsMock.mockImplementation(async (q: { boardId: string }) => {
        if (q.boardId === 'board-a') {
          return makeDocsSnapshot([
            { id: 'a1', name: 'Homepage wireframe' },
            { id: 'a2', name: 'Pricing table' },
          ]);
        }
        if (q.boardId === 'board-b') {
          return makeDocsSnapshot([{ id: 'b1', name: 'API gateway' }]);
        }
        return makeDocsSnapshot([]);
      });

      const onChange = vi.fn();
      const onClose = vi.fn();

      render(
        <Editor
          value={{ linkedItems: [{ boardId: 'board-a', itemId: 'a1' }] }}
          settings={{ boardIds: ['board-a', 'board-b'], allowMultipleItems: true, twoWay: false }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      expect(await screen.findByRole('option', { name: 'Homepage wireframe' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Pricing table' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'API gateway' })).toBeInTheDocument();

      // Search filters candidate options
      const searchInput = screen.getByLabelText('Search items');
      await userEvent.type(searchInput, 'gateway');

      expect(screen.queryByRole('option', { name: 'Pricing table' })).not.toBeInTheDocument();
      const gatewayOption = screen.getByRole('option', { name: 'API gateway' });
      fireEvent.click(gatewayOption);

      expect(onChange).toHaveBeenCalledWith({
        linkedItems: [
          { boardId: 'board-a', itemId: 'a1' },
          { boardId: 'board-b', itemId: 'b1' },
        ],
      });
      expect(onClose).not.toHaveBeenCalled();

      // Removing the currently selected item via its pill button clears the cell to null
      fireEvent.click(screen.getByRole('button', { name: 'Remove Homepage wireframe' }));
      expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it('replaces selection and closes popover when allowMultipleItems is false', async () => {
      getDocsMock.mockResolvedValue(
        makeDocsSnapshot([
          { id: 'a1', name: 'First item' },
          { id: 'a2', name: 'Second item' },
        ]),
      );

      const onChange = vi.fn();
      const onClose = vi.fn();

      render(
        <Editor
          value={{ linkedItems: [{ boardId: 'board-a', itemId: 'a1' }] }}
          settings={{ boardIds: ['board-a'], allowMultipleItems: false, twoWay: false }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      const secondOption = await screen.findByRole('option', { name: 'Second item' });
      fireEvent.click(secondOption);

      expect(onChange).toHaveBeenCalledWith({
        linkedItems: [{ boardId: 'board-a', itemId: 'a2' }],
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
