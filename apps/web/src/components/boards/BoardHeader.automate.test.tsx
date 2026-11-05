import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', () => ({
  useWorkspace: () => ({
    data: { name: 'Home', roles: { u1: 'member' }, memberIds: [] },
    loading: false,
    error: null,
  }),
}));
vi.mock('../AppShell/ui-store', () => ({
  useUiStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ openDialog: vi.fn(), openActivityPanel: vi.fn() }),
}));
vi.mock('../UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('../board-views/ViewTabs', () => ({ ViewTabs: () => null }));
vi.mock('../activity/BoardActivityPanel', () => ({ BoardActivityPanel: () => null }));
vi.mock('../presence', () => ({ PresenceAvatars: () => null }));
vi.mock('./BoardMenu', () => ({ BoardMenu: () => null }));
vi.mock('./FavoriteStar', () => ({ FavoriteStar: () => null }));
vi.mock('./board-actions', () => ({ boardActions: {} }));
vi.mock('../automations/AutomationCenter', () => ({
  AutomationCenter: ({ role, onClose }: { role: string | null; onClose: () => void }) => (
    <div role="dialog" aria-label="Automations">
      <span>{`role:${role}`}</span>
      <button type="button" onClick={onClose}>
        Close center
      </button>
    </div>
  ),
}));

import { BoardHeader } from './BoardHeader';

describe('BoardHeader Automate button', () => {
  it('opens the Automation center with the viewer role and returns focus when it closes', async () => {
    render(
      <BoardHeader board={makeBoard({ id: 'b1', access: { u1: 'owner' }, accessUids: ['u1'] })} />,
    );
    const automate = screen.getByRole('button', { name: 'Automate' });
    fireEvent.click(automate);
    expect(screen.getByRole('dialog', { name: 'Automations' })).toHaveTextContent('role:owner');
    fireEvent.click(screen.getByRole('button', { name: 'Close center' }));
    expect(screen.queryByRole('dialog', { name: 'Automations' })).toBeNull();
    await waitFor(() => expect(automate).toHaveFocus());
  });
});
