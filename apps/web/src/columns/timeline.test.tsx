import type { ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import styles from './cells.module.css';
import { formatTimelineRange, timelineUi } from './timeline';
import type { CellContext } from './types';

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

const column: ColumnDef = {
  id: 'tl1',
  type: 'timeline',
  title: 'Timeline',
  position: 'a0',
  settings: {},
};

describe('Timeline column UI', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatTimelineRange', () => {
    const now = new Date(2026, 9, 10, 12, 0, 0);

    it('formats same-month ranges as "Oct 3 - 17"', () => {
      expect(formatTimelineRange('2026-10-03', '2026-10-17', now)).toBe('Oct 3 - 17');
    });

    it('formats cross-month ranges as "Oct 28 - Nov 4"', () => {
      expect(formatTimelineRange('2026-10-28', '2026-11-04', now)).toBe('Oct 28 - Nov 4');
    });

    it('formats a single-day range as "Oct 3"', () => {
      expect(formatTimelineRange('2026-10-03', '2026-10-03', now)).toBe('Oct 3');
    });
  });

  describe('TimelineCell', () => {
    it('renders empty hint icon when value is null', () => {
      const { container } = render(
        <timelineUi.Cell
          value={null}
          settings={{ showProgress: false }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
      expect(container.querySelector(`.${styles.timelinePill}`)).not.toBeInTheDocument();
    });

    it('renders filled pill with same-month and cross-month date ranges', () => {
      const { rerender } = render(
        <timelineUi.Cell
          value={{ from: '2026-10-03', to: '2026-10-17' }}
          settings={{ showProgress: false }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('Oct 3 - 17')).toBeInTheDocument();

      rerender(
        <timelineUi.Cell
          value={{ from: '2026-10-28', to: '2026-11-04' }}
          settings={{ showProgress: false }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('Oct 28 - Nov 4')).toBeInTheDocument();
    });

    it('shows inclusive day count on hover and restores date range on mouseLeave', () => {
      const { container } = render(
        <timelineUi.Cell
          value={{ from: '2026-10-03', to: '2026-10-17' }}
          settings={{ showProgress: false }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      const pill = container.querySelector(`.${styles.timelinePill}`) as HTMLElement;
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute('title', '15d');
      expect(screen.getByText('Oct 3 - 17')).toBeInTheDocument();

      fireEvent.mouseEnter(pill);
      expect(screen.getByText('15d')).toBeInTheDocument();

      fireEvent.mouseLeave(pill);
      expect(screen.getByText('Oct 3 - 17')).toBeInTheDocument();
    });

    it('renders proportional progress fill when settings.showProgress is true vs false', () => {
      const { container, rerender } = render(
        <timelineUi.Cell
          value={{ from: '2026-10-03', to: '2026-10-17' }}
          settings={{ showProgress: false }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(container.querySelector(`.${styles.timelineFill}`)).not.toBeInTheDocument();
      expect(container.querySelector(`.${styles.timelinePillProgress}`)).not.toBeInTheDocument();

      rerender(
        <timelineUi.Cell
          value={{ from: '2026-10-03', to: '2026-10-17' }}
          settings={{ showProgress: true }}
          column={column}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      // Today is 2026-10-10 -> halfway between Oct 3 and Oct 17 (7/14 = 50%)
      const pill = container.querySelector(`.${styles.timelinePillProgress}`);
      const fill = container.querySelector(`.${styles.timelineFill}`) as HTMLElement;
      expect(pill).toBeInTheDocument();
      expect(fill).toBeInTheDocument();
      expect(fill.style.width).toBe('50%');
    });
  });

  describe('TimelineEditor', () => {
    it('selects a date range and calls onChange with from <= to', async () => {
      const Editor = timelineUi.Editor;
      if (!Editor) throw new Error('timelineUi should have an Editor');
      const onChange = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <Editor
          value={null}
          settings={{ showProgress: false }}
          column={column}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      // Click day 17 first, then day 3 (in current month) -> should normalize to from: 2026-10-03, to: 2026-10-17
      await user.click(screen.getByRole('gridcell', { name: '17' }));
      expect(onChange).not.toHaveBeenCalled();

      await user.click(screen.getAllByRole('gridcell', { name: '3' })[0]!);
      expect(onChange).toHaveBeenCalledWith({
        from: '2026-10-03',
        to: '2026-10-17',
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('clears the timeline when clicking Clear', async () => {
      const Editor = timelineUi.Editor;
      if (!Editor) throw new Error('timelineUi should have an Editor');
      const onChange = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <Editor
          value={{ from: '2026-10-03', to: '2026-10-17' }}
          settings={{ showProgress: false }}
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
