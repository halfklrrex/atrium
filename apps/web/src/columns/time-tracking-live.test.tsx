import type { ColumnDef, TimeTrackingSettings, TimeTrackingValue } from '@atrium/shared';
import { act, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeTrackingUi } from './time-tracking';
import type { CellContext, CellProps } from './types';

vi.mock('../data/members-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUserLookup: () => () => undefined,
}));

const Cell = timeTrackingUi.Cell as ComponentType<
  CellProps<TimeTrackingValue, TimeTrackingSettings>
>;
const column: ColumnDef = {
  id: 'c-tt',
  type: 'time_tracking',
  title: 'Time Tracking',
  position: 'a0',
  settings: { trackHistory: true, requireNote: false },
};
const ctx: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: false,
  canAct: true,
  boardId: 'board-1',
  itemId: 'item-1',
};
const BASE = Date.UTC(2026, 9, 28, 12, 0, 0);

function renderCell(value: TimeTrackingValue) {
  return render(
    <Cell
      value={value}
      settings={{ trackHistory: true, requireNote: false }}
      column={column}
      ctx={ctx}
      onChange={vi.fn()}
    />,
  );
}

describe('time_tracking live display', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: BASE });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks every second while a session is running', () => {
    renderCell({ duration: 5400, running: true, startDate: BASE });
    expect(screen.getByRole('button', { name: '1h 30m' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: '1h 30m 1s' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByRole('button', { name: '1h 30m 5s' })).toBeInTheDocument();
  });

  it('is correct on first render after a reload mid-session', () => {
    renderCell({ duration: 5400, running: true, startDate: BASE - 11_000 });
    expect(screen.getByRole('button', { name: '1h 30m 11s' })).toBeInTheDocument();
  });

  it('does not tick when stopped and clears its interval on unmount', () => {
    const { unmount } = renderCell({ duration: 5400, running: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('button', { name: '1h 30m' })).toBeInTheDocument();
    unmount();
    const running = renderCell({ duration: 0, running: true, startDate: BASE });
    running.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
