import type { DropdownSettings, StatusSettings } from '@atrium/shared';
import { orderStatusLabels } from '@atrium/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DropdownLabelEditor, StatusLabelEditor } from './LabelEditors';

const status: StatusSettings = {
  labels: [
    { id: 'a', index: 0, label: 'Alpha', color: '#fdab3d' },
    { id: 'b', index: 1, label: 'Beta', color: '#00c875' },
    { id: 'c', index: 2, label: 'Gamma', color: '#df2f4a' },
    { id: 'blank', index: 5, label: '', color: '#c4c4c4' },
  ],
};

const dropdown: DropdownSettings = {
  limitSelect: false,
  labels: [
    { id: 0, label: 'One' },
    { id: 1, label: 'Two' },
    { id: 2, label: 'Three' },
  ],
};

describe('StatusLabelEditor reorder', () => {
  it('moves a label with the arrow keys and saves that order without touching ids or indexes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<StatusLabelEditor settings={status} onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Reorder Gamma' }));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByTestId('label-live').textContent).toContain(
      'Gamma moved to position 1 of 3',
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const saved = onSave.mock.calls[0]?.[0] as StatusSettings;
    expect(saved.labels.filter((l) => l.label).map((l) => l.label)).toEqual([
      'Gamma',
      'Alpha',
      'Beta',
    ]);
    expect(saved.labels.find((l) => l.label === 'Gamma')).toMatchObject({ id: 'c', index: 2 });
    expect(orderStatusLabels(saved.labels).map((l) => l.id)).toEqual(['blank', 'c', 'a', 'b']);
  });

  it('lets a new label be moved before Apply', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<StatusLabelEditor settings={status} onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /New label/ }));
    const names = screen.getAllByLabelText('Label name');
    await user.type(names[3] as HTMLElement, 'Fresh');
    await user.click(screen.getByRole('button', { name: 'Reorder Fresh' }));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const saved = onSave.mock.calls[0]?.[0] as StatusSettings;
    expect(saved.labels.filter((l) => l.label).map((l) => l.label)).toEqual([
      'Alpha',
      'Fresh',
      'Beta',
      'Gamma',
    ]);
  });
});

describe('DropdownLabelEditor reorder', () => {
  it('moves a label with the arrow keys and saves that order with the same ids', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<DropdownLabelEditor settings={dropdown} onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Reorder One' }));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onSave).toHaveBeenCalledWith({
      limitSelect: false,
      labels: [
        { id: 1, label: 'Two' },
        { id: 2, label: 'Three' },
        { id: 0, label: 'One' },
      ],
    });
  });

  it('lets a new label be moved before Apply', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<DropdownLabelEditor settings={dropdown} onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /New label/ }));
    await user.type(screen.getAllByLabelText('Label name')[3] as HTMLElement, 'Fresh');
    await user.click(screen.getByRole('button', { name: 'Reorder Fresh' }));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const saved = onSave.mock.calls[0]?.[0] as DropdownSettings;
    expect(saved.labels.map((l) => l.label)).toEqual(['One', 'Fresh', 'Two', 'Three']);
  });
});

describe('custom label colors', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, boardColors?: string[]) => {
    const onSave = vi.fn();
    render(
      <StatusLabelEditor
        settings={status}
        boardColors={boardColors}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Color of Alpha' }));
    return onSave;
  };

  it('puts the wheel swatch last and applies a typed hex with Use', async () => {
    const user = userEvent.setup();
    const onSave = await open(user);
    const wheel = screen.getByRole('radio', { name: 'Pick a custom color' });
    const radios = screen.getAllByRole('radio');
    expect(radios[radios.length - 1]).toBe(wheel);
    await user.click(wheel);
    const hex = screen.getByLabelText('Hex color');
    await user.clear(hex);
    await user.type(hex, 'abc');
    expect(screen.getByTestId('color-preview').style.backgroundColor).toBe('rgb(170, 187, 204)');
    await user.click(screen.getByRole('button', { name: 'Use' }));
    expect(screen.queryByRole('group', { name: 'Custom color' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const saved = onSave.mock.calls[0]?.[0] as StatusSettings;
    expect(saved.labels.find((l) => l.id === 'a')?.color).toBe('#aabbcc');
  });

  it('flags invalid hex and does not apply it', async () => {
    const user = userEvent.setup();
    const onSave = await open(user);
    await user.click(screen.getByRole('radio', { name: 'Pick a custom color' }));
    const hex = screen.getByLabelText('Hex color');
    await user.clear(hex);
    await user.type(hex, '#12zz');
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Enter a color');
    expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect((onSave.mock.calls[0]?.[0] as StatusSettings).labels[0]?.color).toBe('#fdab3d');
  });

  it('cancels with the Cancel button and with Escape', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('radio', { name: 'Pick a custom color' }));
    // The editor footer also has a Cancel, so scope to the picker.
    await user.click(
      within(screen.getByRole('group', { name: 'Custom color' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect(screen.queryByRole('group', { name: 'Custom color' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Pick a custom color' }));
    screen.getByLabelText('Hex color').focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Custom color' })).toBeNull();
  });

  it('scrolls the picker into view, focuses it, and returns focus to the swatch on Escape', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      await open(user);
      const wheel = screen.getByRole('radio', { name: 'Pick a custom color' });
      await user.click(wheel);
      expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
      const square = screen.getByRole('slider', { name: 'Saturation and brightness' });
      expect(document.activeElement).toBe(square);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('group', { name: 'Custom color' })).toBeNull();
      expect(document.activeElement).toBe(wheel);
    } finally {
      // @ts-expect-error restoring the jsdom default (no scrollIntoView)
      delete Element.prototype.scrollIntoView;
    }
  });

  it('moves the saturation/brightness handle with the arrow keys', async () => {
    const user = userEvent.setup();
    const onSave = await open(user);
    await user.click(screen.getByRole('radio', { name: 'Pick a custom color' }));
    const square = screen.getByRole('slider', { name: 'Saturation and brightness' });
    square.focus();
    const before = (screen.getByLabelText('Hex color') as HTMLInputElement).value;
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowLeft}');
    const after = (screen.getByLabelText('Hex color') as HTMLInputElement).value;
    expect(after).not.toBe(before);
    expect(square.getAttribute('aria-valuetext')).toMatch(/Saturation \d+ percent/);
    await user.click(screen.getByRole('button', { name: 'Use' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect((onSave.mock.calls[0]?.[0] as StatusSettings).labels[0]?.color).toBe(after);
  });

  it('lists saved board colors once, selects the wheel for a custom color and reuses a saved one', async () => {
    const user = userEvent.setup();
    const onSave = await open(user, ['#123456', '#123456', '#654321']);
    expect(screen.getAllByRole('radio', { name: /^Custom color #/ })).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: 'Custom color #654321' }));
    await user.click(screen.getByRole('button', { name: 'Color of Alpha' }));
    expect(
      screen.getByRole('radio', { name: 'Pick a custom color' }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect((onSave.mock.calls[0]?.[0] as StatusSettings).labels[0]?.color).toBe('#654321');
  });
});
