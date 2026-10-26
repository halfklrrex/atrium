import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc, ItemUpdateDoc } from '../../data/model';
import { ItemCardDrawer } from './ItemCardDrawer';
import { useItemCardStore } from './item-card-store';

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

vi.mock('../../data/updates', () => ({
  useItem: (_bId?: string, itemId?: string) => ({
    data: itemId === 'i1' ? mockItem : { ...mockItem, id: itemId, name: `Item ${itemId}` },
    loading: false,
    error: null,
  }),
  useItemUpdates: () => ({
    data: mockUpdates,
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
    expect(screen.getByText('Activity Log')).toBeInTheDocument();
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

  it('switches to Activity Log tab when clicked', async () => {
    useItemCardStore.getState().openItemCard('b1', 'i1');
    render(<ItemCardDrawer />);

    const activityTab = screen.getByRole('tab', { name: /Activity Log/i });
    await userEvent.click(activityTab);

    expect(screen.getByText(/Item created/i)).toBeInTheDocument();
    expect(screen.getByText(/Initial specs completed!/i)).toBeInTheDocument();
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
});
