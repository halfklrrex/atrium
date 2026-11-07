import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { BoardTable } from './BoardTable';
import { useTablePrefs, useTableStore } from './table-store';
import { VIRTUALIZE_AFTER } from './table-model';

const mocks = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
}));

const COUNT = VIRTUALIZE_AFTER + 10;
const board = makeBoard({
  id: 'b1',
  access: { u1: 'owner' },
  columns: [],
  groups: [{ id: 'g1', title: 'Big', color: '#579bfc', position: 'a0' }],
});

beforeEach(() => {
  mocks.items = Array.from({ length: COUNT }, (_, i): ItemDoc =>
    makeItem({
      id: `i${i}`,
      name: `Row ${String(i).padStart(3, '0')}`,
      groupId: 'g1',
      position: `a${String(i).padStart(3, '0')}`,
    }),
  );
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
});

// Big groups are virtualised on screen, which would cut a printout to the rows near the viewport.
describe('printing a big group', () => {
  it('renders every row between beforeprint and afterprint', () => {
    render(<BoardTable board={board} />);
    const group = within(screen.getByRole('region', { name: 'Big' }));
    // jsdom has no layout, so the virtual window is empty or partial, never all rows.
    expect(group.queryAllByText(/^Row \d{3}$/).length).toBeLessThan(COUNT);

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(group.getAllByText(/^Row \d{3}$/)).toHaveLength(COUNT);

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(group.queryAllByText(/^Row \d{3}$/).length).toBeLessThan(COUNT);
  });
});
