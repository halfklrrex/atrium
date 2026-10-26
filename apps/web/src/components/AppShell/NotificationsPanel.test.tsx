import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationsPanel } from './NotificationsPanel';
import { useUiStore } from './ui-store';

const setOpen = (open: boolean) => act(() => useUiStore.getState().setNotificationsOpen(open));

function renderPanel() {
  render(
    <MemoryRouter>
      <button type="button" data-notifications-trigger="">
        <span>Bell</span>
      </button>
      <p>Outside</p>
      <NotificationsPanel />
    </MemoryRouter>,
  );
}

afterEach(() => setOpen(false));

describe('NotificationsPanel', () => {
  it('is inert until it is opened', () => {
    renderPanel();
    const panel = screen.getByLabelText('Notifications', { selector: 'aside' });
    expect(panel).toHaveAttribute('inert');
    setOpen(true);
    expect(panel).not.toHaveAttribute('inert');
  });

  it('shows the all-caught-up state with its tabs, search and toggle', () => {
    renderPanel();
    setOpen(true);
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    for (const name of ['All', 'Mentioned', 'Assigned to me']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: "You're all caught up!" })).toBeInTheDocument();
    expect(screen.getByText('No new notifications for now. Enjoy the calm.')).toBeInTheDocument();
    expect(screen.getByLabelText('Unread only')).toBeInTheDocument();
  });

  it('closes with Escape, the close button and an outside click', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().notificationsOpen).toBe(false);

    setOpen(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
    expect(useUiStore.getState().notificationsOpen).toBe(false);

    setOpen(true);
    await userEvent.click(screen.getByText('Outside'));
    expect(useUiStore.getState().notificationsOpen).toBe(false);
  });

  it('ignores clicks inside the panel and on the bell', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByRole('heading', { name: 'Notifications' }));
    expect(useUiStore.getState().notificationsOpen).toBe(true);
    await userEvent.click(screen.getByText('Bell'));
    expect(useUiStore.getState().notificationsOpen).toBe(true);
  });
});
