import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STATUS_LABELS } from '@atrium/shared';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import type { BoardDoc, ItemDoc } from '../../data';
import { makeBoard, ts } from '../../test/fixtures';
import { BoardToolbar } from '../board-table/BoardToolbar';
import { GroupBlock } from '../board-table/GroupBlock';
import { TableEnvContext, type TableEnv } from '../board-table/table-env';
import { buildColumnViews, buildGroupModels, type GroupModel } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { AdvancedFilterPopover } from './AdvancedFilterPopover';
import { useFilterStore } from './filter-store';
import { GroupByMenuPopover } from './GroupByMenuPopover';
import { PersonFilterPopover } from './PersonFilterPopover';
import { SortMenuPopover } from './SortMenuPopover';

const mockAuthValue: AuthContextValue = {
  status: 'ready',
  user: {
    uid: 'u1',
    displayName: 'Avery Test',
    email: 'avery@example.com',
    photoURL: null,
  } as unknown as AuthContextValue['user'],
  lastWorkspaceId: 'w1',
  error: null,
  redirectError: null,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  retryBootstrap: vi.fn(),
  rememberWorkspace: vi.fn(),
};

const mockEnv: TableEnv = {
  boardId: 'b1',
  uid: 'u1',
  canEdit: true,
  columns: [],
  subitemColumns: [],
  groups: [],
  nameWidth: 300,
  ctx: { boardId: 'b1', uid: 'u1', columns: [] },
  getModels: () => [],
  getItems: () => [],
  scrollElement: null,
  onResize: () => {},
};

function renderWithAuth(ui: React.ReactElement) {
  return render(
    <AuthContext.Provider value={mockAuthValue}>
      <TableEnvContext.Provider value={mockEnv}>{ui}</TableEnvContext.Provider>
    </AuthContext.Provider>,
  );
}

const testBoard: BoardDoc = makeBoard({
  id: 'b1',
  name: 'Project Alpha',
  accessUids: ['u1', 'u2'],
  columns: [
    {
      id: 'col_status',
      type: 'status',
      title: 'Status',
      position: 'a0',
      settings: { labels: [...DEFAULT_STATUS_LABELS] },
    },
    {
      id: 'col_people',
      type: 'people',
      title: 'Owner',
      position: 'a1',
      settings: { singlePerson: false },
    },
    {
      id: 'col_num',
      type: 'numbers',
      title: 'Estimate',
      position: 'a2',
      settings: { unit: null, decimals: null },
    },
  ],
});

const testItems: ItemDoc[] = [
  {
    id: 'item1',
    name: 'Feature A',
    groupId: 'g1',
    position: 'a0',
    parentItemId: null,
    values: {
      col_status: { index: 0 },
      col_people: { personsAndTeams: [{ id: 'u1', kind: 'person' }] },
      col_num: 10,
    },
    state: 'active',
    deletedAt: null,
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    updatedBy: 'u1',
  },
  {
    id: 'item2',
    name: 'Bug B',
    groupId: 'g1',
    position: 'a1',
    parentItemId: null,
    values: {
      col_status: { index: 1 },
      col_people: { personsAndTeams: [{ id: 'u2', kind: 'person' }] },
      col_num: 20,
    },
    state: 'active',
    deletedAt: null,
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    updatedBy: 'u1',
  },
];

describe('Board Filters, Sort, Search & Group-by', () => {
  beforeEach(() => {
    useFilterStore.getState().resetFilters('b1');
  });

  describe('BoardToolbar', () => {
    it('renders the search button and all tool buttons', () => {
      renderWithAuth(
        <BoardToolbar
          board={testBoard}
          items={testItems}
          onNewItem={() => {}}
          onNewGroup={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Filter by person' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sort' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Group by' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide columns' })).toBeEnabled();
    });

    it('opens search input and updates search query', async () => {
      const user = userEvent.setup();
      useTableStore.getState().setSearchOpen(false);
      useTableStore.getState().setSearch('');

      renderWithAuth(
        <BoardToolbar
          board={testBoard}
          items={testItems}
          onNewItem={() => {}}
          onNewGroup={() => {}}
        />,
      );

      const searchBtn = screen.getByRole('button', { name: 'Search' });
      await user.click(searchBtn);

      const searchInput = screen.getByRole('textbox', { name: 'Search this board' });
      await user.type(searchInput, 'feature');

      expect(useTableStore.getState().search).toBe('feature');

      const clearBtn = screen.getByRole('button', { name: 'Clear search' });
      await user.click(clearBtn);

      expect(useTableStore.getState().searchOpen).toBe(false);
    });
  });

  describe('PersonFilterPopover', () => {
    it('opens popover and toggles person filters', async () => {
      const user = userEvent.setup();
      renderWithAuth(<PersonFilterPopover board={testBoard} items={testItems} />);

      const personButton = screen.getByRole('button', { name: 'Filter by person' });
      await user.click(personButton);

      expect(screen.getByRole('dialog', { name: 'Filter by person' })).toBeInTheDocument();

      // Click u1 (Avery Test) to filter
      const optionU1 = screen.getByRole('option', { name: /Avery Test/i });
      await user.click(optionU1);

      expect(useFilterStore.getState().getFilterState('b1').personIds).toEqual(['u1']);

      // Click u2 (Board member) as well
      const optionU2 = screen.getByRole('option', { name: /Board member/i });
      await user.click(optionU2);

      expect(useFilterStore.getState().getFilterState('b1').personIds).toEqual(['u1', 'u2']);

      // Click Clear
      const clearBtn = screen.getByRole('button', { name: 'Clear' });
      await user.click(clearBtn);

      expect(useFilterStore.getState().getFilterState('b1').personIds).toEqual([]);
    });

    it('displays custom member names with userLookup instead of "Board member"', async () => {
      const user = userEvent.setup();
      const userLookup = (uid: string) => (uid === 'u2' ? 'Jane Doe' : undefined);

      renderWithAuth(
        <PersonFilterPopover board={testBoard} items={testItems} userLookup={userLookup} />,
      );

      const personButton = screen.getByRole('button', { name: 'Filter by person' });
      await user.click(personButton);

      expect(screen.getByRole('option', { name: /Jane Doe/i })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Board member/i })).not.toBeInTheDocument();
    });
  });

  describe('AdvancedFilterPopover', () => {
    it('adds and modifies advanced filter rules', async () => {
      const user = userEvent.setup();
      renderWithAuth(<AdvancedFilterPopover board={testBoard} />);

      const filterBtn = screen.getByRole('button', { name: 'Filter' });
      await user.click(filterBtn);

      expect(screen.getByRole('dialog', { name: 'Filter board items' })).toBeInTheDocument();

      // Add a rule
      const addBtn = screen.getByRole('button', { name: 'Add rule' });
      await user.click(addBtn);

      expect(useFilterStore.getState().getFilterState('b1').filterGroup.conditions.length).toBe(1);

      // Select Item name
      const colSelect = screen.getByRole('combobox', { name: 'Filter column' });
      await user.click(colSelect);
      fireEvent.click(screen.getByRole('option', { name: 'Item name' }));

      // Operator contains
      const opSelect = screen.getByRole('combobox', { name: 'Filter operator' });
      await user.click(opSelect);
      fireEvent.click(screen.getByRole('option', { name: 'contains' }));

      // Value
      const valInput = screen.getByLabelText('Filter value');
      await user.type(valInput, 'Alpha');

      const cond = useFilterStore.getState().getFilterState('b1').filterGroup.conditions[0];
      expect(cond?.columnId).toBe('name');
      expect(cond?.operator).toBe('contains');
      expect(cond?.value).toBe('Alpha');

      // Add a second rule to test conjunction toggle
      await user.click(screen.getByRole('button', { name: 'Add rule' }));
      expect(screen.getByText('Match')).toBeInTheDocument();

      const conjBtn = screen.getByRole('button', { name: 'ALL rules' });
      await user.click(conjBtn);
      expect(useFilterStore.getState().getFilterState('b1').filterGroup.conjunction).toBe('or');

      // Clear all
      const clearBtn = screen.getByRole('button', { name: 'Clear all' });
      await user.click(clearBtn);

      expect(useFilterStore.getState().getFilterState('b1').filterGroup.conditions.length).toBe(0);
    });
  });

  describe('SortMenuPopover', () => {
    it('adds, toggles direction, and removes sort conditions', async () => {
      const user = userEvent.setup();
      renderWithAuth(<SortMenuPopover board={testBoard} />);

      const sortBtn = screen.getByRole('button', { name: 'Sort' });
      await user.click(sortBtn);

      expect(screen.getByRole('dialog', { name: 'Sort board items' })).toBeInTheDocument();

      // Add sort
      await user.click(screen.getByRole('button', { name: 'Add sort' }));
      const state = useFilterStore.getState().getFilterState('b1');
      expect(state.sortConditions.length).toBe(1);
      expect(state.sortConditions[0]?.direction).toBe('asc');

      // Toggle direction to Desc
      const ascBtn = screen.getByRole('button', { name: 'Ascending' });
      await user.click(ascBtn);

      expect(useFilterStore.getState().getFilterState('b1').sortConditions[0]?.direction).toBe(
        'desc',
      );

      // Remove sort
      const removeBtn = screen.getByRole('button', { name: 'Remove sort' });
      await user.click(removeBtn);

      expect(useFilterStore.getState().getFilterState('b1').sortConditions.length).toBe(0);
    });
  });

  describe('GroupByMenuPopover', () => {
    it('selects column for grouping and resets to default groups', async () => {
      const user = userEvent.setup();
      renderWithAuth(<GroupByMenuPopover board={testBoard} />);

      const groupByBtn = screen.getByRole('button', { name: 'Group by' });
      await user.click(groupByBtn);

      expect(screen.getByRole('dialog', { name: 'Group board items' })).toBeInTheDocument();

      // Select Status
      const statusOption = screen.getByRole('option', { name: 'Status' });
      await user.click(statusOption);

      expect(useFilterStore.getState().getFilterState('b1').groupByColumnId).toBe('col_status');

      // Re-open and select Default groups
      await user.click(screen.getByRole('button', { name: /Group by: Status/i }));
      const defaultOption = screen.getByRole('option', { name: 'Default groups' });
      await user.click(defaultOption);

      expect(useFilterStore.getState().getFilterState('b1').groupByColumnId).toBeNull();
    });
  });

  describe('GroupBlock with synthetic groups', () => {
    it('hides group menu and AddItemRow for synthetic groups', () => {
      const syntheticModel: GroupModel = {
        group: { id: 'status_done', title: 'Done', color: '#00c875', position: 'a0' },
        items: [testItems[0]!],
        all: [testItems[0]!],
        synthetic: true,
        subitemsByParent: new Map(),
        autoExpanded: new Set(),
      };

      const { container } = renderWithAuth(
        <GroupBlock model={syntheticModel} term="" dragDisabled={true} />,
      );

      // No group menu button
      expect(
        screen.queryByRole('button', { name: `Options for group ${syntheticModel.group.title}` }),
      ).not.toBeInTheDocument();

      // No "+ Add item" input row
      expect(container.querySelector('input[placeholder="Item name"]')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /new item in done/i })).not.toBeInTheDocument();
    });
  });

  describe('buildGroupModels with dynamic grouping and userLookup', () => {
    it('uses userLookup to name synthetic groups when grouping by people column', () => {
      const columns = buildColumnViews(testBoard.columns);
      const itemsWithNamedPeople: ItemDoc[] = [
        {
          ...testItems[0]!,
          id: 'item1',
          values: {
            col_people: { personsAndTeams: [{ id: 'u_jane_doe_12345', kind: 'person' }] },
          },
        },
      ];

      // Without userLookup: falls back to 'Board member'
      const defaultModels = buildGroupModels({
        groups: testBoard.groups,
        items: itemsWithNamedPeople,
        columns,
        search: '',
        filterState: {
          ...useFilterStore.getState().getFilterState('b1'),
          groupByColumnId: 'col_people',
        },
      });
      expect(defaultModels[0]?.group.title).toBe('Board member');

      // With userLookup: uses custom name
      const userLookup = (uid: string) => (uid === 'u_jane_doe_12345' ? 'Jane Doe' : undefined);
      const customModels = buildGroupModels({
        groups: testBoard.groups,
        items: itemsWithNamedPeople,
        columns,
        search: '',
        filterState: {
          ...useFilterStore.getState().getFilterState('b1'),
          groupByColumnId: 'col_people',
        },
        userLookup,
      });
      expect(customModels[0]?.group.title).toBe('Jane Doe');
      expect(customModels[0]?.synthetic).toBe(true);
    });
  });
});
