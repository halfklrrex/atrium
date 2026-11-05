import { defaultWidgetSettings, type DashboardWidget } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, makeDashboard } from '../../test/fixtures';
import { AddWidgetDialog } from './AddWidgetDialog';
import { column, statusColumn } from './widgets/widget-test-data';

const mocks = vi.hoisted(() => ({ addWidget: vi.fn(), updateWidget: vi.fn() }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  dashboardWrites: { addWidget: mocks.addWidget, updateWidget: mocks.updateWidget },
}));

const boards = [
  makeBoard({
    id: 'b1',
    columns: [column('amount', 'numbers', 'Amount'), statusColumn('status')],
  }),
];
const dashboard = makeDashboard({ id: 'd1', boardIds: ['b1'] });

function open(widget?: DashboardWidget) {
  const onClose = vi.fn();
  render(
    <AddWidgetDialog dashboard={dashboard} boards={boards} widget={widget} onClose={onClose} />,
  );
  return onClose;
}

beforeEach(() => {
  mocks.addWidget.mockReset().mockResolvedValue('w1');
  mocks.updateWidget.mockReset().mockResolvedValue(undefined);
});

describe('AddWidgetDialog', () => {
  it('lists Numbers, Battery, Chart and Table and marks Workload as coming soon', () => {
    open();
    for (const name of [/Numbers/, /Battery/, /Chart/, /Table/]) {
      expect(screen.getByRole('radio', { name })).toBeEnabled();
    }
    expect(screen.getByRole('radio', { name: /Workload/ })).toBeDisabled();
    expect(screen.getAllByText('Coming soon')).toHaveLength(1);
  });

  it('adds a Chart widget with its type, axes, measure and boards', async () => {
    open();
    await userEvent.click(screen.getByRole('radio', { name: /Chart/ }));
    expect(screen.getByLabelText('Widget title')).toHaveValue('Chart');
    await userEvent.selectOptions(screen.getByLabelText('Chart type'), 'stacked_bar');
    await userEvent.selectOptions(screen.getByLabelText('X axis'), 'status');
    expect(screen.getByLabelText('Stack by')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Measure'), 'sum');
    const measure = screen.getByLabelText('Measure column') as HTMLSelectElement;
    expect(Array.from(measure.options).map((o) => o.text)).toEqual([
      'First number column',
      'Amount',
    ]);
    await userEvent.selectOptions(measure, 'amount');
    await userEvent.click(screen.getByRole('checkbox', { name: 'b1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    await waitFor(() => expect(mocks.addWidget).toHaveBeenCalled());
    expect(mocks.addWidget.mock.calls[0]?.[1]).toMatchObject({
      type: 'chart',
      boardIds: ['b1'],
      settings: {
        chartType: 'stacked_bar',
        xColumnId: 'status',
        yMode: 'sum',
        yColumnId: 'amount',
      },
    });
  });

  it('only offers date bucket for a date X axis', async () => {
    render(
      <AddWidgetDialog
        dashboard={dashboard}
        boards={[makeBoard({ id: 'b9', columns: [column('due', 'date', 'Due')] })]}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /Chart/ }));
    expect(screen.queryByLabelText('Group dates by')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('X axis'), 'due');
    expect(screen.getByLabelText('Group dates by')).toBeInTheDocument();
  });

  it('adds a Table widget with columns, a status filter and a row limit', async () => {
    open();
    await userEvent.click(screen.getByRole('radio', { name: /Table/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Amount' }));
    await userEvent.selectOptions(screen.getByLabelText('Filter by status column'), 'status');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
    await userEvent.selectOptions(screen.getByLabelText('Row limit'), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    await waitFor(() => expect(mocks.addWidget).toHaveBeenCalled());
    expect(mocks.addWidget).toHaveBeenCalledWith('d1', {
      type: 'table',
      title: 'Table',
      boardIds: [],
      settings: {
        columnIds: ['amount'],
        filter: { columnId: 'status', values: ['done'] },
        rowLimit: 25,
      },
    });
  });

  it('edits a Chart widget and saves its boards', async () => {
    const widget = {
      id: 'w5',
      type: 'chart',
      title: 'By status',
      layout: { x: 0, y: 0, w: 6, h: 5 },
      boardIds: ['b1'],
      settings: defaultWidgetSettings('chart'),
    } as DashboardWidget;
    const onClose = open(widget);
    await userEvent.selectOptions(screen.getByLabelText('Chart type'), 'donut');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.updateWidget).toHaveBeenCalledWith('d1', 'w5', {
      title: 'By status',
      boardIds: ['b1'],
      settings: { ...defaultWidgetSettings('chart'), chartType: 'donut' },
    });
  });

  it('adds a Numbers widget that counts items by default', async () => {
    const onClose = open();
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.addWidget).toHaveBeenCalledWith('d1', {
      type: 'numbers',
      title: 'Numbers',
      settings: { mode: 'count', columnId: null, filter: null },
    });
  });

  it('only offers number-like columns and needs one for a sum', async () => {
    open();
    await userEvent.selectOptions(screen.getByLabelText('Calculation'), 'sum');
    const add = screen.getByRole('button', { name: 'Add widget' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    const column = screen.getByLabelText('Column');
    expect(Array.from((column as HTMLSelectElement).options).map((o) => o.text)).toEqual([
      'Choose a column',
      'Amount',
    ]);
    await userEvent.selectOptions(column, 'amount');
    expect(add).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(add);
    await waitFor(() => expect(mocks.addWidget).toHaveBeenCalled());
    expect(mocks.addWidget.mock.calls[0]?.[1]).toMatchObject({
      settings: { mode: 'sum', columnId: 'amount' },
    });
  });

  it('adds a Battery widget with the labels that count as done', async () => {
    open();
    await userEvent.click(screen.getByRole('radio', { name: /Battery/ }));
    expect(screen.getByLabelText('Widget title')).toHaveValue('Battery');
    await userEvent.selectOptions(screen.getByLabelText('Status column'), 'status');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    await waitFor(() => expect(mocks.addWidget).toHaveBeenCalled());
    expect(mocks.addWidget).toHaveBeenCalledWith('d1', {
      type: 'battery',
      title: 'Battery',
      settings: { statusColumnId: 'status', doneLabelIds: ['done'] },
    });
  });

  it('keeps a title the user typed when the type changes', async () => {
    open();
    const title = screen.getByLabelText('Widget title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Revenue');
    await userEvent.click(screen.getByRole('radio', { name: /Battery/ }));
    expect(title).toHaveValue('Revenue');
  });

  it('edits an existing widget without changing its type', async () => {
    const widget = {
      id: 'w9',
      type: 'numbers',
      title: 'Open items',
      layout: { x: 0, y: 0, w: 3, h: 3 },
      boardIds: [],
      settings: defaultWidgetSettings('numbers'),
    } as DashboardWidget;
    const onClose = open(widget);
    expect(screen.queryByRole('radiogroup', { name: 'Widget type' })).toBeNull();
    const title = screen.getByLabelText('Widget title');
    await userEvent.clear(title);
    await userEvent.type(title, 'All items');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.updateWidget).toHaveBeenCalledWith('d1', 'w9', {
      title: 'All items',
      settings: defaultWidgetSettings('numbers'),
    });
  });

  it('shows a failed save and stays open', async () => {
    mocks.addWidget.mockRejectedValue({ code: 'permission-denied' });
    const onClose = open();
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission");
    expect(onClose).not.toHaveBeenCalled();
  });
});
