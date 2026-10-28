import type { ColumnDef } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../components/toast-store';
import { columnActionCalls } from '../lib/callables';
import { buttonUi, getReadableButtonTextColor } from './button';
import type { CellContext } from './types';

const column: ColumnDef = {
  id: 'btn1',
  type: 'button',
  title: 'Action',
  position: 'a0',
  settings: { label: 'Deploy', color: '#579bfc' },
};

const baseCtx: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: false,
  canAct: true,
  boardId: 'board-1',
  itemId: 'item-1',
};

describe('Button column UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useToastStore.setState({ toasts: [] });
  });

  describe('getReadableButtonTextColor', () => {
    it('returns light text token for dark background colours', () => {
      expect(getReadableButtonTextColor('#579bfc')).toBe('var(--atrium-table-on-fill)');
      expect(getReadableButtonTextColor('#df2f4a')).toBe('var(--atrium-table-on-fill)');
      expect(getReadableButtonTextColor('#5559df')).toBe('var(--atrium-table-on-fill)');
    });

    it('returns dark text token for bright background colours', () => {
      expect(getReadableButtonTextColor('#ffcb00')).toBe('var(--fixed-dark-color)');
      expect(getReadableButtonTextColor('#9cd326')).toBe('var(--fixed-dark-color)');
    });
  });

  describe('ButtonCell', () => {
    it('renders a small Vibe Button with settings.label and --atrium-btn-bg / --atrium-btn-fg', () => {
      const { rerender } = render(
        <buttonUi.Cell
          value={null}
          settings={{ label: 'Deploy', color: '#579bfc' }}
          column={column}
          ctx={baseCtx}
          onChange={vi.fn()}
        />,
      );

      const btn = screen.getByRole('button', { name: 'Deploy' });
      expect(btn).toBeInTheDocument();
      expect(btn.style.getPropertyValue('--atrium-btn-bg')).toBe('#579bfc');
      expect(btn.style.getPropertyValue('--atrium-btn-fg')).toBe('var(--atrium-table-on-fill)');

      rerender(
        <buttonUi.Cell
          value={null}
          settings={{ label: 'Notify', color: '#ffcb00' }}
          column={column}
          ctx={baseCtx}
          onChange={vi.fn()}
        />,
      );

      const brightBtn = screen.getByRole('button', { name: 'Notify' });
      expect(brightBtn.style.getPropertyValue('--atrium-btn-bg')).toBe('#ffcb00');
      expect(brightBtn.style.getPropertyValue('--atrium-btn-fg')).toBe('var(--fixed-dark-color)');
    });

    it('calls clickButton, shows loading state while pending, shows positive toast on success, and never calls onChange', async () => {
      let resolveClick!: (value: { success: true; activityId: string; timestamp: number }) => void;
      const clickSpy = vi.spyOn(columnActionCalls, 'clickButton').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveClick = resolve;
          }),
      );

      const onChange = vi.fn();
      const user = userEvent.setup();

      render(
        <buttonUi.Cell
          value={null}
          settings={{ label: 'Approve', color: '#00c875' }}
          column={column}
          ctx={baseCtx}
          onChange={onChange}
        />,
      );

      const btn = screen.getByRole('button', { name: 'Approve' });
      await user.click(btn);

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledWith({
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'btn1',
      });

      // While pending, Vibe Button renders its alert/loader spinner
      await waitFor(() => {
        expect(screen.getByRole('alert', { name: 'loading' })).toBeInTheDocument();
      });

      resolveClick({ success: true, activityId: 'act-1', timestamp: 1700000000000 });

      await waitFor(() => {
        expect(screen.queryByRole('alert', { name: 'loading' })).not.toBeInTheDocument();
      });

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({
        text: '"Approve" triggered.',
        type: 'positive',
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('shows a friendly negative toast when clickButton rejects', async () => {
      vi.spyOn(columnActionCalls, 'clickButton').mockRejectedValue({
        code: 'functions/permission-denied',
        message: 'functions/permission-denied',
      });

      const onChange = vi.fn();
      const user = userEvent.setup();

      render(
        <buttonUi.Cell
          value={null}
          settings={{ label: 'Approve', color: '#579bfc' }}
          column={column}
          ctx={baseCtx}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Approve' }));

      await waitFor(() => {
        const toasts = useToastStore.getState().toasts;
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toMatchObject({
          text: 'You do not have permission to perform this action.',
          type: 'negative',
        });
      });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
