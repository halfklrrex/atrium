import type { ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { hourUi } from './hour';
import type { CellContext } from './types';

const dummyColumn: ColumnDef = {
  id: 'c-hour',
  type: 'hour',
  title: 'Meeting Time',
  position: 'a0',
  settings: { format24Hour: true },
};

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

describe('hour column UI', () => {
  it('renders an empty cell with the clock hint icon', () => {
    const { container } = render(
      <hourUi.Cell
        value={null}
        settings={{ format24Hour: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('renders a filled cell in 24-hour and 12-hour modes', () => {
    const { rerender } = render(
      <hourUi.Cell
        value={{ hour: 14, minute: 30 }}
        settings={{ format24Hour: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('14:30')).toBeInTheDocument();

    rerender(
      <hourUi.Cell
        value={{ hour: 14, minute: 30 }}
        settings={{ format24Hour: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('02:30 PM')).toBeInTheDocument();
  });

  it('saves valid 24-hour and 12-hour inputs in HourEditor', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const Editor = hourUi.Editor!;

    const { unmount } = render(
      <Editor
        value={null}
        settings={{ format24Hour: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
        onClose={onClose}
        anchor={null}
        saveSettings={vi.fn()}
      />,
    );

    const input24 = screen.getByLabelText('Meeting Time');
    fireEvent.change(input24, { target: { value: '14:30' } });
    fireEvent.keyDown(input24, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({ hour: 14, minute: 30 });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    onChange.mockClear();
    onClose.mockClear();

    render(
      <Editor
        value={null}
        settings={{ format24Hour: false }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
        onClose={onClose}
        anchor={null}
        saveSettings={vi.fn()}
      />,
    );

    const input12 = screen.getByLabelText('Meeting Time');
    fireEvent.change(input12, { target: { value: '2:30 PM' } });
    fireEvent.keyDown(input12, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({ hour: 14, minute: 30 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the cell when empty input is committed in HourEditor', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const Editor = hourUi.Editor!;

    render(
      <Editor
        value={{ hour: 9, minute: 30 }}
        settings={{ format24Hour: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
        onClose={onClose}
        anchor={null}
        saveSettings={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Meeting Time');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks invalid input with aria-invalid and does not call onChange', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const Editor = hourUi.Editor!;

    render(
      <Editor
        value={{ hour: 9, minute: 30 }}
        settings={{ format24Hour: true }}
        column={dummyColumn}
        ctx={dummyContext}
        onChange={onChange}
        onClose={onClose}
        anchor={null}
        saveSettings={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Meeting Time');
    fireEvent.change(input, { target: { value: '25:99' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'not-a-time' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
