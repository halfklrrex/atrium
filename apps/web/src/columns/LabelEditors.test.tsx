import type { DropdownSettings, StatusSettings } from '@atrium/shared';
import { orderStatusLabels } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
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
