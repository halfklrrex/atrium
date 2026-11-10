import { columnRegistry, type ColumnDef } from '@atrium/shared';
import type { ComponentProps, ComponentType } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityDoc, ActivityState } from '../../data/activity';
import type { ItemDoc, ItemUpdateDoc } from '../../data/model';
import { makeActivity } from '../../test/activity';
import { makeBoard } from '../../test/fixtures';
import { openItemFull } from '../board-table/open-item';
import { ItemCardDrawer } from './ItemCardDrawer';
import { useItemCardStore } from './item-card-store';
import type { UpdatesFeed as UpdatesFeedComponent } from './UpdatesFeed';

type UpdatesFeedProps = ComponentProps<typeof UpdatesFeedComponent>;

const mockItem: ItemDoc = {
  id: 'i1',
  name: 'Design onboarding flow',
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  values: {},
  state: 'active',
  deletedAt: null,
  createdAt: {
    seconds: 1700000000,
    nanoseconds: 0,
    toDate: () => new Date(),
    toMillis: () => 1700000000000,
  },
  createdBy: 'u1',
  updatedAt: {
    seconds: 1700000000,
    nanoseconds: 0,
    toDate: () => new Date(),
    toMillis: () => 1700000000000,
  },
  updatedBy: 'u1',
};

const mockUpdates: ItemUpdateDoc[] = [
  {
    id: 'up1',
    itemId: 'i1',
    authorId: 'u1',
    authorName: 'Ada Lovelace',
    content: 'Initial specs completed!',
    likes: ['u1'],
    repliesCount: 0,
    createdAt: {
      seconds: 1700000000,
      nanoseconds: 0,
      toDate: () => new Date(),
      toMillis: () => 1700000000000,
    },
    updatedAt: {
      seconds: 1700000000,
      nanoseconds: 0,
      toDate: () => new Date(),
      toMillis: () => 1700000000000,
    },
  },
];

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Ada Lovelace' } }),
}));

let mockActivity: Partial<ActivityState> = {};
let mockActivityBoardId: string | undefined;
const mockActivityEntries = (): ActivityDoc[] => [
  makeActivity('a1', {
    kind: 'value_changed',
    columnId: 'status',
    columnTitle: 'Status',
    columnType: 'status',
    data: {
      fromText: 'Building',
      toText: 'Done',
      fromValue: { index: 0 },
      toValue: { index: 1 },
    },
  }),
  makeActivity('a2', { kind: 'item_created', itemName: 'Design onboarding flow' }),
];

vi.mock('../../data/activity', () => ({
  useItemActivity: (boardId?: string) => {
    mockActivityBoardId = boardId;
    return {
      data: [],
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      retry: vi.fn(),
      ...mockActivity,
    };
  },
}));
const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const KEY_COLUMNS: ColumnDef[] = [
  {
    ...column('status', 'status', 'Status', 'a0'),
    settings: {
      labels: [
        { id: 'building', index: 0, label: 'Building', color: '#fdab3d' },
        { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
      ],
    },
  },
  column('who', 'people', 'Owner', 'a1'),
  column('due', 'date', 'Deadline', 'a2'),
  column('prio', 'status', 'Priority', 'a3'),
];
const textColumns = (n: number): ColumnDef[] =>
  Array.from({ length: n }, (_, i) =>
    column(`t${i}`, 'text', `Field ${i + 1}`, `b${String(i).padStart(2, '0')}`),
  );

let mockColumns: ColumnDef[] = KEY_COLUMNS;
let mockItems: ItemDoc[] = [];
let mockSubitemColumns: ColumnDef[] = [];
let mockRole: 'owner' | 'viewer' = 'owner';
let mockUpdateList: ItemUpdateDoc[] = mockUpdates;
const feedProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('./UpdatesFeed', async (importOriginal) => {
  const original = (await importOriginal()) as { UpdatesFeed: ComponentType<UpdatesFeedProps> };
  return {
    UpdatesFeed: (props: UpdatesFeedProps) => {
      feedProps.last = props as unknown as Record<string, unknown>;
      return <original.UpdatesFeed {...props} />;
    },
  };
});
vi.mock('../../data/hooks', () => ({
  useBoard: () => ({
    data: makeBoard({
      id: 'b1',
      name: 'Product roadmap',
      columns: mockColumns,
      subitemColumns: mockSubitemColumns,
      access: { u1: mockRole },
      groups: [{ id: 'g1', title: 'Core boards', color: '#579bfc', position: 'a0' }],
    }),
    loading: false,
    error: null,
  }),
  useItems: () => ({ data: mockItems, loading: false, error: null }),
  useWorkspace: () => ({
    data: { name: 'Main', roles: { u1: mockRole } },
    loading: false,
    error: null,
  }),
}));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  itemWrites: { setValue: vi.fn(), setDescription: vi.fn(), rename: vi.fn() },
}));
vi.mock('../item-view/DescriptionEditor', () => ({ default: () => <div>description editor</div> }));
vi.mock('../board-table/open-item', () => ({ openItemFull: vi.fn(), openItem: vi.fn() }));
const toastMock = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../toast-store', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  showToast: toastMock.showToast,
}));
vi.mock('../../data/updates', () => ({
  useItem: (_bId?: string, itemId?: string) => ({
    data: itemId === 'i1' ? mockItem : { ...mockItem, id: itemId, name: `Item ${itemId}` },
    loading: false,
    error: null,
  }),
  useItemUpdates: () => ({
    data: mockUpdateList,
    loading: false,
    error: null,
  }),
  useUpdateReplies: () => ({
    data: [],
    loading: false,
    error: null,
  }),
  createUpdate: vi.fn(),
  updateItemName: vi.fn(),
}));

describe('ItemCardDrawer', () => {
  beforeEach(() => {
    mockActivity = {};
    mockActivityBoardId = undefined;
    mockColumns = KEY_COLUMNS;
    mockItems = [];
    mockSubitemColumns = [];
    mockRole = 'owner';
    mockUpdateList = mockUpdates;
    feedProps.last = null;
    vi.mocked(openItemFull).mockClear();
    toastMock.showToast.mockClear();
    useItemCardStore.getState().closeItemCard();
    useItemCardStore.getState().setItemIds([]);
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ItemCardDrawer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders drawer when active board and item are set', () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);

    expect(screen.getByRole('dialog', { name: 'Item card' })).toBeInTheDocument();
    expect(screen.getByText('Design onboarding flow')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Updates/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Activity Log/ })).toBeInTheDocument();
  });

  it('opens on Overview and lists the tabs in order', () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['Overview', 'Updates / 1', 'Activity Log']);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeInTheDocument();
  });

  it('opens on the tab the opener names, and keeps it when stepping to another item', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i2', ['i1', 'i2', 'i3'], 'updates');
    render(<ItemCardDrawer />);
    expect(screen.getByText('Initial specs completed!')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next item' }));
    expect(useItemCardStore.getState().tab).toBe('updates');
    expect(screen.getByText('Initial specs completed!')).toBeInTheDocument();
  });

  it('shows the crumb with the group and board names', () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    expect(screen.getByText('Core boards')).toBeInTheDocument();
    expect(screen.getByText('Product roadmap')).toBeInTheDocument();
  });

  it('shows the key bar with the columns own titles, live cells and hints, on every tab', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    const bar = screen.getByLabelText('Key information');
    expect(bar).toBeInTheDocument();
    for (const title of ['Status', 'Owner', 'Deadline', 'Priority']) {
      expect(within(bar).getByText(title)).toBeInTheDocument();
    }
    expect(within(bar).getAllByText('Set status')).toHaveLength(2);
    expect(within(bar).getByText('Assign')).toBeInTheDocument();
    expect(within(bar).getByText('Set date')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Updates/ }));
    expect(screen.getByLabelText('Key information')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Activity Log/ }));
    expect(screen.getByLabelText('Key information')).toBeInTheDocument();
  });

  it('has no key bar on a board without status, people, date or dropdown columns', () => {
    mockColumns = textColumns(3);
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    expect(screen.queryByLabelText('Key information')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Fields')).getByText('Field 1')).toBeVisible();
  });

  it('keeps key-bar columns out of the fields grid', () => {
    mockColumns = [...KEY_COLUMNS, ...textColumns(2)];
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    const fields = screen.getByLabelText('Fields');
    expect(within(fields).queryByText('Status')).not.toBeInTheDocument();
    expect(within(fields).queryByText('Deadline')).not.toBeInTheDocument();
    expect(within(fields).getByText('Field 1')).toBeInTheDocument();
    expect(within(fields).getByText('Field 2')).toBeInTheDocument();
  });

  it('caps the grid at 10 fields and expands with Show all fields', async () => {
    mockColumns = [...KEY_COLUMNS, ...textColumns(12)];
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    const fields = () => screen.getByLabelText('Fields');
    expect(within(fields()).getAllByRole('group')).toHaveLength(10);
    const more = screen.getByRole('button', { name: 'Show all fields (12)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(within(fields()).getAllByRole('group')).toHaveLength(12);
    const fewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(fewer);
    expect(within(fields()).getAllByRole('group')).toHaveLength(10);
  });

  it('counts required fields that are empty, key-bar ones included', () => {
    mockColumns = [{ ...KEY_COLUMNS[0]!, required: true }, ...textColumns(1)];
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    expect(screen.getByTestId('required-count')).toHaveTextContent('1 required empty');
  });

  it('shows the footer on Overview only', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /^Updates/ }));
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Activity Log/ }));
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });

  it('copies the item link from the footer', async () => {
    const user = userEvent.setup();
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toMatch(/\/items\/i1$/);
    expect(toastMock.showToast).toHaveBeenCalledWith('Link copied.', { type: 'positive' });
  });

  it('opens the full item from the header icon (every tab) and the footer', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    const openers = screen.getAllByRole('button', { name: 'Open full item' });
    expect(openers).toHaveLength(2);
    await userEvent.click(openers[0]!);
    expect(openItemFull).toHaveBeenCalledWith('b1', 'i1');
    await userEvent.click(openers[1]!);
    expect(openItemFull).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('tab', { name: /Activity Log/ }));
    expect(screen.getAllByRole('button', { name: 'Open full item' })).toHaveLength(1);
  });

  it('closes when close button is clicked', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);

    const closeBtn = screen.getByRole('button', { name: 'Close item card' });
    await userEvent.click(closeBtn);

    expect(useItemCardStore.getState().activeItemId).toBeNull();
  });

  it('navigates previous and next when arrow buttons are clicked', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i2', ['i1', 'i2', 'i3']);
    render(<ItemCardDrawer />);

    const prevBtn = screen.getByRole('button', { name: 'Previous item' });
    const nextBtn = screen.getByRole('button', { name: 'Next item' });

    expect(prevBtn).not.toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    await userEvent.click(nextBtn);
    expect(useItemCardStore.getState().activeItemId).toBe('i3');

    await userEvent.click(prevBtn);
    expect(useItemCardStore.getState().activeItemId).toBe('i2');
  });

  it('shows the item history in the Activity Log tab, and only once it is opened', async () => {
    mockActivity = { data: mockActivityEntries() };
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    // Overview opens first and does not listen to the history.
    expect(mockActivityBoardId).toBeUndefined();

    await userEvent.click(screen.getByRole('tab', { name: /Activity Log/i }));

    expect(mockActivityBoardId).toBe('b1');
    const list = screen.getByRole('list', { name: 'Item activity' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Status')).toBeInTheDocument();
    // The column still exists with the same type, so both values are drawn with its status cell.
    expect(within(list).getByText('Building')).toBeInTheDocument();
    expect(within(list).getByText('Done')).toBeInTheDocument();
    expect(within(list).getByText('Created')).toBeInTheDocument();
    // Updates stay in the Updates tab.
    expect(screen.queryByText(/Initial specs completed!/i)).not.toBeInTheDocument();
  });

  it('shows the empty state in the Activity Log tab', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    await userEvent.click(screen.getByRole('tab', { name: /Activity Log/i }));
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('is a non-modal panel: no backdrop, the page behind stays clickable', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    const onOutside = vi.fn();
    render(
      <>
        <button type="button" onClick={onOutside}>
          Other row
        </button>
        <ItemCardDrawer />
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Item card' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    // The dialog is the panel itself, not a full-size wrapper around it.
    expect(dialog.tagName).toBe('ASIDE');
    await userEvent.click(screen.getByRole('button', { name: 'Other row' }));
    expect(onOutside).toHaveBeenCalled();
    // Clicking outside does not close it.
    expect(useItemCardStore.getState().activeItemId).toBe('i1');
  });

  it('switches to another item when one is opened while it is showing', () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    act(() => useItemCardStore.getState().open('b1', 'i2'));
    expect(screen.getByText('Item i2')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);
    await userEvent.keyboard('{Escape}');
    expect(useItemCardStore.getState().activeItemId).toBeNull();
  });

  describe('subitems row, latest update and composer line', () => {
    const subStatus = column('sst', 'status', 'Status', 'a0');
    const sub = (id: string, index?: number): ItemDoc => ({
      ...mockItem,
      id,
      name: id,
      parentItemId: 'i1',
      values: index === undefined ? {} : { sst: { index } },
    });
    const withSubs = () => {
      mockSubitemColumns = [
        {
          ...subStatus,
          settings: {
            labels: [
              { id: 'todo', index: 0, label: 'Todo', color: '#fdab3d' },
              { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
            ],
          },
        },
      ];
      mockItems = [sub('s1', 1), sub('s2', 0), sub('s3', 1), sub('s4')];
    };

    it('shows "x of y done" and opens the full item at its subitems', async () => {
      withSubs();
      useItemCardStore.getState().openItemCard('b1', 'i1');
      render(<ItemCardDrawer />);
      const row = screen.getByRole('button', {
        name: 'Subitems, 2 of 4 done. Open in the full item',
      });
      expect(row).toHaveTextContent('2 of 4 done');
      await userEvent.click(row);
      expect(openItemFull).toHaveBeenCalledWith('b1', 'i1', { section: 'subitems' });
    });

    it('counts subitems without a status column and ignores other parents', () => {
      mockItems = [sub('s1'), sub('s2'), { ...sub('x'), parentItemId: 'other' }];
      useItemCardStore.getState().openItemCard('b1', 'i1');
      render(<ItemCardDrawer />);
      expect(screen.getByRole('button', { name: /^Subitems, 2 subitems/ })).toBeInTheDocument();
    });

    it('shows "None yet" to editors and hides the row from viewers', () => {
      useItemCardStore.getState().openItemCard('b1', 'i1');
      const { unmount } = render(<ItemCardDrawer />);
      expect(screen.getByRole('button', { name: /^Subitems, None yet/ })).toBeInTheDocument();
      unmount();
      mockRole = 'viewer';
      render(<ItemCardDrawer />);
      expect(screen.queryByRole('button', { name: /^Subitems/ })).not.toBeInTheDocument();
    });

    it('shows the newest update as a teaser and opens it in Updates, focused', async () => {
      mockUpdateList = [{ ...mockUpdates[0]!, repliesCount: 2 }];
      useItemCardStore.getState().openItemCard('b1', 'i1');
      render(<ItemCardDrawer />);
      expect(screen.getByRole('heading', { name: 'Latest update' })).toBeInTheDocument();
      const teaser = screen.getByRole('button', { name: /^Latest update from/ });
      expect(teaser).toHaveTextContent('Initial specs completed!');
      expect(teaser).toHaveTextContent('2 replies');
      await userEvent.click(teaser);
      expect(useItemCardStore.getState().tab).toBe('updates');
      expect(feedProps.last?.focusUpdateId).toBe('up1');
      expect(feedProps.last?.autoFocusComposer).toBe(false);
    });

    it('"All N updates" switches to Updates without focusing anything', async () => {
      useItemCardStore.getState().openItemCard('b1', 'i1');
      render(<ItemCardDrawer />);
      await userEvent.click(screen.getByRole('button', { name: 'All 1 update' }));
      expect(useItemCardStore.getState().tab).toBe('updates');
      expect(feedProps.last?.focusUpdateId).toBeUndefined();
    });

    it('"Write an update..." opens Updates with the composer focused, once', async () => {
      useItemCardStore.getState().openItemCard('b1', 'i1');
      render(<ItemCardDrawer />);
      await userEvent.click(screen.getByRole('button', { name: 'Write an update' }));
      expect(useItemCardStore.getState().tab).toBe('updates');
      expect(feedProps.last?.autoFocusComposer).toBe(true);
      await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
      await userEvent.click(screen.getByRole('tab', { name: /^Updates/ }));
      expect(feedProps.last?.autoFocusComposer).toBe(false);
    });

    it('with no updates the label is "Updates" and only the composer line shows', () => {
      mockUpdateList = [];
      useItemCardStore.getState().openItemCard('b1', 'i1');
      render(<ItemCardDrawer />);
      expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Latest update from/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^All \d+ update/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Write an update' })).toBeInTheDocument();
    });
  });
});
