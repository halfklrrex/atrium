import type { ColumnDef, TimeTrackingSettings, TimeTrackingValue } from '@atrium/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { columnActionCalls } from '../lib/callables';
import { __notifySharedTickerForTests } from './shared-ticker';
import { formatSessionTimestamp, timeTrackingUi } from './time-tracking';
import type { CellContext, CellProps } from './types';

vi.mock('../data/members-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUserLookup: () => (uid: string) =>
    uid === 'user-avery'
      ? { uid, name: 'Avery Quinn', photoURL: null, email: 'avery@example.com' }
      : undefined,
}));

const Cell = timeTrackingUi.Cell as ComponentType<
  CellProps<TimeTrackingValue, TimeTrackingSettings>
>;

const dummyColumn: ColumnDef = {
  id: 'c-tt',
  type: 'time_tracking',
  title: 'Time Tracking',
  position: 'a0',
  settings: { trackHistory: true, requireNote: false },
};

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: false,
  canAct: true,
  boardId: 'board-1',
  itemId: 'item-1',
};

const BASE_TIME_MS = Date.UTC(2026, 9, 28, 12, 0, 0); // 2026-10-28T12:00:00Z

describe('time_tracking column UI', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME_MS);
    __notifySharedTickerForTests(BASE_TIME_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps editor set to none on timeTrackingUi', () => {
    expect(timeTrackingUi.type).toBe('time_tracking');
    expect(timeTrackingUi.editor).toBe('none');
    expect(timeTrackingUi.Editor).toBeUndefined();
  });

  it('renders stopped cell with formatted duration and Play button', () => {
    render(
      <Cell
        value={{ duration: 3900, running: false }}
        settings={{ trackHistory: true, requireNote: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1h 5m' })).toBeInTheDocument();
  });

  it('renders running cell with Stop button and live ticking duration via shared ticker', () => {
    const startDate = BASE_TIME_MS - 120_000; // started 2 minutes ago
    render(
      <Cell
        value={{
          duration: 3600, // 1h previously completed
          running: true,
          startDate,
          history: [
            {
              id: 's-1',
              startedAt: startDate - 4000_000,
              endedAt: startDate - 400_000,
              duration: 3600,
              userId: 'user-avery',
            },
            {
              id: 's-2',
              startedAt: startDate,
              duration: 0,
              userId: 'user-avery',
            },
          ],
        }}
        settings={{ trackHistory: true, requireNote: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1h 2m' })).toBeInTheDocument();

    // Advance shared ticker by 3 minutes (180_000 ms) -> total should be 1h 5m
    act(() => {
      __notifySharedTickerForTests(BASE_TIME_MS + 180_000);
    });

    expect(screen.getByRole('button', { name: '1h 5m' })).toBeInTheDocument();
  });

  it('calls columnActionCalls.startTimeTracking directly when clicking Play with requireNote: false', async () => {
    const startSpy = vi.spyOn(columnActionCalls, 'startTimeTracking').mockResolvedValue({
      success: true,
      sessionId: 'sess-100',
      startedAt: BASE_TIME_MS,
    });
    const onChange = vi.fn();

    render(
      <Cell
        value={{ duration: 0, running: false }}
        settings={{ trackHistory: true, requireNote: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith({
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'c-tt',
      });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens the note popover when clicking Play with requireNote: true and submits note to startTimeTracking', async () => {
    const startSpy = vi.spyOn(columnActionCalls, 'startTimeTracking').mockResolvedValue({
      success: true,
      sessionId: 'sess-101',
      startedAt: BASE_TIME_MS,
    });
    const onChange = vi.fn();

    render(
      <Cell
        value={{ duration: 0, running: false }}
        settings={{ trackHistory: true, requireNote: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    // Should not call startTimeTracking before a note is entered
    expect(startSpy).not.toHaveBeenCalled();

    const noteInput = screen.getByLabelText('Note');
    const startTimerBtn = screen.getByRole('button', { name: 'Start timer' });
    expect(startTimerBtn).toBeDisabled();

    await userEvent.type(noteInput, 'Investigating layout regression');
    expect(startTimerBtn).toBeEnabled();

    fireEvent.click(startTimerBtn);

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith({
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'c-tt',
        note: 'Investigating layout regression',
      });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls columnActionCalls.stopTimeTracking when clicking Stop while running', async () => {
    const stopSpy = vi.spyOn(columnActionCalls, 'stopTimeTracking').mockResolvedValue({
      success: true,
      duration: 120,
      stoppedAt: BASE_TIME_MS,
    });
    const onChange = vi.fn();

    render(
      <Cell
        value={{
          duration: 0,
          running: true,
          startDate: BASE_TIME_MS - 120_000,
          history: [
            {
              id: 's-1',
              startedAt: BASE_TIME_MS - 120_000,
              duration: 0,
              userId: 'user-avery',
            },
          ],
        }}
        settings={{ trackHistory: true, requireNote: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(stopSpy).toHaveBeenCalledWith({
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'c-tt',
      });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens the session history popover when clicking duration with trackHistory: true', () => {
    const startedAt = Date.UTC(2026, 9, 28, 9, 0, 0);
    const endedAt = Date.UTC(2026, 9, 28, 10, 30, 0);

    render(
      <Cell
        value={{
          duration: 5400,
          running: false,
          history: [
            {
              id: 'sess-1',
              startedAt,
              endedAt,
              duration: 5400,
              userId: 'user-avery',
              note: 'Drafted initial spec',
            },
          ],
        }}
        settings={{ trackHistory: true, requireNote: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1h 30m' }));

    const dialog = screen.getByRole('dialog', { name: 'Time Tracking history' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Avery Quinn')).toBeInTheDocument();
    expect(
      screen.getByText(`${formatSessionTimestamp(startedAt)} – ${formatSessionTimestamp(endedAt)}`),
    ).toBeInTheDocument();
    expect(screen.getByText('Drafted initial spec')).toBeInTheDocument();
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThanOrEqual(2);
    expect(dialog).not.toHaveTextContent('user-avery');
  });

  it('shows "Unknown member" for a session owner that cannot be resolved, never the uid', () => {
    render(
      <Cell
        value={{
          duration: 60,
          running: false,
          history: [
            {
              id: 'sess-x',
              startedAt: Date.UTC(2026, 9, 28, 9, 0, 0),
              endedAt: Date.UTC(2026, 9, 28, 9, 1, 0),
              duration: 60,
              userId: 'uid-gone-123',
            },
          ],
        }}
        settings={{ trackHistory: true, requireNote: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '1m' }));
    const dialog = screen.getByRole('dialog', { name: 'Time Tracking history' });
    expect(dialog).toHaveTextContent('Unknown member');
    expect(dialog).not.toHaveTextContent('uid-gone-123');
  });
});
