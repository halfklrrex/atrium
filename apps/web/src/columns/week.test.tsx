import type { ColumnDef } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellContext } from './types';
import { weekUi } from './week';

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

const column: ColumnDef = {
  id: 'w1',
  type: 'week',
  title: 'Week',
  position: 'a0',
  settings: {},
};

describe('Week column UI', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 28, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('WeekCell', () => {
    it('renders empty hint icon when value is null', () => {
      const { container } = render(
        <weekUi.Cell
          value={null}
          settings={{ firstDayOfWeek: 'monday' }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders "Oct 20 - 26" for a same-month week', () => {
      render(
        <weekUi.Cell
          value={{ week: { startDate: '2026-10-20', endDate: '2026-10-26' } }}
          settings={{ firstDayOfWeek: 'monday' }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('Oct 20 - 26')).toBeInTheDocument();
    });

    it('renders "Oct 26 - Nov 1" for a cross-month week', () => {
      render(
        <weekUi.Cell
          value={{ week: { startDate: '2026-10-26', endDate: '2026-11-01' } }}
          settings={{ firstDayOfWeek: 'monday' }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('Oct 26 - Nov 1')).toBeInTheDocument();
    });
  });

  describe('WeekEditor', () => {
    it('computes the whole Monday-first week when selecting a date and closes', async () => {
      const Editor = weekUi.Editor;
      if (!Editor) throw new Error('weekUi should have an Editor');
      const onChange = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <Editor
          value={{ week: { startDate: '2026-10-19', endDate: '2026-10-25' } }}
          settings={{ firstDayOfWeek: 'monday' }}
          column={column}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      // Click day 21 (Wednesday Oct 21, 2026) -> Monday-first week is 2026-10-19 to 2026-10-25
      await user.click(screen.getByRole('gridcell', { name: '21' }));
      expect(onChange).toHaveBeenCalledWith({
        week: { startDate: '2026-10-19', endDate: '2026-10-25' },
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('computes the whole Sunday-first week when firstDayOfWeek is sunday', async () => {
      const Editor = weekUi.Editor;
      if (!Editor) throw new Error('weekUi should have an Editor');
      const onChange = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <Editor
          value={{ week: { startDate: '2026-10-18', endDate: '2026-10-24' } }}
          settings={{ firstDayOfWeek: 'sunday' }}
          column={column}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      // Click day 21 (Wednesday Oct 21, 2026) -> Sunday-first week is 2026-10-18 to 2026-10-24
      await user.click(screen.getByRole('gridcell', { name: '21' }));
      expect(onChange).toHaveBeenCalledWith({
        week: { startDate: '2026-10-18', endDate: '2026-10-24' },
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('sets the current week when clicking "This week"', async () => {
      const Editor = weekUi.Editor;
      if (!Editor) throw new Error('weekUi should have an Editor');
      const onChange = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <Editor
          value={null}
          settings={{ firstDayOfWeek: 'monday' }}
          column={column}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'This week' }));
      // System time is 2026-10-28 (Wednesday) -> Monday-first week is 2026-10-26 to 2026-11-01
      expect(onChange).toHaveBeenCalledWith({
        week: { startDate: '2026-10-26', endDate: '2026-11-01' },
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('clears the week when clicking "Clear"', async () => {
      const Editor = weekUi.Editor;
      if (!Editor) throw new Error('weekUi should have an Editor');
      const onChange = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <Editor
          value={{ week: { startDate: '2026-10-19', endDate: '2026-10-25' } }}
          settings={{ firstDayOfWeek: 'monday' }}
          column={column}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Clear' }));
      expect(onChange).toHaveBeenCalledWith(null);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
