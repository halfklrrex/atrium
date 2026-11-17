import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../AppShell/ui-store';
import { AddMenu } from './AddMenu';

vi.mock('../../lib/firebase', () => ({ db: {} }));

async function openMenu(props: Partial<Parameters<typeof AddMenu>[0]> = {}) {
  render(<AddMenu workspaceId="w1" canCreateBoards canManageFolders {...props} />);
  await userEvent.click(screen.getByRole('button', { name: 'Add to workspace' }));
  await screen.findAllByRole('menuitem');
}

describe('AddMenu', () => {
  beforeEach(() => useUiStore.setState({ dialog: null }));

  it('lists Doc right after Board', async () => {
    await openMenu();
    const titles = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(titles.indexOf('Doc')).toBe(titles.indexOf('Board') + 1);
  });

  it('opens the New doc dialog for the workspace', async () => {
    await openMenu();
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(screen.getByRole('menuitem', { name: 'Doc' }));
    // Vibe runs a menu item's click two animation frames later.
    await waitFor(() =>
      expect(useUiStore.getState().dialog).toEqual({
        type: 'newDoc',
        workspaceId: 'w1',
        folderId: null,
      }),
    );
  });

  it('disables Doc for people who cannot add to the workspace', async () => {
    await openMenu({ canCreateBoards: false });
    expect(screen.getByRole('menuitem', { name: 'Doc' }).className).toMatch(/disabled/);
  });
});
