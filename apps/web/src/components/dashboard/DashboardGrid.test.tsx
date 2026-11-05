import { defaultWidgetSettings, type DashboardWidget } from '@atrium/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseMenuItem } from '../../test/menu';
import { DashboardGrid, LAYOUT_SAVE_DELAY_MS } from './DashboardGrid';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const widget = (
  id: string,
  layout: { x: number; y: number; w: number; h: number },
): DashboardWidget =>
  ({
    id,
    type: 'numbers',
    title: `Widget ${id}`,
    layout,
    boardIds: [],
    settings: defaultWidgetSettings('numbers'),
  }) as DashboardWidget;

const widgets = [widget('a', { x: 0, y: 0, w: 4, h: 3 }), widget('b', { x: 4, y: 0, w: 4, h: 3 })];

function setup(overrides: { canEdit?: boolean; widgets?: DashboardWidget[] } = {}) {
  const props = {
    widgets: overrides.widgets ?? widgets,
    canEdit: overrides.canEdit ?? true,
    renderWidget: (w: DashboardWidget) => <p>{`body ${w.id}`}</p>,
    onLayoutChange: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
  };
  const view = render(<DashboardGrid {...props} />);
  return { props, ...view };
}

const handle = (id: string) =>
  screen.getByRole('button', { name: new RegExp(`^Move Widget ${id}`) });
const resizer = (id: string) =>
  screen.getByRole('button', { name: new RegExp(`^Resize Widget ${id}`) });
const cardOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-widget-id="${id}"]`) as HTMLElement;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('DashboardGrid', () => {
  it('places widgets on the 12 column grid', () => {
    setup();
    expect(cardOf('a').style.gridColumn).toBe('1 / span 4');
    expect(cardOf('b').style.gridColumn).toBe('5 / span 4');
    expect(cardOf('a').style.gridRow).toBe('1 / span 3');
    expect(screen.getByText('body a')).toBeInTheDocument();
  });

  it('moves a widget one cell per arrow key and saves once after a pause', () => {
    const { props } = setup();
    const move = handle('b');
    fireEvent.keyDown(move, { key: 'ArrowRight' });
    fireEvent.keyDown(move, { key: 'ArrowRight' });
    // Shown at once, saved later.
    expect(cardOf('b').style.gridColumn).toBe('7 / span 4');
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS));
    expect(props.onLayoutChange).toHaveBeenCalledTimes(1);
    expect(props.onLayoutChange.mock.calls[0]?.[0]).toEqual([
      { id: 'a', x: 0, y: 0, w: 4, h: 3 },
      { id: 'b', x: 6, y: 0, w: 4, h: 3 },
    ]);
  });

  it('pushes the other widgets out of the way', () => {
    setup();
    fireEvent.keyDown(handle('a'), { key: 'ArrowRight' });
    fireEvent.keyDown(handle('a'), { key: 'ArrowRight' });
    fireEvent.keyDown(handle('a'), { key: 'ArrowRight' });
    fireEvent.keyDown(handle('a'), { key: 'ArrowRight' });
    // a now covers columns 5 to 8, where b lives, so b goes below it.
    expect(cardOf('a').style.gridColumn).toBe('5 / span 4');
    expect(cardOf('b').style.gridRow).toBe('4 / span 3');
  });

  it('keeps a widget inside the grid', () => {
    setup();
    fireEvent.keyDown(handle('a'), { key: 'ArrowLeft' });
    fireEvent.keyDown(handle('a'), { key: 'ArrowUp' });
    expect(cardOf('a').style.gridColumn).toBe('1 / span 4');
    expect(cardOf('a').style.gridRow).toBe('1 / span 3');
  });

  it('resizes with the arrow keys on the corner handle, within the limits', () => {
    const { props } = setup();
    const grip = resizer('a');
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(cardOf('a').style.gridColumn).toBe('1 / span 5');
    expect(cardOf('a').style.gridRow).toBe('1 / span 4');
    for (let i = 0; i < 6; i += 1) fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    // The minimum width is 2.
    expect(cardOf('a').style.gridColumn).toBe('1 / span 2');
    act(() => void vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS));
    expect(props.onLayoutChange).toHaveBeenCalledTimes(1);
  });

  it('keeps a Table widget at its minimum size when resized with the keyboard', () => {
    const table = {
      ...widget('t', { x: 0, y: 0, w: 5, h: 4 }),
      type: 'table',
      settings: defaultWidgetSettings('table'),
    } as DashboardWidget;
    setup({ widgets: [table] });
    for (let i = 0; i < 8; i += 1) {
      fireEvent.keyDown(resizer('t'), { key: 'ArrowLeft' });
      fireEvent.keyDown(resizer('t'), { key: 'ArrowUp' });
    }
    expect(cardOf('t').style.gridColumn).toBe('1 / span 4');
    expect(cardOf('t').style.gridRow).toBe('1 / span 3');
  });

  it('announces the new position for screen readers', () => {
    setup();
    fireEvent.keyDown(handle('a'), { key: 'ArrowDown' });
    expect(screen.getByText('Widget a moved to: column 1, row 2, 4 wide, 3 tall')).toBeVisible();
  });

  it('ignores other keys and modified arrows', () => {
    const { props } = setup();
    fireEvent.keyDown(handle('a'), { key: 'a' });
    fireEvent.keyDown(handle('a'), { key: 'ArrowRight', ctrlKey: true });
    act(() => void vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS));
    expect(props.onLayoutChange).not.toHaveBeenCalled();
  });

  it('saves a pending change when the page is left', () => {
    const { props, unmount } = setup();
    fireEvent.keyDown(handle('a'), { key: 'ArrowDown' });
    unmount();
    expect(props.onLayoutChange).toHaveBeenCalledTimes(1);
  });

  it('gives viewers a read-only grid without handles or menus', () => {
    setup({ canEdit: false });
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Resize/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Options for/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Widget a' })).toBeInTheDocument();
  });

  it('opens the widget menu with edit, duplicate and remove', async () => {
    vi.useRealTimers();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'Options for Widget a' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument();
    await chooseMenuItem(user, 'Duplicate');
    await waitFor(() =>
      expect(props.onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' })),
    );
  });
});
