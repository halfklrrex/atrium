import { defaultChartSettings } from '@atrium/shared';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ChartWidget } from './ChartWidget';
import { TableWidget } from './TableWidget';
import { makeBoard, makeItem } from '../../../test/fixtures';
import { statusColumn, twoBoards } from './widget-test-data';

vi.mock('../../../lib/firebase', () => ({ db: {} }));

const base = { boards: twoBoards(), loading: false, widgetBoardIds: [] as string[] };

describe('ChartWidget', () => {
  it('draws the merged chart with an accessible summary', () => {
    render(
      <ChartWidget
        {...base}
        settings={{ ...defaultChartSettings(), xColumnId: 'status' }}
        userName={() => undefined}
      />,
    );
    expect(screen.getByRole('img', { name: /Bar chart/ })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Working on it');
  });

  it('shows a note when there is nothing to chart', () => {
    render(
      <ChartWidget
        {...base}
        boards={[]}
        settings={defaultChartSettings()}
        userName={() => undefined}
      />,
    );
    expect(screen.getByText('No items to chart yet.')).toBeInTheDocument();
  });

  it('shows a loader while the boards load', () => {
    render(
      <ChartWidget
        {...base}
        loading
        settings={defaultChartSettings()}
        userName={() => undefined}
      />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('TableWidget', () => {
  const settings = { columnIds: [], filter: null, rowLimit: 10 as const };

  it('lists items with their boards and links to the item card', () => {
    render(
      <MemoryRouter>
        <TableWidget {...base} settings={settings} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('row')).toHaveLength(7);
    const link = screen.getByRole('link', { name: 'i1' });
    expect(link.getAttribute('href')).toContain('i1');
    expect(screen.getAllByText('Sales').length).toBeGreaterThan(0);
  });

  it('renders every item as its own row with name, board and a status cell inside a grid cell', () => {
    render(
      <MemoryRouter>
        <TableWidget {...base} settings={settings} />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);
    const first = rows[0] as HTMLElement;
    expect(within(first).getByRole('link')).toBeInTheDocument();
    expect(within(first).getAllByRole('gridcell').length).toBeGreaterThanOrEqual(5);
    // The status fill is absolutely positioned, so it must sit in a cell, never loose in the row.
    for (const label of screen.getAllByText(/^(Done|Working on it|Stuck)$/)) {
      expect(label.closest('[role="gridcell"]')).not.toBeNull();
    }
  });

  it('gives rows a fixed token height and positions cells so a status fill stays in its cell', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/dashboard/dashboard.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.tableRow \{[^}]*height: var\(--atrium-dashboard-table-row-height\)/);
    expect(css).toMatch(/\.tableCell \{[^}]*position: relative/);
  });

  it('says how many rows are hidden', () => {
    const board = makeBoard({ id: 'big', columns: [statusColumn('status')] });
    const items = Array.from({ length: 12 }, (_, i) =>
      makeItem({ id: `r${i}`, position: `a${i}` }),
    );
    render(
      <MemoryRouter>
        <TableWidget {...base} boards={[{ board, items }]} settings={settings} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Showing 10 of 12')).toBeInTheDocument();
  });

  it('shows an empty note when nothing matches', () => {
    render(
      <MemoryRouter>
        <TableWidget {...base} boards={[]} settings={settings} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No items match.')).toBeInTheDocument();
  });
});
