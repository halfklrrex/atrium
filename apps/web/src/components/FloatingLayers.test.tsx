import { Dropdown, Menu, MenuButton, MenuItem } from '@vibe/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

/**
 * Regression: a board's "..." menu was drawn under the table's sticky header. Floating layers must
 * live in a portal on <body>, never inside a clipped or stacked ancestor (the content panel and the
 * sidebar both have `overflow` set). The z-index tier itself is checked in theme/tokens.test.ts.
 */
describe('floating layers render in a portal on <body>', () => {
  it('Vibe MenuButton menus (board, column, row menus)', async () => {
    render(
      <div data-testid="panel" style={{ overflow: 'hidden' }}>
        <MenuButton aria-label="Options for Board">
          <Menu id="test-menu">
            <MenuItem title="Board permissions" />
          </Menu>
        </MenuButton>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Options for Board' }));
    const item = await screen.findByText('Board permissions');
    expect(screen.getByTestId('panel')).not.toContainElement(item);
    // index.css targets this wrapper to apply --atrium-z-dropdown.
    const wrapper = item.closest('.monday-style-dialog-content-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.parentElement).toBe(document.body);
  });

  it('Popover panels (workspace switcher, board info)', () => {
    render(
      <div data-testid="panel" style={{ overflow: 'hidden' }}>
        <Popover
          open
          onClose={() => undefined}
          label="Switch workspace"
          trigger={<button type="button">t</button>}
        >
          <p>content</p>
        </Popover>
      </div>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Switch workspace' });
    expect(screen.getByTestId('panel')).not.toContainElement(dialog);
    expect(dialog.parentElement).toBe(document.body);
  });

  it('a Dropdown inside a Popover opens in its own portal and picking an option keeps the popover open', async () => {
    const onClose = vi.fn();
    const onChange = vi.fn();
    render(
      <Popover
        open
        onClose={onClose}
        label="Sort board items"
        trigger={<button type="button">t</button>}
      >
        <Dropdown
          aria-label="Sort column"
          clearable={false}
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ]}
          value={{ value: 'a', label: 'Alpha' }}
          onChange={onChange}
        />
      </Popover>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Sort board items' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort column' }));
    const option = await screen.findByRole('option', { name: 'Beta' });
    // The menu is not inside the popover panel; it lives in a dialog wrapper that index.css puts on
    // the dropdown tier, which tokens.test.ts asserts is above the popover tier.
    expect(dialog).not.toContainElement(option);
    expect(option.closest('.monday-style-dialog-content-wrapper')).not.toBeNull();
    // Mousedown on the portalled option must not count as an outside click on the popover.
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
