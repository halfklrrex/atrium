import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeItem } from '../../test/fixtures';
import type { TableCtx } from '../board-table/table-actions';
import { buildColumnViews } from '../board-table/table-model';
import { FieldsPanel } from './FieldsPanel';
import { ItemCell } from './ItemCell';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const def = (id: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id,
  type,
  title: id,
  position: 'a0',
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
  ...extra,
});

const ctxFor = (columns: ColumnDef[]): TableCtx => ({ boardId: 'b1', uid: 'u1', columns });
const view = (d: ColumnDef) => buildColumnViews([d])[0]!;

describe('ItemCell emptyHint', () => {
  const column = def('due', 'date');
  const item = makeItem({ id: 'i1' });

  it('shows the hint only for an editable empty cell', () => {
    const { rerender } = render(
      <ItemCell
        item={item}
        column={view(column)}
        ctx={ctxFor([column])}
        canEdit
        emptyHint="Set date"
      />,
    );
    expect(screen.getByText('Set date')).toBeInTheDocument();
    rerender(
      <ItemCell
        item={item}
        column={view(column)}
        ctx={ctxFor([column])}
        canEdit={false}
        emptyHint="Set date"
      />,
    );
    expect(screen.queryByText('Set date')).not.toBeInTheDocument();
  });

  it('shows no hint once the cell has a value', () => {
    const filled = makeItem({ id: 'i1', values: { due: { date: '2026-11-14' } } });
    render(
      <ItemCell
        item={filled}
        column={view(column)}
        ctx={ctxFor([column])}
        canEdit
        emptyHint="Set date"
      />,
    );
    expect(screen.queryByText('Set date')).not.toBeInTheDocument();
  });

  it('replaces "Required" with the hint and marks the cell required-empty', () => {
    const required = def('due', 'date', { required: true });
    const { container } = render(
      <ItemCell
        item={item}
        column={view(required)}
        ctx={ctxFor([required])}
        canEdit
        emptyHint="Set date"
      />,
    );
    expect(screen.getByText('Set date')).toBeInTheDocument();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
    expect(container.querySelector('[data-required-empty="true"]')).not.toBeNull();
  });

  it('keeps the "Required" hint without an emptyHint', () => {
    const required = def('due', 'date', { required: true });
    render(<ItemCell item={item} column={view(required)} ctx={ctxFor([required])} canEdit />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});

describe('FieldsPanel layout', () => {
  const columns = [def('note', 'long_text'), def('size', 'numbers')];
  const item = makeItem({ id: 'i1' });
  const views = buildColumnViews(columns.map((c, i) => ({ ...c, position: `a${i}` })));

  it('marks wide fields in the grid layout', () => {
    render(<FieldsPanel item={item} columns={views} ctx={ctxFor(columns)} canEdit layout="grid" />);
    const groups = screen.getAllByRole('group');
    expect(groups[0]).toHaveAttribute('data-wide', 'true');
    expect(groups[1]).not.toHaveAttribute('data-wide');
  });

  it('does not mark anything in the default layout', () => {
    render(<FieldsPanel item={item} columns={views} ctx={ctxFor(columns)} canEdit />);
    for (const g of screen.getAllByRole('group')) expect(g).not.toHaveAttribute('data-wide');
  });
});
