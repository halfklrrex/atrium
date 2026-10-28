import type { ColumnDef } from '@atrium/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __notifySharedTickerForTests } from './shared-ticker';
import type { CellContext } from './types';
import { worldClockUi } from './world-clock';

const dummyColumn: ColumnDef = {
  id: 'c-wc',
  type: 'world_clock',
  title: 'World Clock',
  position: 'a0',
  settings: { format24Hour: true, showCity: true },
};

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

const FIXED_TIME_MS = Date.UTC(2026, 9, 28, 14, 30, 0); // 2026-10-28T14:30:00Z

describe('world_clock column UI', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_TIME_MS);
    __notifySharedTickerForTests(FIXED_TIME_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has popover editor configured on worldClockUi', () => {
    expect(worldClockUi.type).toBe('world_clock');
    expect(worldClockUi.editor).toBe('popover');
    expect(worldClockUi.Editor).toBeDefined();
  });

  it('renders empty state with hint icon when value is null', () => {
    const { container } = render(
      <worldClockUi.Cell
        value={null}
        settings={{ format24Hour: true, showCity: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('renders live local time and city when showCity is true and respects format24Hour', () => {
    const { rerender } = render(
      <worldClockUi.Cell
        value={{ timezone: 'America/New_York' }}
        settings={{ format24Hour: true, showCity: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );
    // 14:30 UTC on Oct 28 (EDT is UTC-4) -> 10:30
    expect(screen.getByText('10:30')).toBeInTheDocument();
    expect(screen.getByText('New York')).toBeInTheDocument();

    // Hide city
    rerender(
      <worldClockUi.Cell
        value={{ timezone: 'America/New_York' }}
        settings={{ format24Hour: true, showCity: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('10:30')).toBeInTheDocument();
    expect(screen.queryByText('New York')).not.toBeInTheDocument();

    // 12-hour format in afternoon (14:30 UTC -> 02:30 pm)
    rerender(
      <worldClockUi.Cell
        value={{ timezone: 'UTC' }}
        settings={{ format24Hour: false, showCity: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/02:30\s*pm/i)).toBeInTheDocument();
    expect(screen.getByText('UTC')).toBeInTheDocument();
  });

  it('updates multiple mounted cells via one shared ticker without per-cell intervals', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = render(
      <div>
        <worldClockUi.Cell
          value={{ timezone: 'UTC' }}
          settings={{ format24Hour: true, showCity: true }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />
        <worldClockUi.Cell
          value={{ timezone: 'Asia/Tokyo' }}
          settings={{ format24Hour: true, showCity: true }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />
      </div>,
    );

    // Only one shared interval should be created for both cells
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('14:30')).toBeInTheDocument();
    expect(screen.getByText('23:30')).toBeInTheDocument();

    // Advance time by 15 minutes via shared ticker
    act(() => {
      __notifySharedTickerForTests(FIXED_TIME_MS + 15 * 60_000);
    });

    expect(screen.getByText('14:45')).toBeInTheDocument();
    expect(screen.getByText('23:45')).toBeInTheDocument();

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('filters CANONICAL_TIMEZONES by city or timezone and selects an option in WorldClockEditor', async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const Editor = worldClockUi.Editor!;

    render(
      <Editor
        value={{ timezone: 'UTC' }}
        settings={{ format24Hour: true, showCity: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
        onClose={onClose}
        anchor={document.body}
        saveSettings={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('Search timezone or city…');

    // Filter by city name (with space, matching getDefaultCity("America/New_York"))
    await userEvent.type(input, 'New York');
    const nyOption = screen.getByRole('option', { name: /New York.*America\/New_York/i });
    expect(nyOption).toBeInTheDocument();

    // Filter by IANA timezone substring
    await userEvent.clear(input);
    await userEvent.type(input, 'Asia/Tokyo');
    const tokyoOption = screen.getByRole('option', { name: /Tokyo.*Asia\/Tokyo/i });
    fireEvent.click(tokyoOption);

    expect(onChange).toHaveBeenCalledWith({ timezone: 'Asia/Tokyo' });
    expect(onClose).toHaveBeenCalled();
  });

  it('clears the timezone when clicking Clear in WorldClockEditor', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const Editor = worldClockUi.Editor!;

    render(
      <Editor
        value={{ timezone: 'Europe/London' }}
        settings={{ format24Hour: true, showCity: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
        onClose={onClose}
        anchor={document.body}
        saveSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });
});
