import type { ColumnDef } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hourUi } from './hour';
import { getColumnUi } from './registry';
import { timelineUi } from './timeline';
import type { CellContext } from './types';
import { weekUi } from './week';
import { worldClockUi } from './world-clock';

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

const makeColumn = (type: string, title = 'Test Column'): ColumnDef => ({
  id: 'c1',
  type,
  title,
  position: 'a0',
  settings: {},
});

describe('Time Column UIs', () => {
  describe('registry', () => {
    it('registers timeline, week, hour, world_clock in the registry', () => {
      for (const type of ['timeline', 'week', 'hour', 'world_clock']) {
        const ui = getColumnUi(type);
        expect(ui).toBeDefined();
        expect(ui?.type).toBe(type);
      }
    });
  });

  describe('timeline column', () => {
    it('renders empty hint icon when value is null', () => {
      const { container } = render(
        <timelineUi.Cell
          value={null}
          settings={{ showProgress: true }}
          column={makeColumn('timeline')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders formatted date range when value is present', () => {
      render(
        <timelineUi.Cell
          value={{ from: '2026-10-20', to: '2026-10-25' }}
          settings={{ showProgress: true }}
          column={makeColumn('timeline')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText('2026-10-20 - 2026-10-25')).toBeInTheDocument();
    });
  });

  describe('week column', () => {
    it('renders empty hint icon when value is null', () => {
      const { container } = render(
        <weekUi.Cell
          value={null}
          settings={{ firstDayOfWeek: 'monday' }}
          column={makeColumn('week')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders formatted week string when value is present', () => {
      render(
        <weekUi.Cell
          value={{ week: { startDate: '2026-10-19', endDate: '2026-10-25' } }}
          settings={{ firstDayOfWeek: 'monday' }}
          column={makeColumn('week')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText('W43 (2026-10-19 - 2026-10-25)')).toBeInTheDocument();
    });
  });

  describe('hour column', () => {
    it('renders empty hint icon when value is null', () => {
      const { container } = render(
        <hourUi.Cell
          value={null}
          settings={{ format24Hour: true }}
          column={makeColumn('hour')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders 24-hour time when value is present', () => {
      render(
        <hourUi.Cell
          value={{ hour: 14, minute: 30 }}
          settings={{ format24Hour: true }}
          column={makeColumn('hour')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText('14:30')).toBeInTheDocument();
    });

    it('renders 12-hour time when format24Hour is false', () => {
      render(
        <hourUi.Cell
          value={{ hour: 14, minute: 30 }}
          settings={{ format24Hour: false }}
          column={makeColumn('hour')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText('02:30 PM')).toBeInTheDocument();
    });
  });

  describe('world clock column', () => {
    it('renders empty hint icon when value is null', () => {
      const { container } = render(
        <worldClockUi.Cell
          value={null}
          settings={{ format24Hour: true, showCity: true }}
          column={makeColumn('world_clock')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders timezone and city when showCity is true', () => {
      render(
        <worldClockUi.Cell
          value={{ timezone: 'Europe/London' }}
          settings={{ format24Hour: true, showCity: true }}
          column={makeColumn('world_clock')}
          ctx={dummyContext}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText('Europe/London (London)')).toBeInTheDocument();
    });
  });
});
