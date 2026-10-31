import {
  columnRegistry,
  defaultChartSettings,
  defaultViewSettings,
  type ChartSettings,
  type ColumnDef,
} from '@atrium/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentViewState,
  isViewDirty,
  settingsFromState,
  useFilterStore,
  useViewTypeSettings,
  viewKey,
} from '../board-filters';
import { buildColumnViews } from '../board-table/table-model';
import { buildChartModel } from './chart-model';
import { ChartSettingsPanel } from './ChartSettingsPanel';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const withNumbers = buildColumnViews([
  column('status', 'status', 'Status', 'a0'),
  column('owner', 'people', 'Owner', 'a1'),
  column('due', 'date', 'Due', 'a2'),
  column('budget', 'numbers', 'Budget', 'a3'),
  column('notes', 'text', 'Notes', 'a4'),
]);
const withoutNumbers = buildColumnViews([column('status', 'status', 'Status', 'a0')]);

function open(
  chart: Partial<ChartSettings> = {},
  columns: ReturnType<typeof buildColumnViews> = withNumbers,
) {
  useFilterStore.getState().syncView('b1', 'cv', {
    ...defaultViewSettings(),
    chart: { ...defaultChartSettings(), ...chart },
  });
  function Live() {
    const settings = useViewTypeSettings('b1', 'chart');
    const model = buildChartModel({
      items: [],
      columns,
      groups: [],
      settings,
      search: '',
      userName: () => undefined,
    });
    return (
      <ChartSettingsPanel
        boardId="b1"
        columns={columns}
        settings={settings}
        model={model}
        onClose={vi.fn()}
      />
    );
  }
  return render(<Live />);
}

const dirty = () => isViewDirty(useFilterStore.getState().views[viewKey('b1', 'cv')]);

beforeEach(() => {
  useFilterStore.setState({ activeView: {}, views: {} });
});

describe('ChartSettingsPanel', () => {
  it('lists the chart types and marks the current one', () => {
    open({ chartType: 'line' });
    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Bar' })).toHaveAttribute('aria-pressed', 'false');
    expect(dirty()).toBe(false);
  });

  it('marks the view dirty on a change and saves it with the rest of the settings', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Pie' }));
    expect(dirty()).toBe(true);
    const saved = settingsFromState(currentViewState('b1'));
    expect(saved.chart?.chartType).toBe('pie');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show values' }));
    expect(currentViewState('b1').chart?.showValues).toBe(false);
  });

  it('offers only the columns that fit each axis', () => {
    open({ chartType: 'stacked_bar' });
    const x = screen.getByLabelText('Group items by') as HTMLSelectElement;
    expect([...x.options].map((o) => o.textContent)).toEqual(['Group', 'Status', 'Owner', 'Due']);
    const stack = screen.getByLabelText('Split each bar by') as HTMLSelectElement;
    expect([...stack.options].map((o) => o.textContent)).toEqual(['Group', 'Owner']);
    fireEvent.change(x, { target: { value: 'owner' } });
    expect(currentViewState('b1').chart?.xColumnId).toBe('owner');
  });

  it('shows the date bucket only for a date axis', () => {
    open();
    expect(screen.queryByLabelText('By')).toBeNull();
    fireEvent.change(screen.getByLabelText('Group items by'), { target: { value: 'due' } });
    fireEvent.change(screen.getByLabelText('By'), { target: { value: 'week' } });
    expect(currentViewState('b1').chart?.dateBucket).toBe('week');
  });

  it('picks the measure and its Numbers column', () => {
    open();
    expect(screen.queryByLabelText('Numbers column')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sum' }));
    expect(currentViewState('b1').chart?.yMode).toBe('sum');
    expect((screen.getByLabelText('Numbers column') as HTMLSelectElement).value).toBe('budget');
  });

  it('disables the numeric measures, with a hint, when the board has no Numbers column', () => {
    open({}, withoutNumbers);
    const sum = screen.getByRole('button', { name: 'Sum' });
    expect(sum).toBeDisabled();
    expect(sum).toHaveAttribute('title', 'Add a Numbers column');
    expect(screen.getByRole('button', { name: 'Count' })).toBeEnabled();
  });

  it('shows the fallback when a saved measure cannot be used', () => {
    open({ yMode: 'sum', yColumnId: 'gone' });
    expect(screen.getByText(/counts items/)).toBeInTheDocument();
  });

  it('sorts', () => {
    open();
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'value_desc' } });
    expect(currentViewState('b1').chart?.sortBy).toBe('value_desc');
  });
});
