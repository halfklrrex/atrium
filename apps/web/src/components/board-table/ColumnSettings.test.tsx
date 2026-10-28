import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColumnSettingsPopup } from './ColumnSettings';
import { tableActions, type TableCtx } from './table-actions';
import { TableEnvContext, type TableEnv } from './table-env';
import type { ColumnView } from './table-model';
import { useTableStore } from './table-store';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const mockCtx: TableCtx = {
  boardId: 'board-1',
  uid: 'user-1',
  columns: [],
};

const mockEnv: TableEnv = {
  boardId: 'board-1',
  uid: 'user-1',
  canEdit: true,
  columns: [],
  subitemColumns: [],
  groups: [],
  nameWidth: 300,
  ctx: mockCtx,
  getModels: () => [],
  getItems: () => [],
  scrollElement: null,
  onResize: vi.fn(),
};

function makeColumnView(type: string, settings: Record<string, unknown> = {}): ColumnView {
  return {
    def: {
      id: `col-${type}`,
      type,
      title: `${type} column`,
      position: 'a0',
      settings,
    },
    settings,
    width: 140,
  };
}

function renderSettings(column: ColumnView) {
  return render(
    <TableEnvContext.Provider value={mockEnv}>
      <ColumnSettingsPopup column={column} anchor={document.body} />
    </TableEnvContext.Provider>,
  );
}

describe('ColumnSettingsPopup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tableActions, 'updateColumn').mockResolvedValue(undefined);
    useTableStore.getState().reset(null);
  });

  it('toggles showProgress for timeline column and saves { showProgress: true }', () => {
    const col = makeColumnView('timeline', { showProgress: false });
    renderSettings(col);

    const checkbox = screen.getByRole('checkbox', { name: 'Show progress bar' });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(tableActions.updateColumn).toHaveBeenCalledWith(mockCtx, 'col-timeline', {
      settings: { showProgress: true },
    });
  });

  it('changes firstDayOfWeek to sunday for week column and saves { firstDayOfWeek: "sunday" }', () => {
    const col = makeColumnView('week', { firstDayOfWeek: 'monday' });
    renderSettings(col);

    const select = screen.getByLabelText('First day of week');
    expect(select).toHaveValue('monday');

    fireEvent.change(select, { target: { value: 'sunday' } });
    expect(select).toHaveValue('sunday');

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(tableActions.updateColumn).toHaveBeenCalledWith(mockCtx, 'col-week', {
      settings: { firstDayOfWeek: 'sunday' },
    });
  });

  it('toggles format24Hour for hour column and saves { format24Hour: false }', () => {
    const col = makeColumnView('hour', { format24Hour: true });
    renderSettings(col);

    const checkbox = screen.getByRole('checkbox', { name: '24-hour format' });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(tableActions.updateColumn).toHaveBeenCalledWith(mockCtx, 'col-hour', {
      settings: { format24Hour: false },
    });
  });

  it('toggles format24Hour and showCity for world_clock column and saves { format24Hour: false, showCity: false }', () => {
    const col = makeColumnView('world_clock', { format24Hour: true, showCity: true });
    renderSettings(col);

    const formatCheckbox = screen.getByRole('checkbox', { name: '24-hour format' });
    const cityCheckbox = screen.getByRole('checkbox', { name: 'Show city name' });
    expect(formatCheckbox).toBeChecked();
    expect(cityCheckbox).toBeChecked();

    fireEvent.click(formatCheckbox);
    fireEvent.click(cityCheckbox);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(tableActions.updateColumn).toHaveBeenCalledWith(mockCtx, 'col-world_clock', {
      settings: { format24Hour: false, showCity: false },
    });
  });

  it('renders NumbersSettingsEditor for numbers column', () => {
    const col = makeColumnView('numbers', {
      unit: { symbol: '$', direction: 'left' },
      decimals: 2,
    });
    renderSettings(col);

    expect(screen.getByLabelText('Unit')).toHaveValue('$');
    expect(screen.getByLabelText('Decimals')).toHaveValue('2');
  });

  it('displays "No settings for this column" for types without a settings editor (e.g. text, location)', () => {
    const { unmount } = renderSettings(makeColumnView('text', {}));
    expect(screen.getByText('No settings for this column')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unit')).toBeNull();
    unmount();

    renderSettings(makeColumnView('location', {}));
    expect(screen.getByText('No settings for this column')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unit')).toBeNull();
  });
});
