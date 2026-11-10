import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef, GroupDef } from '@atrium/shared';
import { makeItem } from '../../test/fixtures';
import { chooseMenuItem } from '../../test/menu';
import { useToastStore } from '../toast-store';
import { BatchBar } from './BatchBar';
import { TableEnvContext, type TableEnv } from './table-env';
import { useTableStore } from './table-store';
import { buildColumnViews } from './table-model';

const download = vi.hoisted(() => vi.fn());
const downloadXlsx = vi.hoisted(() => vi.fn());

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../boards/board-export', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadCsv: download,
  downloadXlsx,
}));

const columns: ColumnDef[] = [
  { id: 'note', type: 'text', title: 'Note', position: 'a1', settings: {} },
  { id: 'secret', type: 'text', title: 'Secret', position: 'a2', settings: {} },
];
const groups: GroupDef[] = [{ id: 'g1', title: 'Backlog', color: '#579bfc', position: 'a0' }];
const items = [
  makeItem({ id: 'a', name: 'Alpha', position: 'a1', values: { note: 'one', secret: 'x' } }),
  makeItem({ id: 'b', name: 'Beta', position: 'a2' }),
  makeItem({ id: 'c', name: 'Gamma', position: 'a3' }),
  makeItem({ id: 's1', name: 'Sub of Gamma', parentItemId: 'c' }),
];

function env(over: Partial<TableEnv> = {}): TableEnv {
  const top = items.filter((i) => !i.parentItemId);
  return {
    boardId: 'b1',
    boardName: 'Plans: 2026',
    userLookup: () => undefined,
    uid: 'u1',
    canEdit: true,
    columns: buildColumnViews(columns.filter((c) => c.id !== 'secret')),
    subColumns: [],
    groups,
    nameWidth: 300,
    ctx: { boardId: 'b1', uid: 'u1', columns, subColumns: [] },
    getModels: () => [{ group: groups[0]!, items: top, all: top }] as never,
    getItems: () => items,
    scrollElement: null,
    onResize: vi.fn(),
    ...over,
  };
}

function show(over: Partial<TableEnv> = {}, selected: string[] = ['c', 'a']) {
  useTableStore.getState().reset('b1');
  for (const id of selected) useTableStore.getState().toggleSelected(id);
  return render(
    <TableEnvContext.Provider value={env(over)}>
      <BatchBar />
    </TableEnvContext.Provider>,
  );
}

describe('BatchBar Export', () => {
  beforeEach(() => {
    download.mockClear();
    downloadXlsx.mockClear();
    useToastStore.setState({ toasts: [] });
  });

  it('puts Export after Duplicate and before Delete, with a clear label', () => {
    show();
    const names = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    const dup = names.indexOf('Duplicate');
    const exp = names.indexOf('Export');
    expect(exp).toBeGreaterThan(dup);
    expect(exp).toBeLessThan(names.indexOf('Delete'));
    expect(names.indexOf('Archive')).toBeGreaterThan(exp);
  });

  it('exports only the selected rows (and their subitems) as CSV, without hidden columns', async () => {
    show();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await chooseMenuItem(user, 'CSV');
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [fileName, csv] = download.mock.calls[0] as [string, string];
    expect(fileName).toBe('Plans- 2026.csv');
    expect(csv).toContain('Alpha,Backlog');
    expect(csv).toContain('Gamma,Backlog');
    expect(csv).toContain('Sub of Gamma');
    expect(csv).not.toContain('Beta');
    expect(csv).not.toContain('Secret');
    expect(useToastStore.getState().toasts[0]?.text).toBe('Exported 3 items');
  });

  it('writes an .xlsx file from the Excel entry', { timeout: 20000 }, async () => {
    show({}, ['b']);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await chooseMenuItem(user, 'Excel (.xlsx)');
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(1), { timeout: 10000 });
    expect((downloadXlsx.mock.calls[0] as [string])[0]).toBe('Plans- 2026.xlsx');
    expect(download).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0]?.text).toBe('Exported 1 item');
  });

  it('shows only Export and Clear for a viewer, with no edit actions', () => {
    show({ canEdit: false });
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeTruthy();
    for (const name of ['Duplicate', 'Archive', 'Delete', 'Move to']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});
