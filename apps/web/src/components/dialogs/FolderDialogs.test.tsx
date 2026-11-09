import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFolder } from '../../test/fixtures';
import { FolderDialog } from './FolderDialogs';

const mocks = vi.hoisted(() => ({
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  folders: [] as unknown[],
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useFolders: () => ({ data: mocks.folders, loading: false, error: null }),
  writes: { createFolder: mocks.createFolder, updateFolder: mocks.updateFolder },
}));

beforeEach(() => {
  mocks.createFolder.mockReset().mockResolvedValue('f1');
  mocks.updateFolder.mockReset().mockResolvedValue(undefined);
  mocks.folders = [];
});

describe('folder dialog icon', () => {
  it('creates a folder without an icon by default', async () => {
    render(<FolderDialog workspaceId="w1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'No icon (folder glyph)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.type(screen.getByLabelText('Folder name'), 'Plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(mocks.createFolder).toHaveBeenCalled());
    expect(mocks.createFolder.mock.calls[0]![2].icon).toBeUndefined();
  });

  it('creates a folder with the chosen ph: icon', async () => {
    render(<FolderDialog workspaceId="w1" onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Folder name'), 'Trips');
    await userEvent.type(screen.getByLabelText('Search icons'), 'airplane');
    await userEvent.click(screen.getByRole('button', { name: 'airplane tilt' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(mocks.createFolder).toHaveBeenCalled());
    expect(mocks.createFolder.mock.calls[0]![2]).toMatchObject({ icon: 'ph:airplane-tilt' });
  });

  it('removes the icon of an existing folder with "No icon"', async () => {
    mocks.folders = [makeFolder({ id: 'f9', name: 'Trips', icon: 'ph:airplane-tilt' })];
    render(<FolderDialog workspaceId="w1" folderId="f9" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'airplane tilt' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'No icon (folder glyph)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateFolder).toHaveBeenCalled());
    expect(mocks.updateFolder.mock.calls[0]![2]).toMatchObject({ icon: null });
  });
});
